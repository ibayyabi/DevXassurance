import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkerModules, REPO_ROOT } from "../../tests/integration/helpers/worker-modules.mjs";
const { parseDocumentBuffer } = await loadWorkerModules();
for (const f of ["02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx","07_Air_Bersih_Subcontractor_Weekly.xlsx"]) {
  const p=join(REPO_ROOT,"demo-evidence-fixtures/smart-building-itb/sessions/2026-10-30_w7",f);
  const b=readFileSync(p); const ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
  const r=await parseDocumentBuffer(f,ab); if(!r.ok){console.log(f,r);continue;}
  const bad=[];
  for(const c of r.chunks){for(const s of c.sourceReferences??[]){if(s.cell && !c.chunkText.includes(s.text)) bad.push({id:s.sourceId,cell:s.cell.cell,label:s.cell.label,text:s.text.slice(0,80),row:c.sourceLocation?.rowStart,kind:c.sourceLocation?.rowEnd});}}
  console.log(f,"bad",bad.length, bad.slice(0,8));
}
