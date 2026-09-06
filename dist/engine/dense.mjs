import {triangulate,project,center,norm,sub,median} from './math.mjs';

function sample(a,w,h,x,y){const ix=Math.floor(x),iy=Math.floor(y);if(ix<0||iy<0||ix>=w-1||iy>=h-1)return NaN;const u=x-ix,v=y-iy,i=iy*w+ix;return (1-v)*((1-u)*a[i]+u*a[i+1])+v*((1-u)*a[i+w]+u*a[i+w+1]);}
function correlation(a,b,w,h,x,y,u,v){let sa=0,sb=0,aa=0,bb=0,ab=0,n=0;for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const p=sample(a,w,h,x+dx,y+dy),q=sample(b,w,h,u+dx,v+dy);if(!Number.isFinite(p+q))return 0;sa+=p;sb+=q;aa+=p*p;bb+=q*q;ab+=p*q;n++;}const va=aa-sa*sa/n,vb=bb-sb*sb/n;if(va/n<35||vb/n<35)return 0;return (ab-sa*sb/n)/Math.sqrt(va*vb+1e-9);}

// Semi-dense measured patches: grid LK + backward check + photometric check +
// calibrated triangulation. Missing/occluded/untextured cells remain holes.
export function densePair(cv,A,B,poseA,poseB,kA,kB,step=5,maxVertices=25000){
  if(A.width!==B.width||A.height!==B.height)return {positions:new Float32Array(),colors:new Uint8Array(),indices:new Uint32Array()};
  const w=A.width,h=A.height,srcA=cv.matFromArray(h,w,cv.CV_8UC4,A.data),srcB=cv.matFromArray(h,w,cv.CV_8UC4,B.data),ga=new cv.Mat(),gb=new cv.Mat();
  const points=[],cols=Math.floor((w-20)/step)+1,rows=Math.floor((h-20)/step)+1;
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++)points.push(10+i*step,10+j*step);
  const p=cv.matFromArray(points.length/2,1,cv.CV_32FC2,points),q=new cv.Mat(),back=new cv.Mat(),status=new cv.Mat(),backStatus=new cv.Mat(),err=new cv.Mat(),backErr=new cv.Mat();
  try{
    cv.cvtColor(srcA,ga,cv.COLOR_RGBA2GRAY);cv.cvtColor(srcB,gb,cv.COLOR_RGBA2GRAY);
    const win=new cv.Size(21,21),criteria=new cv.TermCriteria(cv.TERM_CRITERIA_EPS|cv.TERM_CRITERIA_COUNT,25,0.015);
    cv.calcOpticalFlowPyrLK(ga,gb,p,q,status,err,win,4,criteria);
    cv.calcOpticalFlowPyrLK(gb,ga,q,back,backStatus,backErr,win,4,criteria);
    const positions=[],colors=[],indices=[],map=new Int32Array(points.length/2).fill(-1),depth=new Float32Array(points.length/2);
    for(let i=0;i<points.length/2&&positions.length/3<maxVertices;i++){
      if(!status.data[i]||!backStatus.data[i]||err.data32F[i]>23)continue;
      const x=points[2*i],y=points[2*i+1],u=q.data32F[2*i],v=q.data32F[2*i+1];
      if(u<5||v<5||u>=w-5||v>=h-5||Math.hypot(x-back.data32F[2*i],y-back.data32F[2*i+1])>0.75)continue;
      if(correlation(ga.data,gb.data,w,h,x,y,u,v)<0.88)continue;
      const hit=triangulate(poseA,poseB,[x,y],[u,v],kA,kB,{minAngle:0.8,maxError:1.1});if(!hit)continue;
      map[i]=positions.length/3;positions.push(...hit.x);depth[i]=project(poseA,hit.x,kA)[2];const c=(Math.round(y)*w+Math.round(x))*4;colors.push(...A.data.subarray(c,c+3));
    }
    const face=(a,b,c)=>{const ia=map[a],ib=map[b],ic=map[c];if(ia<0||ib<0||ic<0)return;
      const depths=[depth[a],depth[b],depth[c]],z=median(depths);if(Math.max(...depths)-Math.min(...depths)>z*0.04)return;
      const pa=positions.slice(ia*3,ia*3+3),pb=positions.slice(ib*3,ib*3+3),pc=positions.slice(ic*3,ic*3+3),limit=z/kA.f*step*4;
      if(norm(sub(pa,pb))>limit||norm(sub(pb,pc))>limit||norm(sub(pc,pa))>limit)return;indices.push(ia,ic,ib);};
    for(let y=0;y<rows-1;y++)for(let x=0;x<cols-1;x++){const a=y*cols+x;face(a,a+1,a+cols);face(a+1,a+cols+1,a+cols);}
    return {positions:new Float32Array(positions),colors:new Uint8Array(colors),indices:new Uint32Array(indices)};
  }finally{for(const m of [srcA,srcB,ga,gb,p,q,back,status,backStatus,err,backErr])m.delete();}
}
export function choosePair(state,i){
  if(!state.poses[i])return -1;let best=-1,score=0;
  const ids=new Set(Array.from(state.maps[i]).filter(x=>x>=0));
  for(let j=Math.max(0,i-8);j<i;j++)if(state.poses[j]){
    const shared=Array.from(state.maps[j]).filter(x=>ids.has(x));if(shared.length<20)continue;
    const c=center(state.poses[i]),baseline=norm(sub(c,center(state.poses[j]))),distance=median(shared.slice(0,100).map(id=>norm(sub(c,state.points[id].x)))),angle=Math.atan2(baseline,distance)*180/Math.PI;
    const s=shared.length*Math.min(angle,5);if(angle>=1&&angle<=18&&s>score){best=j;score=s;}
  }return best;
}
export function mergeChunks(sparse,chunks){
  const nv=chunks.reduce((s,c)=>s+c.positions.length,0),ni=chunks.reduce((s,c)=>s+c.indices.length,0);
  const positions=new Float32Array(nv),colors=new Uint8Array(nv),indices=new Uint32Array(ni);let p=0,q=0;
  for(const c of chunks){positions.set(c.positions,p);colors.set(c.colors,p);for(let i=0;i<c.indices.length;i++)indices[q+i]=c.indices[i]+p/3;q+=c.indices.length;p+=c.positions.length;}
  return {...sparse,dense:{positions,colors,indices},densePairs:chunks.filter(c=>c.positions.length).length};
}
