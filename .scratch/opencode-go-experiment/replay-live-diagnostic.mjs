import { readFile } from 'node:fs/promises';
import { loadWorkerModules } from '../../tests/integration/helpers/worker-modules.mjs';
const dir = '.local-evaluation/production-live-diagnostic';
const saved = await Promise.all([1,2,3,4].map(async (n) => JSON.parse(await readFile(`${dir}/response-${n}.json`, 'utf8'))));
const { extractDocumentGroups } = await loadWorkerModules();
const text = 'Weekly report. Progress pekerjaan: 5%. RISK R-1: Tower crane delivery is Open and rated High.';
const job = { jobId:'replay',projectId:'replay',documentId:'synthetic',fileName:'synthetic.txt',fileBuffer:new TextEncoder().encode(text).buffer };
const savedFetch=globalThis.fetch;
process.env.XASS_LLM_PROVIDER='ollama';process.env.OLLAMA_BASE_URL='http://replay.invalid';process.env.OLLAMA_MODEL='replay';
const reply = (value) => new Response(JSON.stringify({message:{content:typeof value==='string'?value:JSON.stringify(value)}}),{status:200});
async function run(analysisResponses,domainResponses) {
  let ai=0,di=0;const rows=new Map(), corrections=[];
  globalThis.fetch=async (_url,init)=>{
    const prompt=JSON.parse(init.body).messages[1].content;
    if(prompt.startsWith('Classify the entire document')) {
      const refs=JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
      return reply({document_suggestions:{suggested_document_type:'progress_report',suggested_evidence_role:'current',classification_confidence:0.9,classification_reason:'Synthetic weekly report.',source_id:refs[0].source_id},quality_warning:null});
    }
    if(prompt.startsWith('Create a concise whole-document assurance summary')) {
      const input=JSON.parse(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m.exec(prompt)[1]);
      return reply({summary_text:'- Synthetic weekly report.',confidence:0.9,source_indexes:[input.sources[0].source_index]});
    }
    const correction=/Previous response validation errors:\n([\s\S]*?)\nReturn a corrected JSON object/.exec(prompt)?.[1];
    if(correction) corrections.push(correction);
    const analysis=prompt.includes('Task: analyze this bounded group');
    return reply(analysis?analysisResponses[Math.min(ai++,analysisResponses.length-1)]:domainResponses[Math.min(di++,domainResponses.length-1)]);
  };
  const result=await extractDocumentGroups(job,[{chunkIndex:0,chunkText:text,sectionLabel:'Synthetic'}],{parserVersion:'live-diagnostic-v1'}, {async loadGroups(){return [...rows.values()]},async saveGroup(row){rows.set(row.groupKey,row)}});
  return {ok:result.ok,progress:result.ok?result.extraction.assurance_observations.progress.map(({percent})=>percent):null,facts:result.ok?result.extraction.facts.map(({fact_type,extracted_text})=>({fact_type,extracted_text})):null,warnings:result.ok?result.extraction.quality_warnings:null,checkpoints:[...rows.values()].map(({status,lastError})=>({status,lastError})),corrections};
}
try {
  const historical=await run([saved[0],saved[2]],[saved[1],saved[3]]);
  const validPair=await run([saved[0]],[saved[3]]);
  console.log(JSON.stringify({historical,validPair,network_calls:0},null,2));
  if(!historical.corrections.some((x)=>x.includes('period_label')) || !historical.warnings.some((x)=>x.includes('sheet_interpretation')) || historical.checkpoints[0]?.status!=='failed' || !validPair.ok || !validPair.progress.includes(5)) process.exitCode=1;
  // Semantic safety (schema /38): the saved analysis response types a progress
  // percentage as a milestone. The valid pair must NOT publish it as verified:
  // the fact is excluded with the semantic guard message, the risk fact and the
  // progress observation survive, and the group is checkpointed failed (not
  // reusable) instead of completing cleanly around the unsupported claim.
  if(!validPair.facts.some((fact)=>fact.fact_type==='risk') || validPair.facts.some((fact)=>fact.fact_type==='milestone') || !validPair.warnings.some((x)=>x.includes('types a progress percentage as a milestone')) || validPair.checkpoints[0]?.status!=='failed') process.exitCode=1;
} finally {globalThis.fetch=savedFetch}
