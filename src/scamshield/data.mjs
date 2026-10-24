// Loads the company's scattered "systems" from data/. The agent reads ONLY data/ (never tests/).
import fs from 'node:fs';
import path from 'node:path';

export function loadData(root = process.cwd()) {
  const j = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const lines = fs.readFileSync(path.join(root, 'data/accounting/payments.csv'), 'utf8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const payments = lines.slice(1).map((l) => {
    const c = l.split(',');
    const row = Object.fromEntries(head.map((h, i) => [h, c[i]]));
    row.amount = Number(row.amount);
    return row;
  });
  return {
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
}
