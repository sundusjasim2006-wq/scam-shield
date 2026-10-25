// Three agents that hand work to each other and can disagree:
//   Investigator -> Skeptic -> (revision round if challenged) -> Judge
import { runTools } from './tools.mjs';
import { askModel, modelConfigured } from './llm.mjs';
import { memoryEvidence } from './memory.mjs';

const HARD_STOP = new Set(['new_bank_account', 'lookalike_domain', 'reply_to_mismatch', 'registry_domain_mismatch', 'gift_card',
  'prompt_injection', 'secrecy', 'no_callback', 'ceo_impersonation', 'caller_id_unknown', 'unknown_number', 'phishing',
  'utility_impersonation', 'onboarding_fee', 'memory_account_conflict', 'known_scam_memory']);
const BENIGN = { matching_purchase_order: 1, known_account: 1.5, matching_verified_bank_change: 1.5, known_vendor: 1,
  registered_company: 0.5, typical_amount: 0.5, known_contact: 1.5, safe_word_matched: 2, memory_account_match: 1.5, verified_vendor_memory: 1 };
const IDENTITY_FAIL = new Set(['lookalike_domain', 'reply_to_mismatch', 'registry_domain_mismatch', 'ceo_impersonation', 'unknown_number', 'caller_id_unknown', 'known_scam_memory']);
const SEV = { high: 3, medium: 1.5, low: 0.5, none: 0 };
const RANK = { OK: 0, VERIFY_FIRST: 1, HOLD: 2 };
const cap = (x, hi = 0.98) => Math.round(Math.min(hi, x) * 100) / 100;

export async function investigator(input, db, logger) {
  const ev = runTools(input, db, logger);
  const mem = await memoryEvidence(input, db);
  if (mem) {
    ev.results.push(mem);
    ev.signals = [...new Set([...ev.signals, ...mem.signals])];
    logger?.log({ agent_name: 'Investigator', action: 'memory_recall', target_agent: 'H-MEM', input_summary: input.id,
      output_summary: `${mem.severity.toUpperCase()}: ${mem.finding}`, status: mem.unavailable ? 'fallback' : mem.severity === 'none' ? 'clear' : 'flagged' });
  }
  const memMatch = ev.signals.includes('memory_account_match');
  const hard = ev.signals.filter((s) => HARD_STOP.has(s));
  const resolvedByMemory = (r) => memMatch && ((r.tool === 'companyRegistryCheck' && r.signals.includes('unknown_vendor')) || (r.tool === 'bankAccountCheck' && r.signals.includes('unverifiable_account')));
  const flagged = ev.results.some((r) => (r.severity === 'high' || r.severity === 'medium') && !resolvedByMemory(r));
  const h = {
    verdict: hard.length ? 'HOLD' : flagged ? 'VERIFY_FIRST' : 'OK',
    hard, signals: ev.signals,
    risk: ev.results.reduce((a, r) => a + SEV[r.severity], 0),
    benign: ev.signals.reduce((a, s) => a + (BENIGN[s] || 0), 0),
    discounted: false, modelNote: null, modelUsed: false,
  };
  h.confidence = h.verdict === 'HOLD' ? cap(0.6 + 0.08 * hard.length) : h.verdict === 'OK' ? (h.benign >= 2 ? 0.92 : 0.8) : 0.65;
  h.rationale = h.verdict === 'HOLD' ? `${hard.length} hard-stop signal(s): ${hard.join(', ')}`
    : h.verdict === 'VERIFY_FIRST' ? 'No hard-stop signal, but findings need verification before paying' : 'Everything checked is consistent with company records';
  if (modelConfigured()) {
    try {
      const m = await askModel('Give your own risk opinion (HOLD, VERIFY_FIRST or OK) with a short reason.',
        { evidence: ev.results.filter((r) => r.severity !== 'none').map((r) => ({ tool: r.tool, finding: r.finding, evidence: r.evidence })), channel: input.channel, untrusted_message: input.message });
      h.modelNote = m.reason || m.reasoning || null;
      const op = String(m.risk_opinion || m.opinion || '').toUpperCase();
      h.modelUsed = true;
      if (RANK[op] > RANK[h.verdict]) { h.verdict = op; h.confidence = cap(Math.max(h.confidence, 0.7)); h.rationale += ` | model escalated to ${op}`; }
      logger?.log({ agent_name: 'Investigator', action: 'model_opinion', output_summary: `model says ${op || 'n/a'}`, status: 'success' });
    } catch (e) {
      logger?.log({ agent_name: 'Investigator', action: 'model_opinion', output_summary: `model unavailable (${e.message}); using offline evidence rules`, status: 'fallback' });
    }
  }
  h.hypothesisConfidence = h.confidence;
  logger?.log({ agent_name: 'Investigator', action: 'hypothesis', target_agent: 'Skeptic', input_summary: input.id,
    output_summary: `${h.verdict} (${h.rationale})`, confidence: h.confidence, status: 'success' });
  return { ev, h };
}

