import { loadWorkerModules } from '../../tests/integration/helpers/worker-modules.mjs';
import { randomUUID } from 'node:crypto';

const key = process.env.OPENCODE_GO_API_KEY;
if (!key) throw new Error('OPENCODE_GO_API_KEY unavailable; no requests sent');
const { extractDocumentGroups } = await loadWorkerModules();
const realFetch = globalThis.fetch;
const requests = [];
let stopped = false;
const memory = new Map();
const text = 'Weekly report. Progress pekerjaan: 5%. RISK R-1: Tower crane delivery is Open and rated High.';
const job = { jobId:'bounded-live',projectId:'bounded-live',documentId:'synthetic',fileName:'synthetic.txt',fileBuffer:new TextEncoder().encode(text).buffer };
process.env.XASS_LLM_PROVIDER = 'openai-compatible';
process.env.XASS_CLOUD_LLM_API_KEY = key;
process.env.XASS_CLOUD_LLM_BASE_URL = 'https://opencode.ai/zen/go/v1';
process.env.XASS_CLOUD_LLM_MODEL = 'glm-5.3-flash';
const jsonResponse = (data) => new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}]}),{status:200,headers:{'Content-Type':'application/json'}});
globalThis.fetch = async (_url, init) => {
  const input = JSON.parse(init.body);
  const prompt = input.messages?.[1]?.content ?? '';
  if (prompt.startsWith('Classify the entire document')) {
    const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
    return jsonResponse({ document_suggestions:{suggested_document_type:'progress_report',suggested_evidence_role:'current',classification_confidence:0.9,classification_reason:'Synthetic weekly report.',source_id:refs[0].source_id},quality_warning:null });
  }
  if (prompt.startsWith('Create a concise whole-document assurance summary')) {
    const data = JSON.parse(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m.exec(prompt)[1]);
    return jsonResponse({summary_text:'- Synthetic weekly report.',confidence:0.9,source_indexes:[data.sources[0].source_index]});
  }
  const task = prompt.includes('Task: analyze this bounded group') ? 'analysis' : 'domain';
  if (stopped || requests.length >= 2 || requests.some((entry) => entry.task === task) || Buffer.byteLength(prompt,'utf8') > 12000) {
    stopped = true;
    return new Response('{"error":{"message":"local live budget exhausted"}}',{status:429});
  }
  const row = {task,input_chars:Buffer.byteLength(prompt,'utf8')};
  requests.push(row);
  const t = performance.now();
  let response;
  try {
    response = await realFetch('https://opencode.ai/zen/go/v1/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`,'x-opencode-session':`bounded-${randomUUID()}`},
      body:JSON.stringify({...input,model:'glm-5.3-flash',max_tokens:4096,stream:false}),signal:AbortSignal.timeout(120000),
    });
  } catch {
    stopped = true; row.status = 'network_error'; row.elapsed_ms = Math.round(performance.now()-t);
    return new Response('{"error":{"message":"live request failed"}}',{status:503});
  }
  row.status=response.status;row.elapsed_ms=Math.round(performance.now()-t);
  const payload = await response.json().catch(()=>null);
  row.model=payload?.model ?? null;row.usage=payload?.usage ?? null;row.finish_reason=payload?.choices?.[0]?.finish_reason ?? null;
  if (!response.ok || row.finish_reason !== 'stop' || (row.usage?.completion_tokens ?? 0)>4096) stopped=true;
  if (!response.ok) return new Response('{"error":{"message":"live provider request failed"}}',{status:response.status});
  return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
};
try {
  const result=await extractDocumentGroups(job,[{chunkIndex:0,chunkText:text,sectionLabel:'Synthetic'}],{parserVersion:'bounded-live-v1'}, {
    async loadGroups(){return [...memory.values()]},async saveGroup(row){memory.set(row.groupKey,row)},
  });
  console.log(JSON.stringify({network_requests:requests,stopped,result_ok:result.ok,error_code:result.ok?null:result.errorCode,quality_warning_count:result.ok?result.extraction.quality_warnings.length:null,progress:result.ok?result.extraction.assurance_observations.progress.map(({percent})=>percent):null,checkpoints:[...memory.values()].map(({status})=>status),classification_and_summary:'mocked'},null,2));
} finally { globalThis.fetch = realFetch; }
