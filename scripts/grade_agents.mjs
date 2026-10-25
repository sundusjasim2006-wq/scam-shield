// Scores the agents' verdicts against tests/ground_truth.json (the 12 tuning cases only).
// Usage: node scripts/grade_agents.mjs      (always offline: no model key needed)
import fs from 'node:fs';
process.env.SAMPLE_MODE = 'true';
const { loadData } = await import('../src/scamshield/data.mjs');
const { analyze } = await import('../src/scamshield/agents.mjs');

const db = loadData(), truth = JSON.parse(fs.readFileSync('tests/ground_truth.json', 'utf8'));
let right = 0, falseAlarms = 0, missed = 0, protectedUsd = 0, atRisk = 0;
for (const id of Object.keys(truth)) {
  const r = await analyze(JSON.parse(fs.readFileSync(`input_examples/${id}.json`, 'utf8')), db, null);
  const t = truth[id], ok = r.verdict === t.expected_verdict;
  if (ok) right++;
  if (t.expected_verdict === 'OK' && r.verdict !== 'OK') falseAlarms++;
  if (t.expected_verdict !== 'OK') { atRisk += t.amount_at_risk_usd; if (r.verdict === 'OK') missed++; else protectedUsd += t.amount_at_risk_usd; }
  console.log(`${id}  expected ${t.expected_verdict.padEnd(12)} got ${r.verdict.padEnd(12)} ${ok ? 'OK' : 'MISMATCH'}  (confidence ${r.confidence}, ${r.rounds} round${r.rounds > 1 ? 's' : ''})`);
}
const n = Object.keys(truth).length;
console.log(`\nCorrect verdicts: ${right}/${n}. False alarms on safe cases: ${falseAlarms}. Scams missed: ${missed}.`);
console.log(`Money at risk in flagged cases: $${atRisk.toLocaleString()}; held back: $${protectedUsd.toLocaleString()}.`);
