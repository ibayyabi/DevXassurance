#!/usr/bin/env bash
# Reproducible, fully offline WBS provenance audit.
#
# Boundaries: no `.env*`, no API key/auth store, no provider/LLM call, no
# install, no commit, no production write, no fixture write. Existing experiment
# outputs are read-only; new artifacts go under .local-evaluation/opencode-go-exp-provenance/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

OUT=".local-evaluation/opencode-go-exp-provenance"
LOG="$OUT/logs"
FIXTURES="demo-evidence-fixtures/smart-building-itb/sessions"
SESSIONS=(2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7)
mkdir -p "$LOG" "$OUT/ooxml"

run() {
  local name="$1"
  shift
  echo "== $name ==" | tee "$LOG/$name.txt"
  "$@" 2>&1 | tee -a "$LOG/$name.txt"
}

run node-check-audit node --check "$SCRIPT_DIR/audit-wbs-provenance.mjs"
run node-check-prototype node --check "$SCRIPT_DIR/prototype-cell-aware-split.mjs"
run node-check-verifier node --check "$SCRIPT_DIR/verify-wbs-provenance.mjs"
run py-compile python3 -m py_compile "$SCRIPT_DIR/ooxml_reader.py" "$SCRIPT_DIR/test_ooxml_reader.py"
(cd "$SCRIPT_DIR" && python3 -m unittest -v test_ooxml_reader.py) 2>&1 | tee "$LOG/py-unit-tests.txt"

for session in "${SESSIONS[@]}"; do
  mkdir -p "$OUT/ooxml/$session"
  python3 "$SCRIPT_DIR/ooxml_reader.py" --out "$OUT/ooxml/$session" "$FIXTURES/$session"/*.xlsx \
    > "$LOG/ooxml-$session.txt" 2>&1
  echo "ooxml $session: $(ls "$OUT/ooxml/$session" | wc -l | tr -d ' ') files" | tee -a "$LOG/ooxml-$session.txt"
done

run audit node "$SCRIPT_DIR/audit-wbs-provenance.mjs" \
  --root .local-evaluation/opencode-go-exp-wbs/all-48 \
  --fixtures "$FIXTURES" \
  --out "$OUT"

run prototype node "$SCRIPT_DIR/prototype-cell-aware-split.mjs" \
  --audit-root "$OUT/audit" \
  --ooxml-root "$OUT/ooxml" \
  --out "$OUT/prototype"

run verify-provenance node "$SCRIPT_DIR/verify-wbs-provenance.mjs"
run verify-wbs-offline node "$SCRIPT_DIR/verify-wbs-offline.mjs"
run verify-v3 node "$SCRIPT_DIR/verify-v3.mjs"

mkdir -p "$OUT/baseline-smoke"
run baseline-smoke node "$SCRIPT_DIR/wbs-milestone-offline.mjs" --out "$OUT/baseline-smoke" --session 2026-10-30_w7 \
  "$FIXTURES/2026-10-30_w7/01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx" \
  "$FIXTURES/2026-10-30_w7/02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx" \
  "$FIXTURES/2026-10-30_w7/05_Pencahayaan_Subcontractor_Weekly.xlsx" \
  "$FIXTURES/2026-10-30_w7/07_Air_Bersih_Subcontractor_Weekly.xlsx"

node - <<'NODE' 2>&1 | tee "$LOG/baseline-smoke-compare.txt"
const fs=require("fs"),path=require("path");
const oldRoot=".local-evaluation/opencode-go-exp-wbs/all-48/2026-10-30_w7";
const newRoot=".local-evaluation/opencode-go-exp-provenance/baseline-smoke";
let diffs=[];
const files=fs.readdirSync(newRoot).filter((x)=>x.startsWith("WBS-"));
for(const f of files){
 const a=JSON.parse(fs.readFileSync(path.join(newRoot,f),"utf8"));
 const b=JSON.parse(fs.readFileSync(path.join(oldRoot,f),"utf8"));
 if(a.template!==b.template)diffs.push(`${f} template`);
 if(a.rows.length!==b.rows.length)diffs.push(`${f} rows`);
 for(let i=0;i<Math.min(a.rows.length,b.rows.length);i++){
  if(a.rows[i].code!==b.rows[i].code)diffs.push(`${f} row${i} code`);
  if(a.rows[i].percent.normalized!==b.rows[i].percent.normalized)diffs.push(`${f} row${i} pct`);
  if(a.rows[i].percent.cell_source_id!==b.rows[i].percent.cell_source_id)diffs.push(`${f} row${i} cellid`);
 }
 if(a.next_milestone.value!==b.next_milestone.value)diffs.push(`${f} milestone`);
}
console.log("baseline smoke diffs:",diffs.length?diffs.slice(0,20):"none","files",files.length);
if(diffs.length) process.exitCode=1;
NODE

mkdir -p "$OUT/score-wbs-baseline"
run score-baseline node "$SCRIPT_DIR/score-wbs-offline.mjs" \
  --root .local-evaluation/opencode-go-exp-wbs/all-48 \
  --out "$OUT/score-wbs-baseline"

run graphify-update graphify update .

echo "OK: artifacts in $OUT" | tee "$LOG/summary.txt"
