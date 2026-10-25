// Scam Shield's memory spine = Meterless H-MEM (the real engine from vendor/hmem).
//   remember : hmem.add()            (MemoryStoreService)
//   recall   : hmem.query()          (MemoryRetrievalService: hybrid ranking + provenance)
//   audit    : hmem.ledger.history() (TrustLedgerService)
// If H-MEM cannot load, the agents keep working on the evidence tools and log a fallback.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { identifyVendor, accountOf, emailDomain } from './tools.mjs';

let state = null;
async function init() {
  if (state) return state;
  if (process.env.SCAMSHIELD_MEMORY === 'off') return (state = { error: 'memory turned off (SCAMSHIELD_MEMORY=off)' });
  const entry = path.join(process.cwd(), 'vendor', 'hmem', 'src', 'index.ts');
  if (!fs.existsSync(entry)) return (state = { error: 'H-MEM engine not installed (run: npm run setup)' });
  try {
    const mod = await import(pathToFileURL(entry).href);
    const dir = process.env.SCAMSHIELD_MEMORY_DIR || path.join(process.cwd(), '.scamshield-memory');
    state = { hmem: new mod.HMEM({ persistDir: dir }), source: 'vendor/hmem', dir };
  } catch (e) {
    state = { error: `H-MEM could not load (${String(e.message).split('\n')[0]}). Start with: npx tsx server.mjs` };
  }
  return state;
}

export async function memoryStatus() {
  const s = await init();
  return s.error ? { enabled: false, reason: s.error } : { enabled: true, source: s.source, dir: s.dir };
}

const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' | ');
function parse(content) {
  const m = String(content).match(/^(VENDOR_ACCOUNT|KNOWN_SCAM) \| (.*)$/);
  if (!m) return null;
  const f = { kind: m[1] };
  for (const part of m[2].split(' | ')) { const i = part.indexOf('='); if (i > 0) f[part.slice(0, i)] = part.slice(i + 1); }
  return f;
}

async function recall(kind, domain) {
  const s = await init();
  if (s.error) return { error: s.error, hits: [] };
  const found = new Map();
  try {
    for (const q of [`${kind} ${domain}`, domain]) {
      const r = await s.hmem.query(q, { threshold: 0.05 });
      for (const m of r.memories || []) {
        const rec = parse(m.memory.content);
        if (rec && rec.kind === kind && rec.domain === domain && !found.has(m.memory.id)) found.set(m.memory.id, { id: m.memory.id, relevance: Number(m.relevance).toFixed(2), ...rec });
      }
    }
  } catch (e) { return { error: e.message, hits: [] }; }
  return { hits: [...found.values()] };
}

async function store(content, source) {
  const s = await init();
  if (s.error) return { ok: false, reason: s.error };
  const rec = await s.hmem.add({ content, type: 'general', source });
  return { ok: true, id: rec.id, content };
}

export async function memoryEvidence(input, db) {
  const sd = emailDomain(input.sender);
  const vi = identifyVendor(input, db);
  const vendorDomain = vi ? vi.vendor.official_domain : sd;
  if (!vendorDomain) return null;
  const acct = accountOf(input);
  const [v, scam] = await Promise.all([recall('VENDOR_ACCOUNT', vendorDomain), sd ? recall('KNOWN_SCAM', sd) : { hits: [] }]);
  const out = (finding, severity, signals = [], evidence = [], extra = {}) => ({ tool: 'memoryCheck', finding, severity, signals, evidence, ...extra });
  if (v.error) return out(`Memory unavailable: ${v.error}`, 'none', [], [], { unavailable: true });
  const sig = [], ev = []; let sev = 'none', finding = 'No memory of this sender yet (first time seen)';
  if (scam.hits.length) {
    const h = scam.hits[0]; sev = 'high'; sig.push('known_scam_memory'); finding = 'This sender was previously confirmed as a scam';
    ev.push(`Memory ${h.id} (H-MEM relevance ${h.relevance}): ${h.domain} was confirmed as a scam impersonating ${h.impersonates} on ${h.learned}`);
  }
  if (v.hits.length) {
    const known = [...new Set(v.hits.map((h) => h.account_last4))], first = v.hits[0];
    if (acct && !known.includes(acct)) {
      sev = 'high'; sig.push('memory_account_conflict'); finding = 'The account differs from the one remembered for this vendor';
      ev.push(`Memory ${first.id} (H-MEM relevance ${first.relevance}): ${first.vendor} was verified with account ending ${known.join(', ')}, but this request says ${acct}`);
    } else if (acct) {
      sig.push('memory_account_match', 'verified_vendor_memory'); if (sev === 'none') finding = 'The account matches what was verified earlier';
      ev.push(`Memory ${first.id} (H-MEM relevance ${first.relevance}): ${first.vendor} was verified with account ending ${acct} on ${first.learned}`);
    } else { sig.push('verified_vendor_memory'); finding = 'This vendor was verified earlier'; ev.push(`Memory ${first.id}: ${first.vendor} was verified on ${first.learned}`); }
  }
  return out(finding, sev, sig, ev);
}

// Human-in-the-loop learning. The agent never learns on its own authority.
export async function learnFromOutcome(input, db, outcome) {
  const sd = emailDomain(input.sender), vi = identifyVendor(input, db), acct = accountOf(input);
  const today = new Date().toISOString().slice(0, 10);
  if (outcome === 'confirmed_scam') {
    if (!sd) return { ok: false, reason: 'No sender domain to remember' };
    const r = await store(`KNOWN_SCAM | ${fmt({ domain: sd, impersonates: vi?.vendor.name || 'unknown', account_last4: acct || 'none', learned: today })}`, 'scamshield:known-scam');
    return r.ok ? { ...r, message: `Remembered ${sd} as a known scam (${r.id}).` } : r;
  }
  if (outcome === 'verified_legitimate') {
    const domain = vi ? vi.vendor.official_domain : sd;
    if (!domain || !acct) return { ok: false, reason: 'Need a sender domain and an account in the message to remember a verified vendor' };
    if (sd !== domain) return { ok: false, reason: `Refused: the sender domain (${sd}) is not the vendor's real domain (${domain})` };
    const name = vi?.vendor.name || input.display_name || sd;
    const r = await store(`VENDOR_ACCOUNT | ${fmt({ vendor: name, domain, account_last4: acct, status: 'verified_by_human', learned: today })}`, 'scamshield:vendor-account');
    return r.ok ? { ...r, message: `Remembered ${name} with account ending ${acct} (${r.id}).` } : r;
  }
  return { ok: false, reason: 'Unknown outcome' };
}

export async function auditMemory(id) {
  const s = await init();
  if (s.error) return [];
  return s.hmem.ledger.history(id);
}
