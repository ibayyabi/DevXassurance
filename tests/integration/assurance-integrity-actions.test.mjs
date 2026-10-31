import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function load(path, dependencies) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
    return dependencies[id];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const parse = path => load(path, {});
const analysis = parse('src/features/assurance/lib/analysis.ts');
const source = parse('src/features/assurance/lib/source-evidence.ts');
const prompt = parse('src/features/assurance/lib/review-prompt.ts');
const role = parse('src/features/projects/lib/roles.ts');
const extraction = {
  budget: { baseline_amount: null, current_forecast: null, current_actual: null, currency: null,
    baseline_excerpt: null, current_excerpt: null, confidence: 0.9 },
  schedule: { milestones: [], confidence: 0.9 },
  risk: { has_current_evidence: false, open_critical_count: 0, open_high_count: 0,
    high_risks_missing_owner_or_mitigation: 0, increased_risk_count: 0, new_high_risk_count: 0,
    max_mitigation_overdue_days: 0, baseline_excerpt: null, current_excerpt: null, confidence: 0.9 },
};
function fixture(options = {}) {
  const calls = [], model = [], uploads = [], removals = [], renders = [];
  const context = {
    attempt_id: 'attempt-1', evidence_count: 2,
    findings: ['budget','schedule','risk'].map(domain => ({ domain, condition: 'more_evidence_required',
      headline: 'Missing evidence', explanation: 'More evidence required', confirmation_state: 'ai_extracted' })), actions: [],
  };
  const supabase = {
    rpc: async (name, input) => {
      calls.push({name,input});
      if (options.rpc) { const override = options.rpc(name,input); if (override) return override; }
      if (name === 'claim_assurance_analysis') return {data:{attempt_id:'attempt-1',baseline_ids:['base'],current_ids:['current'],
        chunks:[{document_id:'base',chunk_text:'Fingerprint-bound source text',page_number:1,documents:{title:'Plan'}}]}};
      if (input.p_operation === 'context') return {data:context};
      if (input.p_operation === 'export_check') return {data:{attempt_id:'attempt-1',report_fingerprint:'content-1',preview:{
        report_type:'assurance_report',reporting_period:'October 2026',original_sections:{project_health:'Saved content'},
        edited_sections:null,included_evidence_counts:{review_documents:2}}}};
      return {data:true,error:null};
    },
    from: table => {
      const query = {select(){return this},eq(){return this},order(){return this},limit(){return this},
        maybeSingle(){return Promise.resolve({data:{assurance_review_id:options.legacy ? null : 'review-1'},error:options.lookupError})},
        then(resolve){return Promise.resolve({data:[{id:'review-1',reporting_period:'2026-10-01'}]}).then(resolve)}};
      assert.ok(['assurance_reviews','report_previews'].includes(table),`Unexpected table access ${table}`);
      return query;
    },
    storage:{from:()=>({upload:async(path)=>{uploads.push(path);return {error:options.uploadError}},
      remove:async(paths)=>{removals.push(paths);return {data:options.cleanupDenied?[]:paths.map(name=>({name})),error:options.cleanupError}}})},
  };
  const dependencies={
    'next/cache':{revalidatePath(){}},
    '@/features/projects/lib/queries':{requireProjectMembership:async()=>({supabase,user:{id:'user-1'},membership:{role:options.role??'admin',projectName:'Project'}})},
    '@/features/projects/lib/roles':role,
    '@/features/assurance/lib/analysis':analysis,
    '@/features/assurance/lib/source-evidence':source,
    '@/features/assurance/lib/review-prompt':prompt,
    '@/lib/ai/ollama':{parseJsonObject:JSON.parse,runOllamaChat:async(input)=>{
      model.push(input); if(options.modelThrow) throw new Error('Transport failed');
      return options.modelResult ?? {ok:true,content:JSON.stringify(extraction),provider:'fixture',model:'fixture'};
    }},
    '@/features/reports/lib/render-report':{renderReportPdf:async(input)=>{renders.push(input);return Buffer.from('PDF')},
      renderReportDocx:async(input)=>{renders.push(input);return Buffer.from('DOCX')}},
  };
  return {assurance:load('src/features/assurance/actions/assurance-actions.ts',dependencies),
    reports:load('src/features/reports/actions/report-actions.ts',dependencies),calls,model,uploads,removals,renders};
}
function form(extra={}) {
  const data=new FormData();
  for(const [key,value]of Object.entries({projectId:'project-1',reviewId:'review-1',...extra})) data.append(key,value);
  return data;
}

