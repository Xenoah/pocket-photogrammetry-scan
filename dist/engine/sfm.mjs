import {I,center,sub,norm,scale,add,mv,tr,dot,ray,solve3,median,triangulate,recoverPose,reprojection} from './math.mjs';
import {validateCount,featureAlgorithms} from '../policy.mjs';

export function extractFeatures(cv,image,count=2400,algorithm='orb'){
  const src=cv.matFromArray(image.height,image.width,cv.CV_8UC4,image.data),gray=new cv.Mat(),mask=new cv.Mat(),kp=new cv.KeyPointVector(),desc=new cv.Mat(),detector=algorithm==='akaze'?new cv.AKAZE():new cv.ORB(count);
  try{
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);if(algorithm==='akaze')detector.setThreshold(0.0005);else detector.setFastThreshold(12);detector.detectAndCompute(gray,mask,kp,desc);
    let ids=Array.from({length:kp.size()},(_,i)=>i);
    if(ids.length>count)ids.sort((a,b)=>kp.get(b).response-kp.get(a).response);
    ids=ids.slice(0,count);
    const xy=new Float32Array(ids.length*2),colors=new Uint8Array(ids.length*3),descriptors=new Uint8Array(ids.length*desc.cols);
    for(let i=0;i<ids.length;i++){const source=ids[i],p=kp.get(source).pt;xy[i*2]=p.x;xy[i*2+1]=p.y;const j=(Math.min(image.height-1,Math.round(p.y))*image.width+Math.min(image.width-1,Math.round(p.x)))*4;colors.set(image.data.subarray(j,j+3),i*3);descriptors.set(desc.data.subarray(source*desc.cols,(source+1)*desc.cols),i*desc.cols);}
    return {xy,colors,descriptors,count:ids.length,cols:desc.cols,width:image.width,height:image.height,algorithm};
  }finally{src.delete();gray.delete();mask.delete();kp.delete();desc.delete();detector.delete();}
}
export function matchFeatures(cv,a,b){
  if(a.count<2||b.count<2||a.cols!==b.cols)return [];
  const ma=cv.matFromArray(a.count,a.cols,cv.CV_8U,a.descriptors),mb=cv.matFromArray(b.count,b.cols,cv.CV_8U,b.descriptors),matches=new cv.DMatchVectorVector(),matcher=new cv.BFMatcher(cv.NORM_HAMMING,false);
  try{
    matcher.knnMatch(ma,mb,matches,2);const candidates=[];
    const maxDistance=a.algorithm==='akaze'?112:72;
    for(let i=0;i<matches.size();i++){const m=matches.get(i);try{if(m.size()<2)continue;const a=m.get(0),b=m.get(1);if(a.distance<maxDistance&&a.distance<0.74*b.distance)candidates.push({a:a.queryIdx,b:a.trainIdx,d:a.distance});}finally{m.delete();}}
    candidates.sort((a,b)=>a.d-b.d);const seen=new Set();return candidates.filter(m=>{if(seen.has(m.b))return false;seen.add(m.b);return true;});
  }finally{ma.delete();mb.delete();matches.delete();matcher.delete();}
}
const xy=(f,i)=>[f.xy[2*i],f.xy[2*i+1]];
const color=(f,i)=>Array.from(f.colors.subarray(3*i,3*i+3));
export function seedPairs(valid){
  const pairs=[];
  if(valid.length<=8){for(let i=0;i<valid.length;i++)for(let j=i+1;j<valid.length;j++)pairs.push([valid[i],valid[j]]);}
  else{for(let i=0;i<Math.min(5,valid.length-1);i++)for(const gap of [2,4,1,7])if(i+gap<valid.length)pairs.push([valid[i],valid[i+gap]]);}
  return pairs;
}
export class ReconstructionError extends Error{
  constructor(code,message,diagnostics){super(message);this.name='ReconstructionError';this.code=code;this.diagnostics=diagnostics;}
}
export function solvePose(cv,points,uv,k,guess=null,ransac=true){
  if(points.length<10)return null;
  const obj=cv.matFromArray(points.length,1,cv.CV_64FC3,points.flat()),img=cv.matFromArray(uv.length,1,cv.CV_64FC2,uv.flat()),K=cv.matFromArray(3,3,cv.CV_64F,[k.f,0,k.cx,0,k.f,k.cy,0,0,1]),dist=new cv.Mat(),r=new cv.Mat(),t=new cv.Mat(),R=new cv.Mat(),ins=new cv.Mat();
  try{
    if(guess){const g=cv.matFromArray(3,3,cv.CV_64F,guess.R);try{cv.Rodrigues(g,r);}finally{g.delete();}t.create(3,1,cv.CV_64F);t.data64F.set(guess.t);}
    let ok;
    if(ransac)ok=cv.solvePnPRansac(obj,img,K,dist,r,t,!!guess,200,3.0,0.999,ins,cv.SOLVEPNP_EPNP);
    else ok=cv.solvePnP(obj,img,K,dist,r,t,!!guess,cv.SOLVEPNP_ITERATIVE);
    if(!ok||(ransac&&ins.rows<10))return null;
    const inliers=ransac?Array.from(ins.data32S):points.map((_,i)=>i);
    if(inliers.length>=10){const o=cv.matFromArray(inliers.length,1,cv.CV_64FC3,inliers.flatMap(i=>points[i])),u=cv.matFromArray(inliers.length,1,cv.CV_64FC2,inliers.flatMap(i=>uv[i]));try{cv.solvePnPRefineLM(o,u,K,dist,r,t);}finally{o.delete();u.delete();}}
    cv.Rodrigues(r,R);const pose={R:Array.from(R.data64F),t:Array.from(t.data64F)};
    if(![...pose.R,...pose.t].every(Number.isFinite))return null;
    const good=inliers.filter(i=>reprojection(pose,points[i],uv[i],k)<3.5);
    return good.length>=10?{pose,inliers:good}:null;
  }finally{obj.delete();img.delete();K.delete();dist.delete();r.delete();t.delete();R.delete();ins.delete();}
}
export class Reconstruction {
  constructor(cv,photos,config,io,state=null){
    validateCount(photos.length);this.cv=cv;this.photos=photos;this.config=config;this.io=io;this.cache=new Map();
    this.state=state??{version:3,stage:'seed',poses:photos.map(()=>null),maps:photos.map(()=>null),points:[],seeds:[],next:0,retry:0,refinePass:0,refineIndex:0,denseIndex:0};
  }
  async features(i){if(this.cache.has(i)){const a=this.cache.get(i);this.cache.delete(i);this.cache.set(i,a);return a;}const a=await this.io.features(i);this.cache.set(i,a);while(this.cache.size>8)this.cache.delete(this.cache.keys().next().value);return a;}
  async tick(event){await this.io.progress?.(event);if(await this.io.cancelled?.()){await this.io.save?.(this.state);throw new Error('PAUSED');}}
  async save(){await this.io.save?.(this.state);}
  async seed(){
    const valid=[],featureCounts=[];
    for(let i=0;i<this.photos.length&&valid.length<16;i++){const count=(await this.features(i)).count;featureCounts.push(count);if(count>=30)valid.push(i);if(i%20===0)await this.tick({stage:'seed',message:`基準候補を確認 ${i+1} / ${this.photos.length}枚`,done:i+1,total:this.photos.length});}
    const pairs=seedPairs(valid),diagnostics={photos:this.photos.length,featureCounts,pairs:pairs.length,checkedPairs:0,maxMatches:0};
    if(pairs.length===0)throw new ReconstructionError('LOW_FEATURES','写真から十分な模様を検出できませんでした。ピント・明るさを確認し、模様のある部分が大きく写る写真を追加してください。',diagnostics);
    let best=null,attempt=0;
    for(const [i,j] of pairs){
      // Yield before the expensive geometry step so a requested pause is observed.
      await this.tick({stage:'seed',message:`基準になる写真を確認 ${attempt} / ${pairs.length}組`,done:attempt,total:pairs.length});
      const a=await this.features(i),b=await this.features(j),matches=matchFeatures(this.cv,a,b);
      diagnostics.maxMatches=Math.max(diagnostics.maxMatches,matches.length);
      const result=matches.length>=30?recoverPose(this.cv,matches.map(m=>xy(a,m.a)),matches.map(m=>xy(b,m.b)),this.photos[i].k,this.photos[j].k):null;
      if(result){const score=result.points.length*Math.min(6,median(result.points.map(p=>p.angle)));if(!best||score>best.score)best={i,j,a,b,matches,result,score};}
      diagnostics.checkedPairs=++attempt;
      await this.tick({stage:'seed',message:`基準になる写真を確認 ${attempt} / ${pairs.length}組`,done:attempt,total:pairs.length,matches:matches.length});
    }
    if(!best){
      const lowOverlap=diagnostics.maxMatches<30;
      throw new ReconstructionError(lowOverlap?'LOW_OVERLAP':'NO_GEOMETRY',lowOverlap?'写真同士の共通点が足りず、撮影位置を決められませんでした。同じ被写体を隣の写真と7〜8割重なる角度で撮影し、間をつなぐ写真を追加してください。':'写真の共通点は見つかりましたが、奥行きを安定して計算できませんでした。被写体を固定し、カメラの位置を少しずつ動かした写真を追加してください。同じ位置からの回転だけでは復元できません。設定の焦点距離も確認してください。',diagnostics);
    }
    const {i,j,a,b,matches,result}=best,s=this.state;s.seeds=[i,j];s.poses[i]=result.p1;s.poses[j]=result.p2;s.maps[i]=new Int32Array(a.count).fill(-1);s.maps[j]=new Int32Array(b.count).fill(-1);
    for(const p of result.points){const m=matches[p.i],id=s.points.length;s.points.push({x:p.x,c:color(a,m.a),obs:[[i,m.a],[j,m.b]]});s.maps[i][m.a]=id;s.maps[j][m.b]=id;}
    s.stage='align';await this.save();
  }
  neighbors(i){return this.state.poses.map((p,j)=>({p,j})).filter(x=>x.p&&x.j!==i).sort((a,b)=>Math.abs(a.j-i)-Math.abs(b.j-i)).slice(0,6).map(x=>x.j);}
  observe(id,i,key){const p=this.state.points[id];if(!p.obs.some(o=>o[0]===i)){if(p.obs.length>=8)p.obs.splice(1,1);p.obs.push([i,key]);}this.state.maps[i][key]=id;}
  async align(i){
    const s=this.state;if(s.poses[i])return true;
    const f=await this.features(i),refs=[];if(f.count<30)return false;
    const correspondences=new Map(),seenPoints=new Set();
    for(const j of this.neighbors(i)){
      const a=await this.features(j),matches=matchFeatures(this.cv,a,f);refs.push({j,a,matches});
      for(const m of matches){const id=s.maps[j][m.a];if(id>=0&&!correspondences.has(m.b)&&!seenPoints.has(id)){correspondences.set(m.b,id);seenPoints.add(id);}}
      if(correspondences.size>180&&refs.length>=3)break;
    }
    if(correspondences.size<12)return false;
    const pairs=[...correspondences],result=solvePose(this.cv,pairs.map(([,id])=>s.points[id].x),pairs.map(([key])=>xy(f,key)),this.photos[i].k);
    if(!result||result.inliers.length<12||result.inliers.length<pairs.length*0.2)return false;
    s.poses[i]=result.pose;s.maps[i]=new Int32Array(f.count).fill(-1);
    for(const n of result.inliers){const [key,id]=pairs[n];this.observe(id,i,key);}
    for(const {j,a,matches} of refs){
      for(const m of matches){
        const idA=s.maps[j][m.a],idB=s.maps[i][m.b];
        if(idA>=0&&idB<0&&reprojection(s.poses[i],s.points[idA].x,xy(f,m.b),this.photos[i].k)<2.5){this.observe(idA,i,m.b);continue;}
        if(idB>=0&&idA<0&&reprojection(s.poses[j],s.points[idB].x,xy(a,m.a),this.photos[j].k)<2.5){this.observe(idB,j,m.a);continue;}
        if(idA>=0||idB>=0||s.points.length>=this.config.maxSparse)continue;
        const p=triangulate(s.poses[j],s.poses[i],xy(a,m.a),xy(f,m.b),this.photos[j].k,this.photos[i].k);
        if(p){const id=s.points.length;s.points.push({x:p.x,c:color(f,m.b),obs:[[j,m.a],[i,m.b]]});s.maps[j][m.a]=id;s.maps[i][m.b]=id;}
      }
    }
    return true;
  }
  async refinePose(i){
    const s=this.state;if(!s.poses[i]||s.seeds.includes(i))return;
    const f=await this.features(i),p=[],uv=[];
    for(let key=0;key<s.maps[i].length;key++){const id=s.maps[i][key];if(id>=0&&s.points[id].obs.length>=3&&reprojection(s.poses[i],s.points[id].x,xy(f,key),this.photos[i].k)<4){p.push(s.points[id].x);uv.push(xy(f,key));}}
    if(p.length<12)return;
    const r=solvePose(this.cv,p,uv,this.photos[i].k,s.poses[i],false);if(r&&r.inliers.length>=p.length*0.85)s.poses[i]=r.pose;
  }
  async refinePoints(){
    // Alternating camera LM and multi-view ray intersection, with both seed cameras fixed.
    // This is bounded refinement, not a global sparse bundle-adjustment solver.
    const s=this.state,byImage=new Map();
    for(let id=0;id<s.points.length;id++)for(const [i,key] of s.points[id].obs){if(!byImage.has(i))byImage.set(i,[]);byImage.get(i).push([id,key]);}
    const ata=new Float64Array(s.points.length*9),atb=new Float64Array(s.points.length*3);
    for(const [i,refs] of byImage){const f=await this.features(i),p=s.poses[i],c=center(p),k=this.photos[i].k;
      for(const [id,key] of refs){const d=ray(p,xy(f,key),k),w=1/Math.max(1,reprojection(p,s.points[id].x,xy(f,key),k));for(let r=0;r<3;r++)for(let q=0;q<3;q++){const a=((r===q?1:0)-d[r]*d[q])*w;ata[id*9+r*3+q]+=a;atb[id*3+r]+=a*c[q];}}
    }
    for(let id=0;id<s.points.length;id++){const x=solve3(Array.from(ata.subarray(id*9,id*9+9)),Array.from(atb.subarray(id*3,id*3+3)));if(x&&x.every(Number.isFinite)&&norm(sub(x,s.points[id].x))<0.1*Math.max(1,norm(s.points[id].x)))s.points[id].x=x;}
  }
  async run(){
    const s=this.state;if(s.stage==='seed')await this.seed();
    if(s.stage==='align'){
      for(;s.retry<2;s.retry++,s.next=0){for(;s.next<this.photos.length;s.next++){
        const i=s.next;await this.align(i);
        await this.tick({stage:'align',done:i+1,total:this.photos.length,pass:s.retry+1,registered:s.poses.filter(Boolean).length,points:s.points.length,message:`撮影位置を計算 ${i+1} / ${this.photos.length}`});
        if(i%5===0)await this.save();
      }}s.stage='refine';await this.save();
    }
    if(s.stage==='refine'){
      for(;s.refinePass<2;s.refinePass++,s.refineIndex=0){
        for(;s.refineIndex<this.photos.length;s.refineIndex++){await this.refinePose(s.refineIndex);if(s.refineIndex%10===0)await this.tick({stage:'refine',done:s.refineIndex+1,total:this.photos.length,pass:s.refinePass+1,message:`形状を調整 ${s.refinePass+1} / 2`});}
        await this.refinePoints();await this.save();
      }
      s.stage='dense';await this.save();
    }
    return s;
  }
  async result(){
    const s=this.state,xyz=[],rgb=[],errors=[];
    // Check actual observations again after refinement; never synthesize missing geometry.
    const accum=new Float64Array(s.points.length),count=new Uint8Array(s.points.length);
    for(let i=0;i<this.photos.length;i++)if(s.poses[i]){const f=await this.features(i);for(let key=0;key<s.maps[i].length;key++){const id=s.maps[i][key];if(id<0)continue;const e=reprojection(s.poses[i],s.points[id].x,xy(f,key),this.photos[i].k);if(e<=3.5){accum[id]+=e;count[id]++;}}}
    for(let i=0;i<s.points.length;i++){const p=s.points[i];if(count[i]>=2&&p.x.every(Number.isFinite)){xyz.push(...p.x);rgb.push(...p.c);errors.push(accum[i]/count[i]);}}
    return {positions:new Float32Array(xyz),colors:new Uint8Array(rgb),indices:new Uint32Array(0),registered:s.poses.filter(Boolean).length,total:this.photos.length,medianError:median(errors),cameras:s.poses.map((p,i)=>p?{index:i,name:this.photos[i].name,center:center(p),R:p.R,t:p.t,k:this.photos[i].k}:null).filter(Boolean),skipped:s.poses.map((p,i)=>p?null:this.photos[i].name).filter(Boolean),capped:s.points.length>=this.config.maxSparse};
  }
}

// Keep the established ORB reconstruction when it succeeds. Only seed failures
// in small sets trigger a bounded second attempt using different image features.
export async function reconstructWithFallback(cv,photos,config,io,initialState=null){
  const algorithms=featureAlgorithms(photos.length),savedAlgorithm=initialState?.featureAlgorithm||'orb';
  let state=initialState;
  const first=Math.max(0,algorithms.indexOf(savedAlgorithm));
  for(let n=first;n<algorithms.length;n++){
    const algorithm=algorithms[n];
    const engine=new Reconstruction(cv,photos,config,{...io,features:i=>io.features(i,algorithm)},state);
    engine.state.featureAlgorithm=algorithm;
    await io.prepare?.(algorithm,engine.state);
    try{await engine.run();return engine;}
    catch(e){
      if(n+1>=algorithms.length||!['LOW_FEATURES','LOW_OVERLAP','NO_GEOMETRY'].includes(e.code)||await io.cancelled?.())throw e;
      state=null;
      await io.progress?.({stage:'features',message:'別の方法で写真の共通点を探しています',done:0,total:photos.length});
    }
  }
  throw new Error('再構成を開始できませんでした。');
}
