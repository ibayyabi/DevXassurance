import { writeFileSync } from 'node:fs';
const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };
async function read(table, params) {
  const rows = [];
  for (let start = 0; ; start += 500) {
    const url = new URL(`/rest/v1/${table}`, base);
    Object.entries({...params, limit: '500', offset: String(start)}).forEach(([key,value]) => url.searchParams.set(key,value));
    const response = await fetch(url, {headers});
    if (!response.ok) throw new Error(`${table} read failed: ${response.status}: ${(await response.text()).slice(0,300)}`);
    const page = await response.json(); rows.push(...page);
    if (page.length < 500) return rows;
  }
}
const projects = await read('projects', {select:'id,name',name:'ilike.*Smart Building*',order:'id'});
const candidates = await Promise.all(projects.map(async project => ({project,documents:await read('documents',{select:'id,file_name,processing_status,processing_error,created_at,updated_at', project_id:`eq.${project.id}`,order:'created_at.desc,id'})})));
console.log(JSON.stringify(candidates.map(({project,documents})=>({project,documents:documents.length,water:documents.filter(d=>d.file_name.includes('07_Air_Bersih')).map(d=>({name:d.file_name,status:d.processing_status}))})),null,2));
for (const candidate of candidates) {
  candidate.facts = await read('extracted_facts',{select:'id,fact_type,extracted_text,original_value,edited_value,confidence,confirmation_state,extraction_run_id,created_at,evidence_links(id,document_id,document_chunk_id,excerpt)',project_id:`eq.${candidate.project.id}`,order:'created_at.desc,id'});
  const water = candidate.documents.find(d=>d.file_name.includes('07_Air_Bersih'));
  console.log(JSON.stringify({projectId:candidate.project.id,facts:candidate.facts.length,waterFacts:candidate.facts.filter(f=>f.evidence_links.some(l=>l.document_id===water?.id)).length}));
}
const target = candidates.find(candidate=>candidate.facts.filter(f=>f.evidence_links.some(l=>l.document_id===candidate.documents.find(d=>d.file_name.includes('07_Air_Bersih'))?.id)).length===62);
if (!target) throw new Error('Cannot uniquely identify the screenshot project');
const projectId = target.project.id;
const facts = target.facts;
const jobs = await read('ai_jobs',{select:'*',project_id:`eq.${projectId}`,order:'created_at.desc,id'});
const runs = await read('extraction_runs',{select:'*',project_id:`eq.${projectId}`,order:'created_at.desc,id'});
const groups = await read('document_extraction_groups',{select:'*',project_id:`eq.${projectId}`,order:'created_at.desc,id'});
const data={...target,facts,jobs,runs,groups};
writeFileSync('.scratch/evidence-inspect/audit-data.json',JSON.stringify(data,null,2));
const types={};facts.forEach(f=>types[f.fact_type]=(types[f.fact_type]??0)+1);
console.log(JSON.stringify({projectId,facts:facts.length,types,jobs:jobs.length,runs:runs.length,groups:groups.length},null,2));
