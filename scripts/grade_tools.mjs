// Grader for the evidence tools only. Reads tests/ground_truth.json (never the hold-out files).
// Usage: node scripts/grade_tools.mjs
import fs from 'node:fs';
import { loadData } from '../src/scamshield/data.mjs';
import { runTools } from '../src/scamshield/tools.mjs';

const db = loadData(), truth = JSON.parse(fs.readFileSync('tests/ground_truth.json', 'utf8'));
let covered = 0, calm = 0, okTotal = 0;
for (const id of Object.keys(truth)) {
  const file = `input_examples/${id}.json`;
  const out = runTools(JSON.parse(fs.readFileSync(file, 'utf8')), db);
  const missing = truth[id].expected_signals.filter((s) => !out.signals.includes(s));
  const highs = out.results.filter((r) => r.severity === 'high').length;
  if (!missing.length) covered++;
  if (truth[id].expected_verdict === 'OK') { okTotal++; if (!highs) calm++; }
  console.log(`${id}: ${missing.length ? 'MISSING ' + missing.join(', ') : 'all expected signals found'} | high-severity: ${highs}`);
}
console.log(`\nSignals covered in ${covered}/${Object.keys(truth).length} cases. Safe cases with no high-severity alarm: ${calm}/${okTotal}.`);
