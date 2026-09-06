export const MAX_PHOTOS=1000;
export const MAX_FILE_BYTES=80*1024*1024;
export const IMPORT_LONG_EDGE=1600;
export const PRESETS={
  light:{label:'軽量',edge:800,features:1500,denseEdge:480,step:6,maxSparse:70000,maxDense:240000},
  standard:{label:'標準',edge:1100,features:2400,denseEdge:640,step:5,maxSparse:120000,maxDense:450000},
  detail:{label:'詳細',edge:1600,features:3600,denseEdge:800,step:4,maxSparse:160000,maxDense:650000}
};
export function canAdd(count){return Number.isInteger(count)&&count>=0&&count<MAX_PHOTOS;}
export function validateCount(count){if(!Number.isInteger(count)||count<3||count>MAX_PHOTOS)throw Error('写真は3〜1,000枚で選んでください。');}
export function intrinsics(photo,focal35=26,useExif=true,edge=1600){
  const s=Math.min(1,edge/Math.max(photo.width,photo.height)),w=Math.max(1,Math.round(photo.width*s)),h=Math.max(1,Math.round(photo.height*s));
  const focal=(useExif&&photo.focal35>=10&&photo.focal35<=200)?photo.focal35:focal35;
  return {width:w,height:h,f:focal/Math.hypot(36,24)*Math.hypot(w,h),cx:(w-1)/2,cy:(h-1)/2,focal35:focal,estimated:!(useExif&&photo.focal35)};
}
export function orderPhotos(photos,sort='capture'){
  return [...photos].sort((a,b)=>sort==='added'?a.added-b.added:sort==='name'?a.name.localeCompare(b.name,undefined,{numeric:true}):((a.captured&&b.captured)?a.captured.localeCompare(b.captured)||a.name.localeCompare(b.name,undefined,{numeric:true}):a.name.localeCompare(b.name,undefined,{numeric:true})));
}
export const featureAlgorithms=count=>count<=8?['orb','akaze']:['orb'];
export function configKey(config,ids){return JSON.stringify({v:ids.length<=8?4:3,preset:config.preset,focal35:config.focal35,useExif:config.useExif,surface:config.surface,ids});}
