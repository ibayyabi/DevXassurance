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
const costEvidence = parse('src/features/assurance/lib/cost-evidence.ts');
const costQueries = parse('src/features/assurance/lib/cost-queries.ts');
const wbsComparison = load('src/features/assurance/lib/wbs-comparison.ts', {'./cost-evidence':costEvidence});
const scheduleComparison = load('src/features/assurance/lib/schedule-comparison.ts', {'./analysis':analysis,'./wbs-comparison':wbsComparison});
const riskComparison = parse('src/features/assurance/lib/risk-comparison.ts');
const reviewPeriod = parse('src/features/assurance/lib/review-period.ts');
const role = parse('src/features/projects/lib/roles.ts');
function fixture(options = {}) {
  const calls = [], uploads = [], removals = [], renders = [], inserts = [];
  const context = {
    attempt_id: 'attempt-1', evidence_count: 2,
    findings: ['budget','schedule','risk'].map(domain => ({ domain, condition: 'more_evidence_required',
      headline: 'Missing evidence', explanation: 'More evidence required', confirmation_state: 'ai_extracted' })), actions: [],
  };
  const coverage = ['budget','schedule','progress','risk'].map(domain => ({
    domain, state:'processed', total_groups:1, processed_groups:1, reason:null,
  }));
  const sources = ['base','current'].map((document_id,index) => ({
    document_id, role:index===0?'baseline':'current', title:index===0?'Baseline':'Current',
    source_version:{content_hash:index===0?'a'.repeat(64):'b'.repeat(64),parser_version:'parser/1',contract_version:'contract/1'},
    cost_observations:[], assurance_observations:[], assurance_observation_coverage:coverage,
  }));
  const supabase = {
    rpc: async (name, input) => {
      calls.push({name,input});
      if (options.rpc) { const override = options.rpc(name,input); if (override) return override; }
      if (name === 'claim_assurance_analysis') return {data:options.claim??{
        attempt_id:'attempt-1',sources,progress_decisions:[],
      }};
      if (input.p_operation === 'context') return {data:context};
      if (input.p_operation === 'export_check') return {data:{attempt_id:'attempt-1',report_fingerprint:'content-1',preview:{
        report_type:'assurance_report',reporting_period:'October 2026',original_sections:{project_health:'Saved content'},
        edited_sections:null,included_evidence_counts:{review_documents:2}}}};
      return {data:true,error:null};
    },
    from: table => {
      const rows = options.rows?.[table] ?? [];
      const query = {select(){return this},eq(){return this},in(){return this},order(){return this},limit(){return this},
        maybeSingle(){return Promise.resolve({data:table==='assurance_reviews'
          ? (options.existingReview === false ? null : {reporting_period:'2026-10-01',cutoff_precision:'month'})
          : table==='report_previews' ? {assurance_review_id:options.legacy?null:'review-1'} : null,error:options.lookupError})},
        insert(row){inserts.push({table,row});return Promise.resolve({data:null,error:options.insertError})},
        then(resolve){const data=table==='assurance_reviews'?[{id:'review-1',reporting_period:'2026-10-01',title:'October',status:'findings_ready'}]:rows;
          return Promise.resolve({data,error:options.queryError}).then(resolve)}};
      assert.ok(['assurance_reviews','report_previews','cost_baselines','cost_observations','wbs_mappings','milestone_mappings','risk_identity_mappings','risk_scale_mappings'].includes(table),`Unexpected table access ${table}`);
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
    '@/features/assurance/lib/cost-evidence':costEvidence,
    '@/features/assurance/lib/cost-queries':costQueries,
    '@/features/assurance/lib/wbs-comparison':wbsComparison,
    '@/features/assurance/lib/schedule-comparison':scheduleComparison,
    '@/features/assurance/lib/risk-comparison':riskComparison,
    '@/features/assurance/lib/review-period':reviewPeriod,
    '@/features/reports/lib/render-report':{renderReportPdf:async(input)=>{renders.push(input);return Buffer.from('PDF')},
      renderReportDocx:async(input)=>{renders.push(input);return Buffer.from('DOCX')}},
  };
  return {assurance:load('src/features/assurance/actions/assurance-actions.ts',dependencies),
    reports:load('src/features/reports/actions/report-actions.ts',dependencies),calls,uploads,removals,renders,inserts};
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
test('analysis publishes deterministic findings from the claimed versioned sources atomically',async()=>{
  const f=fixture();await f.assurance.runAssuranceAnalysis(form());
  const publication=f.calls.find(call=>call.name==='finish_assurance_analysis_with_results');
  assert.equal(publication?.input.p_attempt_id,'attempt-1');
  assert.deepEqual(publication?.input.p_findings.map(x=>x.domain).sort(),['budget','risk','schedule']);
  assert.equal(publication?.input.p_metadata.source_versions.length,2);
  assert.equal(publication?.input.p_metadata.source_versions[0].content_hash,'a'.repeat(64));
});
test('analysis findings retain source-version citations from validated observations',async()=>{
  const coverage = ['budget','schedule','progress','risk'].map(domain=>({
    domain,state:'processed',total_groups:1,processed_groups:1,reason:null,
  }));
  const source = (document_id,role,title,hash,assurance_observations) => ({
    document_id,role,title,
    source_version:{content_hash:hash,parser_version:'parser/1',contract_version:'contract/1'},
    cost_observations:[],assurance_observations,assurance_observation_coverage:coverage,
  });
  const observation = (id,domain,observation_type,value,page) => ({
    id,domain,observation_type,observation:value,evidence_chunk_index:2,
    excerpt:`Source excerpt ${id}`,page_number:page,section_label:'Evidence',
    source_location:{sheet:'Schedule',row:page},
  });
  const sources = [
    source('base','baseline','Approved baseline','a'.repeat(64),[
      observation('milestone-base','schedule','milestone',{
        label:'Go-live',date:'2026-03-01',scope_level:'project',scope_label:null,
        period_label:'Baseline',as_of_date:'2025-12-31',
      },4),
    ]),
    source('current','current','Current report','b'.repeat(64),[
      observation('milestone-current','schedule','milestone',{
        label:'Go-live',date:'2026-03-16',scope_level:'project',scope_label:null,
        period_label:'March 2026',as_of_date:'2026-03-31',
      },8),
      observation('risk-current','risk','risk_snapshot',{
        risk_id:'R-01',name:'Power interruption',status:'Open',rating_label:'Critical',
        rating_value:null,scale_label:'Qualitative',owner:null,mitigation:null,
      },10),
    ]),
  ];
  const f=fixture({claim:{attempt_id:'attempt-1',sources}});
  await f.assurance.runAssuranceAnalysis(form());
  const findings=f.calls.find(call=>call.name==='finish_assurance_analysis_with_results').input.p_findings;
  const schedule=findings.find(finding=>finding.domain==='schedule');
  assert.equal(schedule.condition,'critical');
  assert.deepEqual(schedule.sourceExcerpts.map(source=>source.documentId),['base','current']);
  assert.equal(schedule.sourceExcerpts[0].sourceContentHash,'a'.repeat(64));
  assert.equal(schedule.sourceExcerpts[1].pageNumber,8);
  const risk=findings.find(finding=>finding.domain==='risk');
  assert.equal(risk.condition,'critical');
  assert.equal(risk.sourceExcerpts[0].documentId,'current');
  assert.equal(risk.sourceExcerpts[0].pageNumber,10);
});
test('analysis preserves unprocessed coverage in its atomic result',async()=>{
  const coverage = ['budget','schedule','progress','risk'].map(domain=>({
    domain,state:domain==='schedule'?'unprocessed':'processed',total_groups:1,
    processed_groups:domain==='schedule'?0:1,
    reason:domain==='schedule'?'Schedule groups remain unprocessed.':null,
  }));
  const sources = ['base','current'].map((document_id,index)=>({
    document_id,role:index===0?'baseline':'current',title:index===0?'Approved baseline':'Current report',
    source_version:{content_hash:index===0?'a'.repeat(64):'b'.repeat(64),parser_version:'parser/1',contract_version:'contract/1'},
    cost_observations:[],assurance_observations:[],assurance_observation_coverage:coverage,
  }));
  const f=fixture({claim:{attempt_id:'attempt-1',sources,progress_decisions:[]}});
  await f.assurance.runAssuranceAnalysis(form());
  const publication=f.calls.find(call=>call.name==='finish_assurance_analysis_with_results');
  assert.equal(publication?.input.p_metadata.observation_coverage.byRole.baseline.schedule.state,'unprocessed');
  assert.equal(publication?.input.p_findings.find(finding=>finding.domain==='schedule').condition,'more_evidence_required');
});
test('a sibling document with unprocessed schedule coverage does not blank out a comparison another current document already supports',async()=>{
  const processedCoverage = ['budget','schedule','progress','risk'].map(domain=>({
    domain,state:'processed',total_groups:1,processed_groups:1,reason:null,
  }));
  const unprocessedScheduleCoverage = ['budget','schedule','progress','risk'].map(domain=>({
    domain,state:domain==='schedule'?'unprocessed':'processed',total_groups:1,
    processed_groups:domain==='schedule'?0:1,
    reason:domain==='schedule'?'W4 Alarm Kebencanaan schedule groups remain unprocessed.':null,
  }));
  const source=(document_id,role,title,hash,assurance_observations,coverage)=>({
    document_id,role,title,
    source_version:{content_hash:hash,parser_version:'parser/1',contract_version:'contract/1'},
    cost_observations:[],assurance_observations,assurance_observation_coverage:coverage,
  });
  const observation=(id,domain,observation_type,value,page)=>({
    id,domain,observation_type,observation:value,evidence_chunk_index:2,
    excerpt:`Source excerpt ${id}`,page_number:page,section_label:'Evidence',
    source_location:{sheet:'Schedule',row:page},
  });
  const sources=[
    source('base','baseline','Approved baseline','a'.repeat(64),[
      observation('milestone-base','schedule','milestone',{
        label:'Go-live',date:'2026-03-01',scope_level:'project',scope_label:null,
        period_label:'Baseline',as_of_date:'2025-12-31',
      },4),
    ],processedCoverage),
    source('current-master-gantt','current','Master Gantt','b'.repeat(64),[
      observation('milestone-current','schedule','milestone',{
        label:'Go-live',date:'2026-03-16',scope_level:'project',scope_label:null,
        period_label:'March 2026',as_of_date:'2026-03-31',
      },8),
    ],processedCoverage),
    source('current-w4-alarm','current','W4 Alarm Kebencanaan',(`c`.repeat(64)),[],unprocessedScheduleCoverage),
  ];
  const f=fixture({claim:{attempt_id:'attempt-1',sources,progress_decisions:[]}});
  await f.assurance.runAssuranceAnalysis(form());
  const publication=f.calls.find(call=>call.name==='finish_assurance_analysis_with_results');
  assert.equal(publication?.input.p_metadata.observation_coverage.byRole.current.schedule.state,'processed');
  const schedule=publication?.input.p_findings.find(finding=>finding.domain==='schedule');
  assert.equal(schedule.condition,'critical');
  assert.ok(!schedule.headline.includes('coverage gap'),schedule.headline);
  assert.match(schedule.explanation,/unprocessed/);
});
test('analysis errors finish only the owning attempt with a failure reason',async()=>{
  const f=fixture({queryError:{message:'Cost query failed'}});
  await assert.rejects(()=>f.assurance.runAssuranceAnalysis(form()),/Cost query failed/);
  const completion=f.calls.find(call=>call.name==='finish_assurance_analysis');
  assert.equal(completion?.input.p_attempt_id,'attempt-1');
  assert.match(completion?.input.p_error,/Cost query failed/);
  assert.equal(completion?.input.p_findings,undefined);
});
test('overlap claim errors prevent publication and publication errors are not ignored',async()=>{
  const f=fixture({rpc:name=>name==='claim_assurance_analysis'?{error:{message:'Already running'}}:null});
  await assert.rejects(()=>f.assurance.runAssuranceAnalysis(form()),/Already running/);
  assert.equal(f.calls.length,1);
  const broken=fixture({rpc:(name,input)=>{
    if(name==='finish_assurance_analysis_with_results')return {error:{message:'Publication rollback'}};
    if(name==='finish_assurance_analysis'&&input.p_error)return {data:true};
    return null;
  }});
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
test('createAssuranceReview stores the cut-off date as-is, with an Indonesian title',async()=>{
  const f=fixture({existingReview:false});
  await f.assurance.createAssuranceReview(form({reportingDate:'2026-10-16'}));
  assert.deepEqual(f.inserts,[{table:'assurance_reviews',row:{
    project_id:'project-1',reporting_period:'2026-10-16',
    cutoff_precision:'date',
    title:'16 Oktober 2026 Assurance Review',created_by:'user-1',
  }}]);
});
test('createAssuranceReview is idempotent per (project, date)',async()=>{
  const existing=fixture();
  await existing.assurance.createAssuranceReview(form({reportingDate:'2026-10-16'}));
  assert.equal(existing.inserts.length,0);
});
test('createAssuranceReview rejects a month-only or malformed cut-off date',async()=>{
  const f=fixture({existingReview:false});
  await assert.rejects(()=>f.assurance.createAssuranceReview(form({reportingDate:'2026-10'})),/valid reporting date/);
  await assert.rejects(()=>f.assurance.createAssuranceReview(form({reportingDate:'not-a-date'})),/valid reporting date/);
  assert.equal(f.inserts.length,0);
});
