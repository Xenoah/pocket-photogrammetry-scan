import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the update/cache protocol without a browser or user photo data.
const scope='https://pocketscan.test/',handlers=new Map(),stores=new Map(),requests=[];
let activated=0,claimed=0,offline=false,networkVersion='0.2.0';
const key=request=>new URL(typeof request==='string'?request:request.url||request.href,scope).pathname;
const cache={
  async put(request,response){stores.get('pocketscan-0.2.0').set(key(request),response);},
  async match(request){return stores.get('pocketscan-0.2.0').get(key(request));}
};
stores.set('pocketscan-v1.0.0',new Map());stores.set('unrelated-app',new Map());
const context=vm.createContext({URL,Request,Response,
  self:{location:new URL(scope),registration:{scope},clients:{claim:async()=>{claimed++;}},skipWaiting:async()=>{activated++;},addEventListener:(name,fn)=>handlers.set(name,fn)},
  caches:{open:async name=>{if(!stores.has(name))stores.set(name,new Map());return cache;},keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name)},
  fetch:async request=>{if(offline)throw Error('offline');requests.push(request);const response=new Response(networkVersion);Object.defineProperty(response,'url',{value:request.url});return response;}
});
vm.runInContext(fs.readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8'),context);
async function dispatch(name,event={}){let completion;handlers.get(name)({...event,waitUntil:p=>completion=p,respondWith:p=>completion=p});return await completion;}
await dispatch('install');
assert.equal(activated,0,'installation must wait for safe activation');
for(const request of requests){const path=new URL(request.url).pathname;assert.ok(fs.existsSync(new URL('../dist'+(path==='/'?'/index.html':path),import.meta.url)),`missing cached asset ${path}`);}
assert.ok(stores.get('pocketscan-0.2.0').has('/run-state.mjs'));
let version;await dispatch('message',{data:{type:'GET_VERSION'},ports:[{postMessage:value=>version=value.version}]});assert.equal(version,'0.2.0');
await dispatch('message',{data:{type:'ACTIVATE_UPDATE'}});assert.equal(activated,1);
await dispatch('activate');assert.equal(claimed,1);assert.ok(!stores.has('pocketscan-v1.0.0'));assert.ok(stores.has('unrelated-app'));
// Future update entrypoints must bypass old app caches; normal app code stays offline-ready.
networkVersion='0.3.0';
let response=await dispatch('fetch',{request:new Request(scope+'update.mjs')});assert.equal(await response.text(),'0.3.0');assert.equal(requests.at(-1).cache,'no-store');
offline=true;
response=await dispatch('fetch',{request:new Request(scope+'update.mjs')});assert.equal(await response.clone().text(),'0.2.0');
response=await dispatch('fetch',{request:new Request(scope+'app.mjs')});assert.equal(await response.text(),'0.2.0');
console.log('Service Worker: safe activation, version handoff, cache replacement, fresh update entrypoint, offline fallback PASS');
