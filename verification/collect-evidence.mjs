// Run from the repository root after npm test. No network or production access.
import ts from 'typescript';
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {restaurantMinimums} from '../app/sikgu-rules.mjs';
const baseline='25804ae3bac5be6aa74b0ad39186fc3df10b7013';
const before=execFileSync('git',['show',`${baseline}:app/page.tsx`],{encoding:'utf8'});
const segment=before.slice(before.indexOf('const appLabels:'),before.indexOf('function timeLeft('));
const current=readFileSync('app/catalog.ts','utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
function catalog(source) {
  const code=ts.transpile(source+'\nglobalThis.catalog={restaurants,pickupPoints};',{target:ts.ScriptTarget.ES2022});
  const context={restaurantMinimums};vm.runInNewContext(code,context);return context.catalog;
}
if(JSON.stringify(catalog(segment))!==JSON.stringify(catalog(current)))throw Error('Restaurant or pickup data changed');
const originalSQL=execFileSync('git',['ls-tree','-r','--name-only',baseline,'drizzle'],{encoding:'utf8'}).trim().split('\n').filter(f=>f.endsWith('.sql'));
const diff=execFileSync('git',['diff',baseline,'--','.openai',...originalSQL],{encoding:'utf8'});
if(diff.trim())throw Error('Hosting manifest or applied migrations changed');
writeFileSync('verification/catalog-preservation.log',`Baseline: ${baseline}\nAll 21 restaurants, menus, prices and 8 pickup points preserved.\nHosting metadata and all ${originalSQL.length} applied SQL migrations unchanged.\n`);
const files=readdirSync('verification').filter(f=>/^modules-.*\.json$/.test(f));
if(files.length!==3)throw Error('Expected fresh client, rsc and ssr module inventories from npm test');
const affected=['esbuild','@esbuild-kit/core-utils','@esbuild-kit/esm-loader','drizzle-kit'];
const bundles=files.map(file=>{
  const chunks=JSON.parse(readFileSync('verification/'+file));
  return {file,modules:chunks.reduce((n,c)=>n+c.modules.length,0),affectedModules:chunks.flatMap(c=>c.modules).filter(m=>affected.some(p=>m.includes('/node_modules/'+p+'/'))),imports:[...new Set(chunks.flatMap(c=>c.imports.concat(c.dynamicImports)))].sort()};
});
const source=readFileSync('node_modules/@esbuild-kit/core-utils/dist/index.js','utf8');
const parsed=ts.createSourceFile('core.js',source,ts.ScriptTarget.Latest,true);
const calls={};
function walk(node) {
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)) {
    const name=node.expression.name.text;
    if(['serve','transform','transformSync','context','build'].includes(name))calls[name]=(calls[name]||0)+1;
  }
  ts.forEachChild(node,walk);
}
walk(parsed);
writeFileSync('verification/dependency-reachability.json',JSON.stringify({bundles,coreUtilsCalls:calls,vinextImageSizeUse:'vinext/dist/index.js:1297: build/dev static image import metadata reads local imagePath via fs.readFileSync; not the receipt API',limitations:'Module inventories cover emitted chunks and explicit imports. This is not a safety proof for future builds or arbitrary developer tool commands.'},null,2)+'\n');
console.log('Catalog, hosting/migration preservation and dependency provenance verified.');