test('evidence action delegates no-op detection to the atomic RPC and propagates DB failure',async()=>{
  const f=fixture();await f.assurance.saveReviewEvidence(form({baselineDocumentIds:'base',currentDocumentIds:'current'}));
  assert.deepEqual(f.calls[0],{name:'save_assurance_evidence',input:{p_project_id:'project-1',p_review_id:'review-1',p_baseline_ids:['base'],p_current_ids:['current']}});
  const broken=fixture({rpc:()=>({error:{message:'Selection transaction failed'}})});
  await assert.rejects(()=>broken.assurance.saveReviewEvidence(form({baselineDocumentIds:'base',currentDocumentIds:'current'})),/transaction failed/);
});
test('analysis uses claim-bound chunks and publishes all domains under its attempt identity',async()=>{
  const f=fixture();await f.assurance.runAssuranceAnalysis(form());
  assert.match(f.model[0].user,/Fingerprint-bound source text/);
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].name,'finish_assurance_analysis');
  assert.equal(f.calls[1].input.p_attempt_id,'attempt-1');
  assert.deepEqual(f.calls[1].input.p_findings.map(x=>x.domain).sort(),['budget','risk','schedule']);
});
test('model failure and thrown errors record failure only with the owning attempt',async()=>{
  for(const options of [{modelResult:{ok:false,warning:'Unavailable'}},{modelThrow:true}]){
    const f=fixture(options);
    if(options.modelThrow)await assert.rejects(()=>f.assurance.runAssuranceAnalysis(form()),/Transport failed/);
    else await f.assurance.runAssuranceAnalysis(form());
    assert.equal(f.calls[1].input.p_attempt_id,'attempt-1');assert.ok(f.calls[1].input.p_error);
    assert.equal(f.calls[1].input.p_findings,undefined);
  }
});
test('overlap claim errors prevent model calls and publication errors are not ignored',async()=>{
  const f=fixture({rpc:name=>name==='claim_assurance_analysis'?{error:{message:'Already running'}}:null});
  await assert.rejects(()=>f.assurance.runAssuranceAnalysis(form()),/Already running/);assert.equal(f.model.length,0);
  const broken=fixture({rpc:(name,input)=>name==='finish_assurance_analysis'&&!input.p_error?{error:{message:'Publication rollback'}}:null});
  await assert.rejects(()=>broken.assurance.runAssuranceAnalysis(form()),/Publication rollback/);
  assert.equal(broken.calls.at(-1).input.p_error,'Publication rollback');
});
test('report generation checks context then persists with the same successful analysis',async()=>{
  const f=fixture();await f.reports.generateReportPreview(form({assuranceReviewId:'review-1',audience:'Sponsor',detailLevel:'Concise'}));
  assert.equal(f.calls[0].input.p_operation,'context');assert.equal(f.calls[1].input.p_operation,'create');
  assert.equal(f.calls[1].input.p_attempt_id,'attempt-1');
  assert.match(f.calls[1].input.p_payload.sections.project_health,/More Evidence Required/);
});
test('stale report context and stale approval are rejected before further writes',async()=>{
  const f=fixture({rpc:()=>({error:{message:'Analysis is not current'}})});
  await assert.rejects(()=>f.reports.generateReportPreview(form({audience:'Sponsor',detailLevel:'Concise'})),/not current/);
  await assert.rejects(()=>f.reports.markReportReviewed(form({previewId:'preview-1'})),/not current/);
  const legacy=fixture({legacy:true});await assert.rejects(()=>legacy.reports.markReportReviewed(form({previewId:'preview-1'})),/current analysis/);
  assert.equal(legacy.calls.length,0);
});
test('export validates before rendering, revalidates after upload, and cleans obsolete output',async()=>{
  const f=fixture({rpc:(_name,input)=>input.p_operation==='export_finish'?{error:{message:'Analysis changed'}}:null});
  await assert.rejects(()=>f.reports.exportReport(form({previewId:'preview-1',format:'pdf'})),/Analysis changed/);
  assert.equal(f.calls[0].input.p_operation,'export_check');assert.equal(f.calls[1].input.p_operation,'export_finish');
  assert.equal(f.calls[1].input.p_attempt_id,'attempt-1');assert.equal(f.calls[1].input.p_payload.report_fingerprint,'content-1');
  assert.equal(f.uploads.length,1);assert.deepEqual(f.removals,[[f.uploads[0]]]);
  const stale=fixture({rpc:()=>({error:{message:'Not current'}})});
  await assert.rejects(()=>stale.reports.exportReport(form({previewId:'preview-1',format:'pdf'})),/Not current/);
  assert.equal(stale.renders.length,0);assert.equal(stale.uploads.length,0);
});
test('restricted server action callers cannot claim or approve',async()=>{
  const f=fixture({role:'pmo_reviewer'});
  await assert.rejects(()=>f.assurance.runAssuranceAnalysis(form()),/cannot manage/);
  await assert.rejects(()=>f.reports.markReportReviewed(form({previewId:'preview-1'})),/cannot manage/);
  assert.equal(f.calls.length,0);
});
test('unregistered upload cleanup failures are explicit without changing storage permissions',async()=>{
  const f=fixture({cleanupDenied:true,rpc:(_name,input)=>input.p_operation==='export_finish'?{error:{message:'Analysis changed'}}:null});
  await assert.rejects(()=>f.reports.exportReport(form({previewId:'preview-1',format:'pdf'})),/Unregistered private export may require cleanup/);
});
