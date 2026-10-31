import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { libraryCode, documents, constants } from '../../tests/integration/document-library.test.mjs';
const require = createRequire(import.meta.url);
const webpack = require('next/dist/compiled/webpack/webpack').webpack;
const folder = path.resolve('.scratch/document-library');
const production = readFileSync('src/features/documents/components/document-intelligence.tsx', 'utf8');
const references = ts.transpileModule(production.slice(production.indexOf('const SourceNavigation ='), production.indexOf('export function DocumentIntelligence(')), {compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;
writeFileSync(path.join(folder, 'ts-loader.cjs'), `/* eslint-disable @typescript-eslint/no-require-imports */\nmodule.exports = function(source) { return require('typescript').transpileModule(source, { compilerOptions: { jsx: 4, module: 99, target: 9 } }).outputText; };`);
writeFileSync(path.join(folder, 'entry.js'), `
import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { FileClock, FileText, FileCheck2, RefreshCw, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fileKindLabel } from '@/features/documents/lib/file-types';
const {documentTypes, documentTypeLabels, statusLabels} = ${JSON.stringify(constants)};
const roleLabels = {baseline:'Approved Baseline',current:'Current Period',supporting:'Supporting Evidence'};
window.reviewActions = [];
const deleteDocument = async data => { window.reviewActions.push({action:'delete', values:Object.fromEntries(data)}); };
const retryDocumentProcessing = async data => { window.reviewActions.push({action:'retry', values:Object.fromEntries(data)}); };
const updateDocumentClassification = async data => { window.reviewActions.push({action:'review', values:Object.fromEntries(data)}); };
${references}
${libraryCode}
const documents = ${JSON.stringify(documents)};
for(let index=18;index<26;index++) documents.push({...documents[3],id:'doc-'+index,fileName:'Progress '+index+'.pdf',effectiveReportingPeriod:index===24?null:'2026-10',effectiveWorkstream:'Design',processingStatus:({18:'uploaded',19:'queued',20:'processing',21:'cancelled'})[index]||'completed'});
documents.forEach((item,index)=>item.createdAt=new Date(Date.UTC(2026,9,index+1)).toISOString());
documents[25].fileName='October-project-progress-evidence-with-a-very-long-original-filename-and-complete-source-identifiers-'.repeat(3)+'.pdf';
window.fixtureDocuments=documents;
const summaries = [{id:'summary-3',summaryText:'October progress evidence',selectedDocumentIds:['doc-25'],sources:[{id:'source-1',documentId:'doc-0',documentTitle:'Not sure report',location:'Page 4',excerpt:'Original source excerpt'}]}];
function Harness(){ const [sourceRequest,setSourceRequest]=useState(null); const [items,setItems]=useState(documents); window.replaceDocuments=setItems; return React.createElement(SourceNavigation.Provider,{value:id=>setSourceRequest({documentId:id})}, React.createElement(DocumentLibrary,{projectId:'project-1',documents:items,summaries,sourceRequest})); }
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`);
const compiler = webpack({mode:'development',devtool:false,entry:path.join(folder,'entry.js'),output:{path:folder,filename:'bundle.txt'},resolve:{extensions:['.js','.tsx','.ts'],alias:{'@':path.resolve('src')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(folder,'ts-loader.cjs')}]},optimization:{minimize:false}});
await new Promise((resolve,reject)=>compiler.run((error,stats)=>compiler.close(()=>{if(error)reject(error);else if(stats.hasErrors())reject(new Error(stats.toString({all:false,errors:true})));else {console.log('Built browser harness with production React components');resolve();}})));
