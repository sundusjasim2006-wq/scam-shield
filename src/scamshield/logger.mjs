// Writes one JSON line per agent step to logs/trace.jsonl and prints a short line to the screen.
import fs from 'node:fs';
import path from 'node:path';

export function makeLogger(file = 'logs/trace.jsonl', { echo = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return {
    log(rec) {
      const entry = {
        timestamp: new Date().toISOString(),
        agent_name: 'EvidenceTools',
        action: 'tool_call',
        input_summary: '',
        output_summary: '',
        target_agent: null,
        confidence: null,
        retry_count: 0,
        status: 'success',
        ...rec,
      };
      fs.appendFileSync(file, JSON.stringify(entry) + '\n');
      if (echo === true || (echo === 'agents' && entry.agent_name !== 'EvidenceTools')) console.log(`  [trace] ${entry.agent_name} -> ${entry.target_agent || 'log'} | ${entry.action}: ${entry.output_summary}`);
    },
  };
}
