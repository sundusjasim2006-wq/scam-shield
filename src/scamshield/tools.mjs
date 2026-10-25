// The 10 evidence tools. Each returns { tool, finding, severity, signals, evidence }.
// All checks are plain code over the company's data. A model reasons over these results later.
// The message text is UNTRUSTED DATA: nothing inside it is ever treated as an instruction.

const FREEMAIL = ['freemail.example', 'gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'proton.me'];
const INTERNAL = ['acme-internal.example'];

const mk = (tool, finding, severity, signals = [], evidence = []) => ({ tool, finding, severity, signals, evidence });
export const emailDomain = (a) => (a && a.includes('@') ? a.split('@').pop().trim().toLowerCase() : null);
const regDomain = (h) => h.toLowerCase().split('.').slice(-2).join('.');
const linkDomains = (links = []) => links.map((u) => { try { return regDomain(new URL(u).hostname); } catch { return null; } }).filter(Boolean);
const fullText = (i) => `${i.subject || ''}\n${i.message || ''}`;
const snip = (m) => `"${String(m).trim().slice(0, 60)}"`;
const pol = (db, id) => { const r = db.policy.rules.find((x) => x.id === id); return r ? `Policy ${id}: ${r.text}` : null; };

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const knownDomains = (db) => [...db.vendors.map((v) => v.official_domain), ...db.companies.map((c) => c.domain), ...INTERNAL];
const allDomains = (i) => [
  ...[['sender', emailDomain(i.sender)], ['reply-to', emailDomain(i.reply_to)]].filter(([, d]) => d),
  ...linkDomains(i.links).map((d) => ['link', d]),
].filter(([, d], idx, arr) => arr.findIndex(([, x]) => x === d) === idx);

export function identifyVendor(i, db) {
  const doms = [emailDomain(i.sender), emailDomain(i.reply_to)].filter(Boolean);
  for (const v of db.vendors) if (doms.includes(v.official_domain)) return { vendor: v, how: 'sender or reply-to domain matches the vendor record' };
  for (const d of [...doms, ...linkDomains(i.links)])
    for (const v of db.vendors) if (lev(d, v.official_domain) <= 2) return { vendor: v, how: `looks like ${v.name} (lookalike domain)`, claimed: true };
  const text = `${i.display_name || ''} ${fullText(i)}`.toLowerCase();
  for (const v of db.vendors) if (text.includes(v.name.toLowerCase())) return { vendor: v, how: `${v.name} is named in the message`, claimed: true };
  return null;
}
export const amountOf = (i) => { const m = fullText(i).match(/\$\s?([\d,]+(?:\.\d+)?)/); return m ? Number(m[1].replace(/,/g, '')) : null; };
export const accountOf = (i) => { const m = fullText(i).match(/(?:account|acct)[^\d]{0,40}(\d{4})\b/i); return m ? m[1] : null; };

export function domainAge(i, db) {
  const fresh = [], unknown = [];
  for (const [role, d] of allDomains(i)) {
    const age = db.domains[d]?.age_in_days;
    if (age == null) unknown.push(`${role} domain ${d} has no record in the domain registry`);
    else if (age < 30) fresh.push(`${role} domain ${d} is only ${age} days old (security/domain_registry.json)`);
  }
  if (fresh.length) return mk('domainAge', 'A domain in this message was registered very recently', 'high', ['new_domain'], fresh);
  if (unknown.length) return mk('domainAge', 'A domain has no history on record', 'low', ['unknown_domain'], unknown);
  return mk('domainAge', allDomains(i).length ? 'All domains are established' : 'No domains to check', 'none');
}

export function lookalikeDomain(i, db) {
  const known = knownDomains(db), hits = [];
  for (const [role, d] of allDomains(i)) {
    if (known.includes(d) || FREEMAIL.includes(d)) continue;
    for (const k of known) { const dist = lev(d, k); if (dist >= 1 && dist <= 2) hits.push(`${role} domain ${d} is ${dist} character${dist > 1 ? 's' : ''} away from the real ${k}`); }
  }
  return hits.length
    ? mk('lookalikeDomain', 'A domain imitates a known vendor or company', 'high', ['lookalike_domain'], [...new Set(hits), pol(db, 'POL-DOMAIN-01')])
    : mk('lookalikeDomain', 'No lookalike domains', 'none');
}

export function bankAccountCheck(i, db) {
  const acct = accountOf(i);
  if (!acct) return mk('bankAccountCheck', 'No bank account mentioned', 'none');
  const vi = identifyVendor(i, db);
  if (!vi) return mk('bankAccountCheck', `Account ending ${acct} cannot be checked: no vendor record`, 'medium', ['unverifiable_account'], [`Account ending ${acct} is mentioned but the sender is not a known vendor`]);
  const v = vi.vendor, hist = db.payments.filter((p) => p.vendor === v.name);
  const used = hist.filter((p) => p.account_last4 === acct).length;
  const change = db.bankChanges.find((c) => c.vendor === v.name && c.new_last4 === acct);
  if (acct === v.bank_last4 || change?.callback_verified) {
    const sig = ['known_account'];
    const ev = [`Account ending ${acct} matches the ${v.name} record (erp/vendors.json)`, `Used in ${used} of ${hist.length} past payments (accounting/payments.csv)`];
    if (change?.callback_verified) { sig.push('matching_verified_bank_change'); ev.push(`Bank change ${change.old_last4} to ${change.new_last4} was confirmed by callback to ${change.phone_on_file} by ${change.verified_by} on ${change.date} (erp/bank_change_log.json)`); }
    return mk('bankAccountCheck', 'The account is known and verified', 'none', sig, ev);
  }
  const ev = [`Account ending ${acct} differs from the ${v.name} record, which ends ${v.bank_last4} (erp/vendors.json)`, `All ${hist.length} past payments went to accounts ending ${[...new Set(hist.map((p) => p.account_last4))].join(', ')} (accounting/payments.csv)`];
  if (change) ev.push('A bank change is logged but was NOT confirmed by callback'); else ev.push('No bank change is logged for this vendor (erp/bank_change_log.json)');
  ev.push(pol(db, 'POL-BANK-01'));
  return mk('bankAccountCheck', 'The payment account is new and unverified', 'high', ['new_bank_account', 'no_callback_verification'], ev);
}

export function purchaseOrderMatch(i, db) {
  const amt = amountOf(i), vi = identifyVendor(i, db);
  if (!amt || !vi) return mk('purchaseOrderMatch', 'Not applicable (no vendor or amount)', 'none');
  const v = vi.vendor, po = db.pos.find((p) => p.vendor === v.name && Math.abs(p.amount_usd - amt) <= 1);
  if (po) return mk('purchaseOrderMatch', 'A matching purchase order exists', 'none', ['matching_purchase_order'], [`${po.po_number} for $${po.amount_usd} (${po.status}) matches the $${amt} request (erp/purchase_orders.json)`]);
  const ratio = amt / v.typical_amount_usd;
  if (ratio <= 1.15) return mk('purchaseOrderMatch', 'No purchase order, but the amount is in line with usual payments', 'low', ['no_purchase_order'], [`No PO for $${amt}, but ${v.name} usually bills about $${v.typical_amount_usd}`]);
  return mk('purchaseOrderMatch', 'No purchase order covers this amount', 'medium', ['no_purchase_order'], [`No PO for $${amt} from ${v.name} (erp/purchase_orders.json)`, pol(db, 'POL-PO-01')]);
}

export function amountVsTypical(i, db) {
  const amt = amountOf(i), vi = identifyVendor(i, db);
  if (!amt || !vi) return mk('amountVsTypical', 'Not applicable', 'none');
  const t = vi.vendor.typical_amount_usd, r = amt / t;
  if (r > 2) return mk('amountVsTypical', `The amount is ${r.toFixed(1)}x the vendor's typical invoice`, 'medium', ['amount_above_typical'], [`$${amt} vs typical $${t} (erp/vendors.json)`, pol(db, 'POL-PO-01')]);
  if (r >= 0.85 && r <= 1.15) return mk('amountVsTypical', 'The amount is typical for this vendor', 'none', ['typical_amount'], [`$${amt} vs typical $${t}`]);
  return mk('amountVsTypical', 'The amount is different from usual but within a normal range', 'none', [], [`$${amt} vs typical $${t}`]);
}

export function replyToMismatch(i, db) {
  const sd = emailDomain(i.sender), rd = emailDomain(i.reply_to);
  if (!sd) return mk('replyToMismatch', 'Not an email', 'none');
  const sig = [], ev = []; let sev = 'none';
  if (rd && rd !== sd) { sig.push('reply_to_mismatch'); ev.push(`Sender domain ${sd} but replies go to ${rd}`); sev = 'high'; }
  if (FREEMAIL.includes(sd) || FREEMAIL.includes(rd)) { sig.push('freemail'); ev.push('A free mailbox is being used'); if (sev === 'none') sev = 'medium'; }
  const vi = identifyVendor(i, db);
  if (vi && rd) {
    const seen = db.threads.filter((t) => t.vendor === vi.vendor.name).flatMap((t) => t.messages.map((m) => emailDomain(m.reply_to)));
    if (seen.length && !seen.includes(rd)) { sig.push('reply_to_unseen'); ev.push(`Replies to ${rd} never appear in genuine ${vi.vendor.name} threads (email_archive/threads.json)`); if (sev === 'none') sev = 'medium'; }
  }
  return mk('replyToMismatch', sig.length ? 'Sender identity looks inconsistent' : 'Sender and reply-to are consistent', sev, sig, ev);
}

const TEXT_RULES = [
  ['urgency', /\b(urgent|immediately|right now|asap|today|pay now|within \d+ ?(hours?|minutes?)|(in|within) the next \w+ (minutes|hours)|in \d+ hours|before \d+ ?(am|pm)|before (the|my|our) [\w ]{0,15}(call|meeting))\b/i],
  ['secrecy', /(keep (this|it)? ?(between us|quiet|secret)|between us|do not (mention|tell|share)|don'?t (tell|discuss)|if anyone asks|until the audit|don'?t call back)/i],
  ['no_callback', /(don'?t call back|do not call|do not use the (phone )?number|reply only to this)/i],
  ['gift_card', /(gift ?cards?|bitcoin|crypto|prepaid card)/i],
  ['onboarding_fee', /\b(onboarding|registration|processing|training) fee\b/i],
  ['off_platform', /(telegram|whatsapp|signal app|continue on)/i],
  ['wire_transfer', /\b(wire|western union|bank transfer)\b/i],
  ['family_emergency', /(it'?s me|i'?m in trouble|phone (fell|broke|is broken)|lost my phone)/i],
  ['new_number', /(new number|changed my number|lost my phone)/i],
  ['phishing', /(verify within|account (is )?(suspended|locked)|we locked your|secure link|verify your (account|identity))/i],
  ['utility_impersonation', /\b(water|electric(ity)?|gas|utility|power)\b.{0,60}\b(cut|disconnect|shut ?off|suspend)/i],
];
export function textSignals(i, db) {
  const t = fullText(i), sig = [], ev = [];
  for (const [name, re] of TEXT_RULES) { const m = t.match(re); if (m) { sig.push(name); ev.push(`${name}: ${snip(m[0])}`); } }
  const claim = `${i.display_name || ''} ${t}`.match(/\b(ceo|cfo|finance director|managing director|chief executive)\b/i);
  const sd = emailDomain(i.sender);
  if (claim && !INTERNAL.includes(sd)) { sig.push('ceo_impersonation'); ev.push(`Claims an executive role (${snip(claim[0])}) from an unverified sender`); }
  if (sig.includes('gift_card')) ev.push(pol(db, 'POL-GIFT-01'));
  if (sig.includes('secrecy') || sig.includes('no_callback')) ev.push(pol(db, 'POL-SECRECY-01'));
  const strong = sig.filter((s) => ['secrecy', 'gift_card', 'no_callback', 'ceo_impersonation', 'onboarding_fee', 'wire_transfer', 'phishing', 'utility_impersonation'].includes(s)).length;
  const sev = strong >= 2 || sig.includes('gift_card') ? 'high' : sig.length ? 'medium' : 'none';
  return mk('textSignals', sig.length ? 'The wording contains known scam pressure tactics' : 'No pressure tactics in the wording', sev, sig, ev.filter(Boolean));
}

export function promptInjectionCheck(i) {
  const m = fullText(i).match(/(ignore (all )?(previous|prior) instructions|system (note|prompt|message)|mark (this|the) (payment|invoice) as (ok|approved|safe)|you are now)/i);
  return m
    ? mk('promptInjectionCheck', 'The message tries to give instructions to an AI system', 'high', ['prompt_injection'], [`Found ${snip(m[0])} inside the message`, 'Message text is treated as untrusted data; these instructions were ignored'])
    : mk('promptInjectionCheck', 'No hidden instructions to an AI', 'none');
}

export function contactCheck(i, db) {
  if (!['sms', 'voice_transcript'].includes(i.channel)) return mk('contactCheck', 'Not a phone message', 'none');
  const last4 = (String(i.sender).match(/(\d{4})\s*$/) || [])[1];
  if (!last4) return mk('contactCheck', 'The caller ID is hidden or unknown', 'medium', ['caller_id_unknown'], [`Sender shown as "${i.sender}"`, pol(db, 'POL-CALLBACK-01')]);
  const c = db.contacts.find((x) => x.phone_last4 === last4);
  if (c) {
    const sig = ['known_contact'], ev = [`Number ending ${last4} is saved as ${c.name} (${c.relationship}) (personal/contacts.json)`];
    if (i.safe_word_matched) { sig.push('safe_word_matched'); ev.push('The family safe word was confirmed on this thread'); return mk('contactCheck', 'A saved contact, safe word confirmed', 'none', sig, ev); }
    return mk('contactCheck', 'A saved contact, but the safe word was not confirmed', 'low', sig, ev);
  }
  const family = /(mum|mom|dad|it'?s me|new number)/i.test(i.message || '');
  return mk('contactCheck', 'The number is not a saved contact', family ? 'high' : 'medium', ['unknown_number', ...(family ? ['new_number'] : [])], [`Number ending ${last4} matches no saved contact`, ...(family ? ['It claims to be family but the saved number differs; confirm with the safe word before sending money (personal/contacts.json)'] : [])]);
}

export function companyRegistryCheck(i, db) {
  const sd = emailDomain(i.sender);
  if (!sd || FREEMAIL.includes(sd) || INTERNAL.includes(sd)) return mk('companyRegistryCheck', 'Not applicable', 'none');
  const reg = db.companies.find((c) => c.domain === sd), vendor = db.vendors.find((v) => v.official_domain === sd);
  if (reg) return mk('companyRegistryCheck', 'The sender is a registered company', 'none', ['registered_company', ...(vendor ? ['known_vendor'] : [])], [`${reg.legal_name} (${reg.registration_number}) is registered with domain ${reg.domain} (external/company_registry.json)`]);
  const name = (i.display_name || '').toLowerCase();
  const near = db.companies.find((c) => name.includes(c.trading_name.toLowerCase()));
  if (near) return mk('companyRegistryCheck', 'The name matches a real company but the domain does not', 'high', ['registry_domain_mismatch'], [`Display name suggests ${near.trading_name}, whose registered domain is ${near.domain}, but the sender uses ${sd}`]);
  return mk('companyRegistryCheck', 'This company is not in the registry and has no history with us', 'medium', ['not_in_company_registry', 'unknown_vendor', 'no_history'], [`No registry record for ${sd} (external/company_registry.json)`, 'No vendor record and no payment history']);
}

export const TOOLS = [domainAge, lookalikeDomain, bankAccountCheck, purchaseOrderMatch, amountVsTypical, replyToMismatch, textSignals, promptInjectionCheck, contactCheck, companyRegistryCheck];

export function runTools(input, db, logger) {
  const results = [];
  for (const tool of TOOLS) {
    const r = tool(input, db);
    results.push(r);
    logger?.log({ agent_name: 'EvidenceTools', action: tool.name, input_summary: `${input.id}: ${input.channel} from ${input.sender}`, output_summary: `${r.severity.toUpperCase()}: ${r.finding}`, status: r.severity === 'none' ? 'clear' : 'flagged' });
  }
  return { id: input.id, results, signals: [...new Set(results.flatMap((r) => r.signals))] };
}
