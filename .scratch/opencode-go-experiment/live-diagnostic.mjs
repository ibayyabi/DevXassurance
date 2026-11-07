import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loadWorkerModules } from '../../tests/integration/helpers/worker-modules.mjs';

// One persistent ledger for the whole diagnostic, including failed dispatches.
const dir = resolve('.local-evaluation/production-live-diagnostic');
const ledgerFile = `${dir}/ledger.json`;
const maximumRequests = 4;
const maxTokens = 4096;
await mkdir(dir, { recursive: true });
let ledger;
try { ledger = JSON.parse(await readFile(ledgerFile, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  ledger = { requests: [], stopped: null };
  await writeFile(ledgerFile, JSON.stringify(ledger, null, 2), { flag: 'wx', mode: 0o600 });
}
if (!Array.isArray(ledger.requests) || ledger.requests.length > maximumRequests) throw new Error('Invalid budget ledger');
const save = async () => writeFile(ledgerFile, JSON.stringify(ledger, null, 2), { mode: 0o600 });
const key = process.env.OPENCODE_GO_API_KEY;
if (!key) throw new Error('OPENCODE_GO_API_KEY unavailable; no live calls');
const { extractDocumentGroups } = await loadWorkerModules();
const realFetch = globalThis.fetch;
const session = `bounded-${randomUUID()}`;
const rows = new Map();
const text = 'Weekly report. Progress pekerjaan: 5%. RISK R-1: Tower crane delivery is Open and rated High.';
const job = { jobId: 'diagnostic-live', projectId: 'diagnostic', documentId: 'synthetic', fileName: 'synthetic.txt', fileBuffer: new TextEncoder().encode(text).buffer };
process.env.XASS_LLM_PROVIDER = 'openai-compatible';
process.env.XASS_CLOUD_LLM_API_KEY = key;
process.env.XASS_CLOUD_LLM_BASE_URL = 'https://opencode.ai/zen/go/v1';
process.env.XASS_CLOUD_LLM_MODEL = 'glm-5.3-flash';
const reply = (value) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  const prompt = body.messages?.[1]?.content ?? '';
  if (prompt.startsWith('Classify the entire document')) {
    const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
    return reply({ document_suggestions: { suggested_document_type: 'progress_report', suggested_evidence_role: 'current', classification_confidence: 0.9, classification_reason: 'Synthetic weekly report.', source_id: refs[0].source_id }, quality_warning: null });
  }
  if (prompt.startsWith('Create a concise whole-document assurance summary')) {
    const input = JSON.parse(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m.exec(prompt)[1]);
    return reply({ summary_text: '- Synthetic weekly report.', confidence: 0.9, source_indexes: [input.sources[0].source_index] });
  }
  if (ledger.stopped || ledger.requests.length >= maximumRequests || Buffer.byteLength(prompt, 'utf8') > 12000) {
    ledger.stopped ??= 'budget_or_input_limit'; await save();
    return new Response('{"error":{"message":"local budget exhausted"}}', { status: 429 });
  }
  const task = prompt.includes('Task: analyze this bounded group') ? 'analysis' : 'domain';
  const correction = /Previous response validation errors:\n([\s\S]*?)\nReturn a corrected JSON object/.exec(prompt)?.[1] ?? null;
  const row = { task, prompt_chars: Buffer.byteLength(prompt, 'utf8'), prompt_sha256: createHash('sha256').update(prompt).digest('hex'), correction, dispatched_at: new Date().toISOString() };
  ledger.requests.push(row); await save(); // Reserve before network, even if request fails.
  const started = performance.now();
  let response;
  try {
    response = await realFetch('https://opencode.ai/zen/go/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'x-opencode-session': session },
      body: JSON.stringify({ ...body, model: 'glm-5.3-flash', max_tokens: maxTokens, stream: false }), signal: AbortSignal.timeout(120000),
    });
  } catch {
    row.status = 'network_error'; ledger.stopped = 'network_error'; await save();
    return new Response('{"error":{"message":"live network failure"}}', { status: 503 });
  }
  const payload = await response.json().catch(() => null);
  row.status = response.status; row.elapsed_ms = Math.round(performance.now() - started);
  row.model = payload?.model ?? null; row.usage = payload?.usage ?? null; row.finish_reason = payload?.choices?.[0]?.finish_reason ?? null;
  // Content is from this synthetic input only; keep it locally for validator replay.
  if (response.ok && typeof payload?.choices?.[0]?.message?.content === 'string') {
    await writeFile(`${dir}/response-${ledger.requests.length}.json`, JSON.stringify(payload.choices[0].message.content), { mode: 0o600 });
  }
  if (!response.ok || row.finish_reason !== 'stop' || (row.usage?.completion_tokens ?? 0) > maxTokens) ledger.stopped = 'provider_error_or_truncation';
  await save();
  if (!response.ok || !payload) return new Response('{"error":{"message":"live provider failure"}}', { status: response.status || 503 });
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
try {
  const result = await extractDocumentGroups(job, [{ chunkIndex: 0, chunkText: text, sectionLabel: 'Synthetic' }], { parserVersion: 'live-diagnostic-v1' }, {
    async loadGroups() { return [...rows.values()]; }, async saveGroup(row) { rows.set(row.groupKey, row); },
  });
  const output = { requests: ledger.requests, stopped: ledger.stopped, result_ok: result.ok, error_code: result.ok ? null : result.errorCode, error_message: result.ok ? null : result.errorMessage, warnings: result.ok ? result.extraction.quality_warnings : null, progress: result.ok ? result.extraction.assurance_observations.progress.map(({ percent }) => percent) : null, checkpoint: [...rows.values()].map(({ status, lastError }) => ({ status, lastError })), classification_and_summary: 'mocked' };
  await writeFile(`${dir}/result.json`, JSON.stringify(output, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(output, null, 2));
} finally { globalThis.fetch = realFetch; }
