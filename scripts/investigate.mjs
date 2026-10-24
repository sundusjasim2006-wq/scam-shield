// Usage:  node scripts/investigate.mjs input_examples/case01.json
//         node scripts/investigate.mjs --all      (runs every file in input_examples/)
import fs from 'node:fs';
import path from 'node:path';
import { loadData } from '../src/scamshield/data.mjs';
import { runTools } from '../src/scamshield/tools.mjs';
import { makeLogger } from '../src/scamshield/logger.mjs';

const arg = process.argv[2];
if (!arg) { console.log('Usage: node scripts/investigate.mjs <input.json | --all>'); process.exit(1); }
const files = arg === '--all'
  ? fs.readdirSync('input_examples').filter((f) => f.endsWith('.json')).sort().map((f) => path.join('input_examples', f))
  : [arg];
const db = loadData(), logger = makeLogger();

for (const f of files) {
  const input = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log(`\n=== ${input.id} | ${input.channel} | from ${input.sender}`);
  const out = runTools(input, db, logger);
  for (const r of out.results.filter((x) => x.severity !== 'none')) {
    console.log(`\n[${r.severity.toUpperCase()}] ${r.tool}: ${r.finding}`);
    r.evidence.forEach((e) => console.log(`   - ${e}`));
  }
  const n = (s) => out.results.filter((r) => r.severity === s).length;
  console.log(`\nSignals: ${out.signals.join(', ') || 'none'}`);
  console.log(`Evidence summary: ${n('high')} high, ${n('medium')} medium, ${n('low')} low`);
}
