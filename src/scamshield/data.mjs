// Loads the company's scattered "systems".
// The agent reads ONLY data/ and zetaris_snapshot/ (never tests/).
//
// Source order (per table):
//   1. zetaris_snapshot/<table>.json  -> rows fetched from Zetaris over JDBC
//      by scripts/zetaris_export.py (kept out of Git; created locally).
//   2. data/...                       -> the local synthetic files.
// Set DATA_SOURCE=local to force the local files.
import fs from 'node:fs';
import path from 'node:path';

// loadData key -> Zetaris table in the SCAMSHIELD database
const ZETARIS_TABLES = {
  vendors: 'vendors',
  pos: 'purchase_orders',
  bankChanges: 'bank_change_log',
  payments: 'payments',
  domains: 'domain_registry',
  companies: 'company_registry',
};

// Zetaris returns every value as text. Convert it back to the type the
// local file uses for the same field (number, boolean, null).
function coerce(value, sample) {
  if (value === undefined || value === null) return value;
  if (typeof sample === 'number') return value === '' ? null : Number(value);
  if (typeof sample === 'boolean') return String(value).toLowerCase() === 'true';
  if (sample === null && value === '') return null;
  return value;
}

function coerceRow(row, sampleRow) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = coerce(v, sampleRow ? sampleRow[k] : undefined);
  }
  return out;
}

// Rebuild the same shape the local file has, from Zetaris rows.
function rebuild(local, rows) {
  if (Array.isArray(local)) {
    return rows.map((r) => coerceRow(r, local[0]));
  }
  if (local && typeof local === 'object') {
    const listKeys = Object.keys(local).filter(
      (k) => Array.isArray(local[k]) && local[k].length && typeof local[k][0] === 'object',
    );
    if (listKeys.length === 1) {
      const k = listKeys[0];
      return { ...local, [k]: rebuild(local[k], rows) };
    }
    const sample = Object.values(local)[0];
    const out = {};
    for (const r of rows) {
      const { key, ...rest } = r;
      if (sample && typeof sample === 'object') out[key] = coerceRow(rest, sample);
      else out[key] = coerce(rest.value, sample);
    }
    return out;
  }
  return local;
}

// Order-independent comparison, used as an integrity check.
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).sort().join(',') + ']';
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

let traced = false;
function trace(root, mode, sources, matches) {
  if (traced) return;
  traced = true;
  try {
    const dir = path.join(root, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const summary = Object.entries(sources)
      .map(([k, s]) => {
        const m = k in matches ? (matches[k] ? ' [matches local copy]' : ' [DIFFERS from local copy]') : '';
        return k + ': ' + s + m;
      })
      .join(' | ');
    const entry = {
      timestamp: new Date().toISOString(),
      agent_name: 'DataLoader',
      action: 'load_data',
      input_summary: 'DATA_SOURCE=' + mode,
      output_summary: summary,
      target_agent: 'EvidenceTools',
      confidence: null,
      retry_count: 0,
      status: 'ok',
    };
    fs.appendFileSync(path.join(dir, 'trace.jsonl'), JSON.stringify(entry) + '\n');
  } catch {
    // logging must never break the agent
  }
}

export function loadData(root = process.cwd()) {
  const j = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const lines = fs
    .readFileSync(path.join(root, 'data/accounting/payments.csv'), 'utf8')
    .trim()
    .split(/\r?\n/);
  const head = lines[0].split(',');
  const payments = lines.slice(1).map((l) => {
    const c = l.split(',');
    const row = Object.fromEntries(head.map((h, i) => [h, c[i]]));
    row.amount = Number(row.amount);
    return row;
  });

  const data = {
    vendors: j('data/erp/vendors.json'),
    pos: j('data/erp/purchase_orders.json'),
    bankChanges: j('data/erp/bank_change_log.json'),
    payments,
    threads: j('data/email_archive/threads.json'),
    domains: j('data/security/domain_registry.json'),
    companies: j('data/external/company_registry.json'),
    contacts: j('data/personal/contacts.json'),
    policy: j('data/policy.json'),
    patterns: j('data/scam_patterns.json'),
  };

  const mode = (process.env.DATA_SOURCE || 'auto').toLowerCase();
  const sources = {};
  const matches = {};

  for (const [key, table] of Object.entries(ZETARIS_TABLES)) {
    sources[key] = 'local files';
    if (mode === 'local') continue;
    const file = path.join(root, 'zetaris_snapshot', table + '.json');
    if (!fs.existsSync(file)) continue;
    try {
      const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (snap.source !== 'zetaris' || !Array.isArray(snap.rows) || snap.rows.length === 0) continue;
      const rebuilt = rebuild(data[key], snap.rows);
      matches[key] = canon(rebuilt) === canon(data[key]);
      data[key] = rebuilt;
      sources[key] = 'Zetaris SCAMSHIELD.' + table + ' (fetched ' + snap.fetched_at + ')';
    } catch (e) {
      sources[key] = 'local files (Zetaris snapshot unreadable: ' + String(e.message).slice(0, 60) + ')';
    }
  }

  // Not part of the data itself, so it never shows up when code loops over the tables.
  Object.defineProperty(data, '_sources', { value: sources, enumerable: false });
  trace(root, mode, sources, matches);
  return data;
}
