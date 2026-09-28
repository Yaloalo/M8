// Writes dist/sw.js: precaches every built file so the tracker opens and plays offline.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else result.push(path);
  }
  return result;
}

const files = (await walk('dist')).filter((path) => !path.endsWith('sw.js'));
const hash = createHash('sha256');
for (const path of files) hash.update(await readFile(path));
const version = hash.digest('hex').slice(0, 12);
// Relative to the worker scope, because the app is built with base './'.
const urls = ['./', ...files.filter((p) => p !== 'dist/index.html').map((p) => './' + p.slice(5))];

const worker = `const CACHE='eight-static-${version}';
const PRECACHE=${JSON.stringify(urls)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PRECACHE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('eight-static-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
 const req=e.request;const url=new URL(req.url);if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(req.mode==='navigate'){e.respondWith(fetch(req).then(r=>r.ok?r:caches.match('./',{ignoreVary:true})).catch(()=>caches.match('./',{ignoreVary:true})));return;}
 e.respondWith(caches.match(req,{ignoreVary:true}).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const copy=r.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(req,copy)));}return r;})));
});
`;
await writeFile('dist/sw.js', worker);
console.log(`Offline worker: ${urls.length} assets, version ${version}.`);
