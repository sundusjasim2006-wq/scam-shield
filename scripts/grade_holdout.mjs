// Honest score on cases the agents have never been tuned on. Run it ONCE, at the end.
// Usage: node scripts/grade_holdout.mjs [folder] [truth.json]
//        (defaults: tests/fresh_holdout  tests/fresh_holdout_truth.json)
import fs from 'node:fs';
process.env.SAMPLE_MODE = 'true';
process.env.SCAMSHIELD_MEMORY = 'off';
const { loadData } = await import('../src/scamshield/data.mjs');
const { analyze } = await import('../src/scamshield/agents.mjs');

const dir = process.argv[2] || 'tests/fresh_holdout';
const truth = JSON.parse(fs.readFileSync(process.argv[3] || 'tests/fresh_holdout_truth.json', 'utf8'));
const db = loadData();
let right = 0;
for (const id of Object.keys(truth)) {
  const r = await analyze(JSON.parse(fs.readFileSync(`${dir}/${id}.json`, 'utf8')), db, null);
  const ok = r.verdict === truth[id].expected_verdict;
  if (ok) right++;
  console.log(`${id}  expected ${truth[id].expected_verdict.padEnd(12)} got ${r.verdict.padEnd(12)} ${ok ? 'OK' : 'MISMATCH'}  (confidence ${r.confidence})`);
  if (!ok) console.log(`      why: ${r.why}\n      note: ${truth[id].note}`);
}
console.log(`\nFresh hold-out score: ${right}/${Object.keys(truth).length}. Report this number as it is, whatever it is.`);