export function skeptic(h, input, logger, round) {
  const benign = h.signals.filter((s) => BENIGN[s]), idFail = h.signals.filter((s) => IDENTITY_FAIL.has(s));
  const points = []; let action = 'uphold';
  if (h.verdict === 'HOLD') {
    if (benign.length && !h.discounted) {
      points.push(`There is innocent-looking evidence: ${benign.join(', ')}.`);
      if (idFail.length) { action = 'needs_revision'; points.push(`But the sender's identity is unverified (${idFail.join(', ')}), so an impostor could copy these details. Weigh them accordingly.`); }
    } else points.push(benign.length ? 'Remaining innocent evidence was already discounted; no innocent explanation covers the hard-stop signals.' : 'I tried to defend this message and found no innocent explanation in the data.');
  } else if (h.verdict === 'VERIFY_FIRST') points.push('This could be a legitimate request, but the records do not confirm it. A quick verification is cheap compared with a wrong payment.');
  else points.push(h.risk > 0 ? 'I looked for hidden risk and found only minor items; the records back this request up.' : 'I looked for hidden risk and found none; the records back this request up.');
  logger?.log({ agent_name: 'Skeptic', action: 'critique', target_agent: 'Investigator', input_summary: `round ${round}`,
    output_summary: `${action}: ${points[0]}`, confidence: h.confidence, retry_count: round - 1, status: action === 'uphold' ? 'success' : 'needs_revision' });
  return { action, points };
}

export function revise(h, review, logger, round) {
  const idFail = h.signals.filter((s) => IDENTITY_FAIL.has(s));
  const out = { ...h, discounted: true, benign: 0, confidence: cap(h.confidence + 0.1) };
  logger?.log({ agent_name: 'Investigator', action: 'revise', target_agent: 'Skeptic', input_summary: `round ${round}`,
    output_summary: `Discounted innocent evidence because identity checks failed (${idFail.join(', ')})${out.confidence !== h.confidence ? `; confidence ${h.confidence} -> ${out.confidence}` : '; confidence stays at the maximum'}`,
    confidence: out.confidence, retry_count: round, status: 'revised' });
  return out;
}

function safeAction(h, input) {
  const s = new Set(h.signals);
  if (h.verdict === 'OK') return 'Consistent with your records. Pay as normal and keep the invoice on file.';
  if (h.verdict === 'VERIFY_FIRST') return s.has('unknown_vendor')
    ? 'Pause. Confirm this vendor is genuine through an independent contact and set it up properly before paying.'
    : 'Pause. Confirm with the vendor using a contact from your own records and attach a purchase order before paying.';
  const a = [];
  if (s.has('prompt_injection')) a.push('The message tried to instruct an AI system; those instructions were ignored.');
  if (s.has('gift_card')) a.push('Do not buy gift cards or send codes; report this to your security team.');
  else if (s.has('onboarding_fee')) a.push('Never pay a fee to get a job; verify the company independently.');
  else if (s.has('new_bank_account')) a.push('Do not pay. Call the vendor on the phone number in your own records (not one from the message) and confirm any bank change.');
  else if (input.channel === 'voice_transcript' || s.has('no_callback')) a.push('Do not wire money. Call the person back on the number in your directory.');
  else if (s.has('unknown_number')) a.push('Do not send money. Call the saved number for your family member and ask for the family safe word.');
  else if (s.has('phishing') || s.has('utility_impersonation')) a.push('Do not click the link. Type the organisation\'s address yourself or call the number on your statement.');
  else a.push('Do not act on this request until it is verified through a channel you look up yourself.');
  a.push('Tell someone else before acting.');
  return a.join(' ');
}

export async function judge(input, h, review, ev, logger, rounds) {
  const keep = ev.results.filter((r) => r.severity === 'high' || r.severity === 'medium').flatMap((r) => r.evidence).filter(Boolean);
  const good = ev.results.filter((r) => r.severity === 'none' && r.signals.some((s) => BENIGN[s])).flatMap((r) => r.evidence);
  const money = (`${input.subject || ''} ${input.message || ''}`.match(/\$\s?([\d,]+(?:\.\d+)?)/) || [])[1];
  const result = {
    id: input.id, verdict: h.verdict, confidence: h.confidence, rounds,
    why: h.rationale, skeptic_view: review.points.join(' '),
    evidence: (h.verdict === 'OK' ? good : keep).slice(0, 8), safe_action: safeAction(h, input),
    amount_mentioned_usd: money ? Number(money.replace(/,/g, '')) : null, signals: h.signals,
    mode: h.modelUsed ? 'model+evidence' : modelConfigured() ? 'offline-evidence (model unavailable)' : 'offline-evidence', model_note: h.modelNote,
  };
  logger?.log({ agent_name: 'Judge', action: 'verdict', input_summary: input.id,
    output_summary: `${result.verdict} (confidence ${result.confidence}, ${rounds} round${rounds > 1 ? 's' : ''})`, confidence: result.confidence, retry_count: rounds - 1, status: 'success' });
  return result;
}

export async function analyze(input, db, logger) {
  let { ev, h } = await investigator(input, db, logger);
  let round = 1, review = skeptic(h, input, logger, round);
  while (review.action === 'needs_revision' && round < 2) {
    h = revise(h, review, logger, round);
    round += 1;
    review = skeptic(h, input, logger, round);
  }
  return judge(input, h, review, ev, logger, round);
}
