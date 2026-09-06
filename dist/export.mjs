const bytes=s=>new TextEncoder().encode(s);
export function selectGeometry(result,mode='points'){
  if(mode==='mesh'){if(!result.dense?.indices.length)throw Error('書き出せる表面がありません。点群を選んでください。');return result.dense;}
  if(result.dense?.positions.length)return {...result.dense,indices:new Uint32Array(0)};
  return {...result,indices:new Uint32Array(0)};
}
export function ply(g){
  const n=g.positions.length/3,nf=g.indices.length/3;
  const header=bytes(`ply\nformat binary_little_endian 1.0\ncomment PocketScan; arbitrary scale; Y up\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${nf}\nproperty list uchar uint vertex_indices\nend_header\n`);
  const data=new ArrayBuffer(n*15+nf*13),v=new DataView(data);let o=0;
  for(let i=0;i<n;i++){v.setFloat32(o,g.positions[i*3],true);v.setFloat32(o+4,-g.positions[i*3+1],true);v.setFloat32(o+8,-g.positions[i*3+2],true);v.setUint8(o+12,g.colors[i*3]);v.setUint8(o+13,g.colors[i*3+1]);v.setUint8(o+14,g.colors[i*3+2]);o+=15;}
  for(let i=0;i<nf;i++){v.setUint8(o,3);for(let j=0;j<3;j++)v.setUint32(o+1+j*4,g.indices[i*3+j],true);o+=13;}
  return new Blob([header,data],{type:'application/octet-stream'});
}
export function obj(g){const parts=['# PocketScan / arbitrary scale / Y up / RGB vertex colors\n'];let lines=[];for(let i=0;i<g.positions.length/3;i++){lines.push(`v ${g.positions[i*3].toFixed(6)} ${(-g.positions[i*3+1]).toFixed(6)} ${(-g.positions[i*3+2]).toFixed(6)} ${(g.colors[i*3]/255).toFixed(4)} ${(g.colors[i*3+1]/255).toFixed(4)} ${(g.colors[i*3+2]/255).toFixed(4)}\n`);if(lines.length===5000){parts.push(lines.join(''));lines=[];}}parts.push(lines.join(''));lines=[];for(let i=0;i<g.indices.length;i+=3){lines.push(`f ${g.indices[i]+1} ${g.indices[i+1]+1} ${g.indices[i+2]+1}\n`);if(lines.length===5000){parts.push(lines.join(''));lines=[];}}parts.push(lines.join(''));return new Blob(parts,{type:'text/plain'});}
const linear=x=>{x/=255;return x<=0.04045?x/12.92:((x+.055)/1.055)**2.4;};
export function glb(g){
  const n=g.positions.length/3,positions=new Float32Array(n*3),colors=new Float32Array(n*3),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<n;i++)for(let j=0;j<3;j++){const v=g.positions[i*3+j]*(j===0?1:-1);positions[i*3+j]=v;colors[i*3+j]=linear(g.colors[i*3+j]);min[j]=Math.min(min[j],v);max[j]=Math.max(max[j],v);}
  const vb=positions.byteLength,cb=colors.byteLength,ib=g.indices.byteLength;
  const doc={asset:{version:'2.0',generator:'PocketScan'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,COLOR_0:1},mode:ib?4:0,...(ib?{indices:2}:{}),material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:1},doubleSided:true,extensions:{KHR_materials_unlit:{}}}],extensionsUsed:['KHR_materials_unlit'],buffers:[{byteLength:vb+cb+ib}],bufferViews:[{buffer:0,byteOffset:0,byteLength:vb,target:34962},{buffer:0,byteOffset:vb,byteLength:cb,target:34962}],accessors:[{bufferView:0,componentType:5126,count:n,type:'VEC3',min,max},{bufferView:1,componentType:5126,count:n,type:'VEC3'}],extras:{scale:'arbitrary',source:'measured multi-view image correspondences'}};
  if(ib){doc.bufferViews.push({buffer:0,byteOffset:vb+cb,byteLength:ib,target:34963});doc.accessors.push({bufferView:2,componentType:5125,count:g.indices.length,type:'SCALAR'});}
  const json=bytes(JSON.stringify(doc)),jl=Math.ceil(json.length/4)*4,total=12+8+jl+8+vb+cb+ib,header=new ArrayBuffer(20),h=new DataView(header);h.setUint32(0,0x46546c67,true);h.setUint32(4,2,true);h.setUint32(8,total,true);h.setUint32(12,jl,true);h.setUint32(16,0x4e4f534a,true);const jp=new Uint8Array(jl);jp.fill(32);jp.set(json);const bh=new ArrayBuffer(8),bv=new DataView(bh);bv.setUint32(0,vb+cb+ib,true);bv.setUint32(4,0x004e4942,true);
  return new Blob([header,jp,bh,positions,colors,g.indices],{type:'model/gltf-binary'});
}
export function exportModel(result,format,mode){const g=selectGeometry(result,mode);if(!g.positions.length)throw Error('書き出せる3D点がありません。');return ({ply,obj,glb}[format]??ply)(g);}
