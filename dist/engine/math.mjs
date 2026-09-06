// Camera convention: Xc = R * Xw + t; image y points down. Arbitrary scene units.
export const I = () => [1,0,0,0,1,0,0,0,1];
export const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const add = (a,b) => a.map((v,i)=>v+b[i]);
export const sub = (a,b) => a.map((v,i)=>v-b[i]);
export const scale = (a,s) => a.map(v=>v*s);
export const norm = a => Math.hypot(...a);
export const unit = a => scale(a,1/(norm(a)||1));
export const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const tr = a => [a[0],a[3],a[6],a[1],a[4],a[7],a[2],a[5],a[8]];
export const mv = (a,v) => [dot(a.slice(0,3),v),dot(a.slice(3,6),v),dot(a.slice(6,9),v)];
export function mm(a,b) { const o=Array(9).fill(0);for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)o[i*3+j]+=a[i*3+k]*b[k*3+j];return o; }
export const det = a => a[0]*(a[4]*a[8]-a[5]*a[7])-a[1]*(a[3]*a[8]-a[5]*a[6])+a[2]*(a[3]*a[7]-a[4]*a[6]);
export function solve3(a,b) {
  const d=det(a); if(Math.abs(d)<1e-14)return null;
  return [det([b[0],a[1],a[2],b[1],a[4],a[5],b[2],a[7],a[8]])/d,det([a[0],b[0],a[2],a[3],b[1],a[5],a[6],b[2],a[8]])/d,det([a[0],a[1],b[0],a[3],a[4],b[1],a[6],a[7],b[2]])/d];
}
export const median = a => {const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0;};
export const center = p => scale(mv(tr(p.R),p.t),-1);
export const ray = (p,uv,k) => unit(mv(tr(p.R),[(uv[0]-k.cx)/k.f,(uv[1]-k.cy)/k.f,1]));
export function project(p,x,k) {const q=add(mv(p.R,x),p.t);return [k.f*q[0]/q[2]+k.cx,k.f*q[1]/q[2]+k.cy,q[2]];}
export function reprojection(p,x,uv,k) { const q=project(p,x,k);return q[2]>1e-7?Math.hypot(q[0]-uv[0],q[1]-uv[1]):Infinity; }
export function triangulate(p1,p2,uv1,uv2,k1,k2,{minAngle=0.6,maxError=2.5}={}) {
  const a=ray(p1,uv1,k1),b=ray(p2,uv2,k2),c1=center(p1),c2=center(p2),w=sub(c1,c2);
  const ab=dot(a,b),den=1-ab*ab;
  if(den<Math.sin(minAngle*Math.PI/180)**2 || ab<0)return null;
  const aw=dot(a,w),bw=dot(b,w),s=(ab*bw-aw)/den,t=(bw-ab*aw)/den;
  if(s<=0||t<=0)return null;
  const x=scale(add(add(c1,scale(a,s)),add(c2,scale(b,t))),0.5);
  if(!x.every(Number.isFinite)||reprojection(p1,x,uv1,k1)>maxError||reprojection(p2,x,uv2,k2)>maxError)return null;
  return {x,angle:Math.acos(Math.max(-1,Math.min(1,ab)))*180/Math.PI};
}
export function eig(cv,a,n) {
  const m=cv.matFromArray(n,n,cv.CV_64F,a),v=new cv.Mat(),q=new cv.Mat();
  try{if(!cv.eigen(m,v,q))throw Error('Eigen decomposition failed');return {values:Array.from(v.data64F),vectors:Array.from(q.data64F)};}finally{m.delete();v.delete();q.delete();}
}
export function svd3(cv,a) {
  const e=eig(cv,mm(tr(a),a),3),V=tr(e.vectors),s=e.values.map(x=>Math.sqrt(Math.max(0,x)));
  let u1=unit(mv(a,[V[0],V[3],V[6]])),u2=mv(a,[V[1],V[4],V[7]]);
  u2=unit(sub(u2,scale(u1,dot(u1,u2))));const u3=unit(cross(u1,u2));
  let U=[u1[0],u2[0],u3[0],u1[1],u2[1],u3[1],u1[2],u2[2],u3[2]];
  // Only the first two singular directions are needed for a rank-two matrix.
  return {U,V,s};
}
function normalize2(points) {
  const cx=points.reduce((s,p)=>s+p[0],0)/points.length,cy=points.reduce((s,p)=>s+p[1],0)/points.length;
  const d=points.reduce((s,p)=>s+Math.hypot(p[0]-cx,p[1]-cy),0)/points.length,s=Math.SQRT2/Math.max(d,1e-9);
  return {p:points.map(p=>[(p[0]-cx)*s,(p[1]-cy)*s]),T:[s,0,-s*cx,0,s,-s*cy,0,0,1]};
}
export function eightPoint(cv,a,b) {
  const na=normalize2(a),nb=normalize2(b),ata=Array(81).fill(0);
  for(let i=0;i<a.length;i++) {const [x,y]=na.p[i],[u,v]=nb.p[i],r=[u*x,u*y,u,v*x,v*y,v,x,y,1];for(let j=0;j<9;j++)for(let k=j;k<9;k++)ata[j*9+k]+=r[j]*r[k];}
  for(let j=0;j<9;j++)for(let k=0;k<j;k++)ata[j*9+k]=ata[k*9+j];
  const e=eig(cv,ata,9),f=e.vectors.slice(72,81),{U,V,s}=svd3(cv,f);
  const rank2=mm(mm(U,[s[0],0,0,0,s[1],0,0,0,0]),tr(V));
  return mm(mm(tr(nb.T),rank2),na.T);
}
export function sampson(F,a,b) {
  const p=[...a,1],q=[...b,1],fp=mv(F,p),ftq=mv(tr(F),q),d=dot(q,fp);
  return d*d/(fp[0]**2+fp[1]**2+ftq[0]**2+ftq[1]**2+1e-20);
}
export function essentialRansac(cv,a,b,threshold=0.0025,seed=19) {
  if(a.length<16)return null;
  let rng=seed|0;const random=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return(rng>>>0)/4294967296;};
  let best=[],F=null,maxIt=1800;
  for(let it=0;it<maxIt;it++){
    const ids=new Set();while(ids.size<8)ids.add(Math.floor(random()*a.length));
    let f;try{f=eightPoint(cv,[...ids].map(i=>a[i]),[...ids].map(i=>b[i]));}catch{continue;}
    const good=[];for(let i=0;i<a.length;i++)if(sampson(f,a[i],b[i])<threshold**2)good.push(i);
    if(good.length>best.length){best=good;F=f;const ratio=good.length/a.length;maxIt=Math.min(maxIt,Math.max(80,Math.ceil(Math.log(0.001)/Math.log(Math.max(1e-12,1-ratio**8)))));}
  }
  if(best.length<20)return null;
  F=eightPoint(cv,best.map(i=>a[i]),best.map(i=>b[i]));
  let {U,V,s}=svd3(cv,F);if(det(V)<0){V[2]*=-1;V[5]*=-1;V[8]*=-1;}
  const z=(s[0]+s[1])/2,E=mm(mm(U,[z,0,0,0,z,0,0,0,0]),tr(V));
  return {E,U,V,inliers:best};
}
export function recoverPose(cv,uv1,uv2,k1,k2) {
  const a=uv1.map(p=>[(p[0]-k1.cx)/k1.f,(p[1]-k1.cy)/k1.f]),b=uv2.map(p=>[(p[0]-k2.cx)/k2.f,(p[1]-k2.cy)/k2.f]);
  const res=essentialRansac(cv,a,b,1.7/Math.min(k1.f,k2.f));if(!res)return null;
  const {U,V}=res,W=[0,-1,0,1,0,0,0,0,1],p1={R:I(),t:[0,0,0]};let best=null;
  for(const w of [W,tr(W)])for(const sign of [1,-1]) {
    const R=mm(mm(U,w),tr(V));if(det(R)<0)continue;
    const p2={R,t:scale([U[2],U[5],U[8]],sign)},points=[];
    for(const i of res.inliers){const p=triangulate(p1,p2,uv1[i],uv2[i],k1,k2,{minAngle:0.8,maxError:3});if(p)points.push({i,...p});}
    if(!best||points.length>best.points.length)best={p1,p2,points};
  }
  if(!best||best.points.length<24||best.points.length<res.inliers.length*0.5||median(best.points.map(p=>p.angle))<1)return null;
  return best;
}
