import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {extractFeatures,Reconstruction,seedPairs,reconstructWithFallback} from '../dist/engine/sfm.mjs';
import {featureAlgorithms,configKey} from '../dist/policy.mjs';
import {restoreRun,runPresentation} from '../dist/run-state.mjs';
const require=createRequire(import.meta.url),cv=require('../dist/vendor/opencv.js');await new Promise(r=>cv.Mat?r():cv.onRuntimeInitialized=r);cv.setRNGSeed(42);
const dir=process.argv[2]||'./pocketscan-fixtures',meta=JSON.parse(fs.readFileSync(dir+'/meta.json'));
const frame=i=>({width:640,height:480,data:new Uint8ClampedArray(fs.readFileSync(`${dir}/${String(i).padStart(3,'0')}.rgba`))});
const config={maxSparse:120000};const summaries=[];
assert.deepEqual(seedPairs([0,1,2]),[[0,1],[0,2],[1,2]]);
for(const ids of [[0,1,2],[0,5,11]]){
 const photos=ids.map(i=>meta[i]),features=ids.map(i=>extractFeatures(cv,frame(i),2400,featureAlgorithms(3)[1])),events=[];
 const engine=new Reconstruction(cv,photos,config,{features:i=>features[i],progress:p=>events.push(p)});await engine.run();const result=await engine.result();
 assert.equal(result.registered,3);assert.ok(result.positions.length/3>100);assert.ok(result.medianError<2);
 const checks=events.filter(p=>p.stage==='seed'&&p.message.includes('組'));assert.ok(checks.length);assert.ok(checks.every(p=>p.total===3&&p.done<=3));assert.equal(checks.at(-1).done,3);
 summaries.push({ids,algorithm:features[0].algorithm,registered:result.registered,points:result.positions.length/3,medianReprojection:result.medianError});
}
async function failure(features,code){const events=[],engine=new Reconstruction(cv,meta.slice(0,3),config,{features:i=>features[i],progress:p=>events.push(p)});let failure;try{await engine.run();}catch(e){failure=e;}assert.ok(failure,'must reject unsupported geometry');assert.equal(failure.code,code);assert.equal(engine.state.points.length,0);assert.equal(engine.state.poses.filter(Boolean).length,0);assert.ok(failure.diagnostics);return {failure,events};}
const blank={width:640,height:480,data:new Uint8ClampedArray(640*480*4)};const empty=extractFeatures(cv,blank,2400,'akaze');await failure([empty,empty,empty],'LOW_FEATURES');
// Real feature descriptors from unrelated independently drawn image pixels.
let seed=2;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};
const unrelated=[];for(let i=0;i<3;i++){const rgba=new Uint8ClampedArray(640*480*4);for(let y=0;y<480;y+=5)for(let x=0;x<640;x+=5){const v=random();for(let yy=y;yy<Math.min(y+5,480);yy++)for(let xx=x;xx<Math.min(x+5,640);xx++){const o=(yy*640+xx)*4;rgba.set([v,v,v,255],o);}}unrelated.push(extractFeatures(cv,{width:640,height:480,data:rgba},2400,'akaze'));}
const stopped=await failure(unrelated,'LOW_OVERLAP');assert.equal(stopped.failure.diagnostics.checkedPairs,3);assert.equal(stopped.events.filter(p=>p.message.includes('組')).at(-1).total,3);
const same=extractFeatures(cv,frame(0),2400,'akaze');await failure([same,same,same],'NO_GEOMETRY');
// Failure persistence must never become the screenshot's misleading paused/resume state.
const cfg={preset:'standard',focal35:26,useExif:true,surface:true},key=configKey(cfg,['0','1','2']);
const restored=restoreRun({started:true,runStatus:'failed',runError:{message:'共通点不足'}},null,null,key);assert.equal(restored.status,'failed');assert.equal(restored.resumable,false);assert.equal(runPresentation(restored.status,restored.resumable).button,'再試行');
const legacy=restoreRun({started:true},null,null,key);assert.equal(legacy.status,'interrupted');assert.equal(runPresentation(legacy.status,legacy.resumable).button,'再試行');
const checkpoint={key,state:{stage:'align',poses:[{R:[1],t:[0]},null,null]}};const paused=restoreRun({runStatus:'paused'},null,checkpoint,key);assert.equal(paused.status,'paused');assert.equal(paused.resumable,true);assert.equal(runPresentation('paused',true).button,'続きから再開');
// The shipping pipeline preserves ORB successes and makes one alternate attempt
// on a seed failure. Identical images must remain a failure after both attempts.
const pipelineFrames=[0,1,2].map(frame),prepared=[],sets=new Map();
const pipelineIO={prepare:algorithm=>{prepared.push(algorithm);sets.set(algorithm,pipelineFrames.map(im=>extractFeatures(cv,im,2400,algorithm)));},features:(i,algorithm)=>sets.get(algorithm)[i]};
const pipeline=await reconstructWithFallback(cv,meta.slice(0,3),config,pipelineIO);assert.equal((await pipeline.result()).registered,3);assert.deepEqual(prepared,['orb']);
const alternatives=[];let alternateError;
try{await reconstructWithFallback(cv,meta.slice(0,3),config,{prepare:algorithm=>{alternatives.push(algorithm);sets.set(algorithm,[0,1,2].map(()=>extractFeatures(cv,frame(0),2400,algorithm)));},features:(i,algorithm)=>sets.get(algorithm)[i]});}catch(e){alternateError=e;}
assert.deepEqual(alternatives,['orb','akaze']);assert.equal(alternateError.code,'NO_GEOMETRY');
console.log(JSON.stringify({success:summaries,failures:['LOW_FEATURES','LOW_OVERLAP','NO_GEOMETRY'],progress:'3/3 pairs',failedState:'retry; never paused',legacyState:'retry',pausedState:'resume'},null,2));
