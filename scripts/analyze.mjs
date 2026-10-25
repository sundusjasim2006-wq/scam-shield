// Usage:  node scripts/analyze.mjs input_examples/case01.json     (or --all)
// Runs Investigator -> Skeptic -> Judge. Works offline; uses a model only if MODEL_API_KEY is set.
import fs from 'node:fs';
import path from 'node:path';
import { loadData } from '../src/scamshield/data.mjs';
import { makeLogger } from '../src/scamshield/logger.mjs';
import { analyze } from '../src/scamshield/agents.mjs';

const arg = process.argv[2];
if (!arg) { console.log('Usage: node scripts/analyze.mjs <input.json | --all>'); process.exit(1); }
const files = arg === '--all' ? fs.readdirSync('input_examples').filter((f) => f.endsWith('.json')).sort().map((f) => path.join('input_examples', f)) : [arg];
const db = loadData(), logger = makeLogger('logs/trace.jsonl', { echo: 'agents' });

for (const f of files) {
  const input = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log(`\n=== ${input.id} | ${input.channel} | from ${input.sender}`);
  const r = await analyze(input, db, logger);
  console.log(`\nVERDICT: ${r.verdict}   confidence ${r.confidence}   (${r.mode})`);
  console.log(`Why: ${r.why}`);
  console.log(`Skeptic: ${r.skeptic_view}`);
  r.evidence.forEach((e) => console.log(`  - ${e}`));
  console.log(`Safe action: ${r.safe_action}`);
}
