// Runs the agents on every file in input_examples/ and saves the REAL outputs to output_examples/
// plus a fresh trace to logs/sample_run_trace.jsonl. Nothing is written by hand.
// Usage: node scripts/generate_outputs.mjs          (offline; set GENERATE_WITH_MODEL=1 to use your model key)
import fs from 'node:fs';
if (!process.env.GENERATE_WITH_MODEL) process.env.SAMPLE_MODE = 'true';
const { loadData } = await import('../src/scamshield/data.mjs');
const { makeLogger } = await import('../src/scamshield/logger.mjs');
const { analyze } = await import('../src/scamshield/agents.mjs');

fs.mkdirSync('output_examples', { recursive: true });
fs.mkdirSync('logs', { recursive: true });
const traceFile = 'logs/sample_run_trace.jsonl';
fs.writeFileSync(traceFile, '');
const db = loadData(), logger = makeLogger(traceFile, { echo: false });
for (const f of fs.readdirSync('input_examples').filter((x) => x.endsWith('.json')).sort()) {
  const input = JSON.parse(fs.readFileSync(`input_examples/${f}`, 'utf8'));
  const out = await analyze(input, db, logger);
  fs.writeFileSync(`output_examples/${f}`, JSON.stringify(out, null, 2));
  console.log(`${input.id}: ${out.verdict} (confidence ${out.confidence}) -> output_examples/${f}`);
}
console.log(`\nTrace written to ${traceFile}`);
