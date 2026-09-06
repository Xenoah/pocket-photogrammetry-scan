import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {extractFeatures,Reconstruction} from '../dist/engine/sfm.mjs';
import {densePair,mergeChunks} from '../dist/engine/dense.mjs';
import {glb,ply,obj} from '../dist/export.mjs';
const require=createRequire(import.meta.url),cv=require('../dist/vendor/opencv.js');await new Promise(r=>cv.Mat?r():cv.onRuntimeInitialized=r);cv.setRNGSeed(42);
const dir=process.argv[2],photos=JSON.parse(fs.readFileSync(dir+'/meta.json')),images=photos.map((p,i)=>({width:p.width,height:p.height,data:new Uint8ClampedArray(fs.readFileSync(`${dir}/${String(i).padStart(3,'0')}.rgba`))}));
const started=Date.now(),features=images.map(image=>extractFeatures(cv,image,2200));console.log('features',features.map(f=>f.count));let saved;
const config={maxSparse:10000},io={features:i=>features[i],save:s=>{saved=structuredClone(s);},progress:p=>{if(p.stage!=='seed'||p.done%5===0)console.log(p.message,p.registered??'');},cancelled:()=>false};
const engine=new Reconstruction(cv,photos,config,io);const state=await engine.run(),result=await engine.result();assert.ok(result.registered>=10,`registered ${result.registered}`);assert.ok(result.positions.length/3>=200);assert.ok(result.medianError<2.5);
const pair=[0,2];assert.ok(state.poses[0]&&state.poses[2]);const dense=densePair(cv,images[0],images[2],state.poses[0],state.poses[2],photos[0].k,photos[2].k,5,16000);assert.ok(dense.positions.length/3>100,`dense ${dense.positions.length/3}`);assert.ok(dense.indices.length>30,`faces ${dense.indices.length/3}`);
const out=mergeChunks(result,[dense]);const g=glb(dense),gb=new Uint8Array(await g.arrayBuffer()),dv=new DataView(gb.buffer);assert.equal(dv.getUint32(8,true),gb.length);const jlen=dv.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(gb.subarray(20,20+jlen)));assert.equal(doc.accessors[0].count,dense.positions.length/3);assert.equal(doc.meshes[0].primitives[0].mode,4);assert.ok(Math.max(...dense.indices)<dense.positions.length/3);assert.ok((await ply(dense).arrayBuffer()).byteLength>dense.positions.byteLength);assert.ok((await obj(dense).text()).includes('\nf '));
fs.writeFileSync(dir+'/test-model.glb',gb);fs.writeFileSync(dir+'/report.json',JSON.stringify({test:'12 perspective images to 3D',registered:result.registered,sparse:result.positions.length/3,medianReprojectionPixels:result.medianError,dense:dense.positions.length/3,triangles:dense.indices.length/3,elapsedSeconds:(Date.now()-started)/1000},null,2));console.log(fs.readFileSync(dir+'/report.json','utf8'));
// Resume from a partial camera-registration checkpoint without redoing completed poses.
const resume=structuredClone(saved);resume.stage='align';resume.retry=0;resume.next=6;resume.poses[8]=null;resume.maps[8]=null;const resumed=new Reconstruction(cv,photos,config,io,resume);await resumed.run();assert.ok(resumed.state.poses[8]);console.log('checkpoint resume PASS');
