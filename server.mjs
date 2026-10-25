// Scam Shield server.  Start:  node server.mjs   (default http://localhost:8000)
//   GET  /            the screen          GET /health        status
//   GET  /api/samples example inputs      POST /run          JSON in, JSON verdict out
import http from 'node:http';
import fs from 'node:fs';
import { loadData } from './src/scamshield/data.mjs';
import { makeLogger } from './src/scamshield/logger.mjs';
import { analyze } from './src/scamshield/agents.mjs';
import { modelConfigured } from './src/scamshield/llm.mjs';

const PORT = Number(process.env.PORT || 8000);
const db = loadData();
const base = makeLogger('logs/trace.jsonl', { echo: false });
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((ok, bad) => {
  let b = '';
  req.on('data', (d) => { b += d; if (b.length > 100000) { bad(new Error('Request body too large')); req.destroy(); } });
  req.on('end', () => ok(b));
  req.on('error', bad);
});
const str = (v, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : null);

function clean(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('Send a JSON object, for example {"message": "..."}');
  if (typeof x.message !== 'string' || !x.message.trim()) throw new Error('"message" is required and must be text');
  const channel = ['email', 'sms', 'voice_transcript'].includes(x.channel) ? x.channel : 'email';
  return {
    id: str(x.id, 60) || `run-${Date.now()}`, channel, sender: str(x.sender, 200) || 'unknown',
    display_name: str(x.display_name, 200) || '', reply_to: str(x.reply_to, 200), subject: str(x.subject, 300),
    received_at: new Date().toISOString(), message: x.message.slice(0, 5000),
    links: Array.isArray(x.links) ? x.links.filter((l) => typeof l === 'string').slice(0, 10) : [], attachments: [],
    ...(x.safe_word_matched === true ? { safe_word_matched: true } : {}),
  };
}

http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) return send(res, 200, fs.readFileSync('ui/index.html', 'utf8'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url === '/health') return send(res, 200, { status: 'ok', mode: modelConfigured() ? 'model+evidence' : 'offline-evidence' });
    if (req.method === 'GET' && url === '/api/samples') {
      const list = fs.readdirSync('input_examples').filter((f) => f.endsWith('.json')).sort()
        .map((f) => JSON.parse(fs.readFileSync(`input_examples/${f}`, 'utf8')));
      return send(res, 200, list);
    }
    if (req.method === 'POST' && url === '/run') {
      let input;
      try { input = clean(JSON.parse(await readBody(req))); } catch (e) { return send(res, 400, { error: e.message }); }
      const events = [];
      const logger = { log: (rec) => { const e = base.log(rec); events.push(e); return e; } };
      const result = await analyze(input, db, logger);
      const trace = events.map((e) => ({ agent: e.agent_name, action: e.action, to: e.target_agent, summary: e.output_summary, confidence: e.confidence, status: e.status }));
      return send(res, 200, { ...result, trace });
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 500, { error: 'Something went wrong while analysing this request', detail: e.message });
  }
}).listen(PORT, '0.0.0.0', () => console.log(`Scam Shield running at http://localhost:${PORT}  (${modelConfigured() ? 'model + evidence' : 'offline evidence'} mode)`));
