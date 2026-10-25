// The "memory moment". Run:  npx tsx scripts/memory_demo.mjs
// Story: a vendor our ERP has never heard of. The agent can only catch the changed bank account
// because it remembered what a human verified. Uses a throwaway memory folder, so it is repeatable.
import fs from 'node:fs';
const DIR = '.scamshield-memory-demo';
fs.rmSync(DIR, { recursive: true, force: true });
process.env.SCAMSHIELD_MEMORY_DIR = DIR;
const { loadData } = await import('../src/scamshield/data.mjs');
const { makeLogger } = await import('../src/scamshield/logger.mjs');
const { analyze } = await import('../src/scamshield/agents.mjs');
const { memoryStatus, learnFromOutcome, auditMemory } = await import('../src/scamshield/memory.mjs');

const st = await memoryStatus();
if (!st.enabled) { console.log(`H-MEM memory is not available: ${st.reason}`); process.exit(1); }
console.log(`H-MEM loaded from ${st.source}. Memory folder: ${DIR}\n`);
const db = loadData(), logger = makeLogger('logs/memory_demo_trace.jsonl', { echo: false });
const load = (f) => JSON.parse(fs.readFileSync(`demo/learning/${f}`, 'utf8'));
const show = (label, r) => {
  console.log(`${label}\n  verdict: ${r.verdict} (confidence ${r.confidence})`);
  r.evidence.filter((e) => e.startsWith('Memory')).forEach((e) => console.log(`  memory: ${e}`));
  console.log('');
};

const s1 = load('step1_first_invoice.json'), s2 = load('step2_repeat_invoice.json'), s3 = load('step3_changed_account.json');
show('1. COLD: the changed-account invoice with an empty memory', await analyze(s3, db, logger));
show('2. First invoice from a brand-new vendor', await analyze(s1, db, logger));
const learned = await learnFromOutcome(s1, db, 'verified_legitimate');
console.log(`3. A human calls the vendor and confirms it is genuine.\n  ${learned.ok ? learned.message : 'NOT REMEMBERED: ' + learned.reason}\n`);
show('4. Next month: same account', await analyze(s2, db, logger));
show('5. WARM: the changed-account invoice, after the agent has learned', await analyze(s3, db, logger));
if (learned.ok) {
  console.log(`6. Audit trail of ${learned.id} (H-MEM trust ledger):`);
  (await auditMemory(learned.id)).forEach((e) => console.log(`  - ${e.action} by ${e.actor} at ${new Date(e.timestamp).toISOString()}`));
}
