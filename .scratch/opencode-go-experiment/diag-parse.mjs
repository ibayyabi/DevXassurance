import {readFileSync,writeFileSync,unlinkSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname,join} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
const require=createRequire(import.meta.url); const ts=require("typescript");
const parserSource=fileURLToPath(new URL("../../worker/src/services/document-parser.ts",import.meta.url));
const zipSafetySource=fileURLToPath(new URL("../../src/features/documents/lib/zip-safety.ts",import.meta.url));
const uid=randomUUID();
const zm=join(dirname(zipSafetySource),`.diag-zip-${uid}.mjs`);
const pm=join(dirname(parserSource),`.diag-parser-${uid}.mjs`);
const compile=s=>ts.transpileModule(readFileSync(s,"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
writeFileSync(zm,compile(zipSafetySource));
writeFileSync(pm,compile(parserSource).replace('from "../../../src/features/documents/lib/zip-safety"',`from "${pathToFileURL(zm).href}"`));
try{
  const {parseDocumentBuffer}=await import(pathToFileURL(pm).href);
  const buf=readFileSync(process.argv[2]);
  const t0=Date.now();
  const r=await parseDocumentBuffer(process.argv[2].split("/").pop(), buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
  console.log("ms",Date.now()-t0,"ok",r.ok,"chunks",r.ok?r.chunks.length:r.errorCode,"chars",r.ok?r.chunks.reduce((a,c)=>a+(c.chunkText?.length||0),0):0);
  if(r.ok){ for(const c of r.chunks.slice(0,3)) console.log(c.chunkIndex, (c.chunkText||"").slice(0,120).replace(/\n/g,"|"));}
}finally{ try{unlinkSync(pm);unlinkSync(zm);}catch{} }
