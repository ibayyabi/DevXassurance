import {readFileSync} from "node:fs";
const exp = {
  planned: 0.2475, actual: 0.102, variance: -0.1455, rag: "Red",
  wbs: [1, 0.7, 0, 0, 0, 0, 0, 0],
  open_risks: ["R-SB02-001","R-SB02-002","R-SB02-003"],
  next_milestone: "2.1 Barang diterima (delivery note) - 06-Nov-2026",
  cutoff: "2026-10-30"
};
function score(model) {
  if (!model) return { total: 0, hits: 0, checks: [] };
  const checks = [];
  const eq = (name, got, want) => { checks.push({ name, got, want, ok: typeof got === "number" && Math.abs(got - want) <= 1e-9 }); };
  eq("planned", model.planned_percent, exp.planned);
  eq("actual", model.actual_percent, exp.actual);
  eq("variance", model.variance_percent, exp.variance);
  checks.push({ name: "rag", got: model.rag, want: exp.rag, ok: model.rag === exp.rag });
  checks.push({ name: "cutoff", got: model.cutoff, want: exp.cutoff, ok: model.cutoff === exp.cutoff });
  checks.push({ name: "next_ms", got: model.next_milestone, want: exp.next_milestone, ok: model.next_milestone === exp.next_milestone });
  const wbsOk = Array.isArray(model.wbs_percent_complete) && model.wbs_percent_complete.length === exp.wbs.length && model.wbs_percent_complete.every((v,i)=>Math.abs(v-exp.wbs[i])<1e-9);
  checks.push({ name: "wbs_array", got: model.wbs_percent_complete, want: exp.wbs, ok: wbsOk });
  const rOk = Array.isArray(model.open_risks) && [...model.open_risks].sort().join(",") === [...exp.open_risks].sort().join(",");
  checks.push({ name: "open_risks", got: model.open_risks, want: exp.open_risks, ok: rOk });
  return { total: checks.length, hits: checks.filter(c=>c.ok).length, checks };
}
for (const v of ["B","C"]) {
  try {
    const d = JSON.parse(readFileSync(`.local-evaluation/opencode-go-exp/${v}-02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx.json`,"utf8"));
    const s = score(d.model_output);
    console.log(`${v} score ${s.hits}/${s.total} delta=${JSON.stringify(d.delta)}`);
    for (const c of s.checks) console.log(`  ${c.ok?"✓":"✗"} ${c.name} got=${JSON.stringify(c.got)}`);
  } catch(e) { console.log(`${v} missing: ${e.message}`); }
}
