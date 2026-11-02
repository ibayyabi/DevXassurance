import {readFileSync,writeFileSync} from 'node:fs';
const data=JSON.parse(readFileSync('.scratch/evidence-inspect/audit-data.json','utf8'));
const count=rows=>rows.reduce((out,f)=>(out[f.fact_type]=(out[f.fact_type]??0)+1,out),{});
const docIds=f=>[...new Set(f.evidence_links.map(l=>l.document_id))];
const duplicates=new Map();
for(const fact of data.facts)for(const documentId of docIds(fact)){
  const key=JSON.stringify([documentId,fact.extracted_text.trim()]);
  const list=duplicates.get(key)??[];list.push(fact);duplicates.set(key,list);
}
const repeated=[...duplicates].filter(([,rows])=>rows.length>1).map(([key,rows])=>({documentId:JSON.parse(key)[0],text:rows[0].extracted_text,ids:rows.map(f=>f.id),types:rows.map(f=>f.fact_type),runs:[...new Set(rows.map(f=>f.extraction_run_id))]}));
const perDocument=data.documents.map(doc=>({...doc,counts:count(data.facts.filter(f=>docIds(f).includes(doc.id))),total:data.facts.filter(f=>docIds(f).includes(doc.id)).length}));
const water=perDocument.find(d=>d.file_name.includes('07_Air_Bersih'));
const result={project:data.project,totals:count(data.facts),old20:count(data.facts.slice(0,20)),old20Ids:data.facts.slice(0,20).map(f=>f.id),total:data.facts.length,unlinked:data.facts.filter(f=>!docIds(f).length).length,multiDocument:data.facts.filter(f=>docIds(f).length>1).length,reviewStates:data.facts.reduce((out,f)=>(out[f.confirmation_state]=(out[f.confirmation_state]??0)+1,out),{}),perDocument,duplicates:{groups:repeated.length,extraRows:repeated.reduce((n,g)=>n+g.ids.length-1,0),examples:repeated.slice(0,8)},water:{document:water,jobs:data.jobs.filter(j=>j.document_id===water.id),runs:data.runs.filter(r=>r.document_id===water.id),factTimes:[...new Set(data.facts.filter(f=>docIds(f).includes(water.id)).map(f=>f.created_at))],groups:data.groups.filter(g=>g.document_id===water.id).map(({id,status,chunk_start_index,chunk_end_index,error_code,error_message,updated_at})=>({id,status,chunk_start_index,chunk_end_index,error_code,error_message,updated_at}))},weeklyMilestoneExamples:data.facts.filter(f=>f.fact_type==='milestone'&&docIds(f).some(id=>data.documents.find(d=>d.id===id)?.file_name.includes('Weekly'))).slice(0,12).map(f=>({id:f.id,text:f.extracted_text,original:f.original_value,sources:f.evidence_links}))};
writeFileSync('.scratch/evidence-inspect/audit-summary.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,old20Ids:undefined,perDocument:perDocument.slice(0,10),water:{...result.water,groups:result.water.groups.slice(0,4)},weeklyMilestoneExamples:result.weeklyMilestoneExamples.slice(0,5)},null,2));
