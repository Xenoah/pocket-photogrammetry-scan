import {IMPORT_LONG_EDGE,MAX_FILE_BYTES} from './policy.mjs';
export async function readExif(file){
  const b=await file.slice(0,256*1024).arrayBuffer(),v=new DataView(b);const out={};
  try{if(v.getUint16(0)!==0xffd8)return out;let o=2;
    while(o+4<v.byteLength){if(v.getUint8(o)!==255)break;const marker=v.getUint8(o+1),len=v.getUint16(o+2);if(len<2)break;
      if(marker===225&&o+14<v.byteLength&&v.getUint32(o+4)===0x45786966){const t=o+10,le=v.getUint16(t)===0x4949;const u16=i=>v.getUint16(i,le),u32=i=>v.getUint32(i,le);if(u16(t+2)!==42)break;
        const read=(at,depth=0)=>{if(depth>2||at<0||at+2>=v.byteLength)return;const n=Math.min(u16(at),256);for(let j=0;j<n;j++){const e=at+2+j*12;if(e+12>v.byteLength)break;const tag=u16(e),type=u16(e+2),count=u32(e+4),offset=(type===3?2:1)*count<=4?e+8:t+u32(e+8);if(offset<0||offset>=v.byteLength)continue;
          if(tag===0x8769)read(t+u32(e+8),depth+1);
          if(tag===0xa405&&type===3)out.focal35=u16(offset);
          if((tag===0x9003||tag===0x132)&&type===2&&count<=40&&offset+count<=v.byteLength){const str=new TextDecoder().decode(new Uint8Array(b,offset,count)).replace(/\0/g,'');if(/^\d{4}:\d{2}:\d{2}/.test(str))out.captured=str;}
        }};read(t+u32(t+4));break;
      }o+=2+len;
    }
  }catch{/* Incomplete metadata is optional; image decoder still validates pixels. */}return out;
}
function canvas(w,h){if(typeof OffscreenCanvas!=='undefined')return new OffscreenCanvas(w,h);const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
async function decode(blob){if(typeof createImageBitmap==='function')return createImageBitmap(blob,{imageOrientation:'from-image'});if(typeof document==='undefined')throw Error('このブラウザでは画像を処理できません。Chrome最新版で開いてください。');const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();return img;}finally{URL.revokeObjectURL(url);}}
async function toBlob(c,quality){if(c.convertToBlob)return c.convertToBlob({type:'image/jpeg',quality});return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('画像の変換に失敗しました。')),'image/jpeg',quality));}
export async function preparePhoto(file){
  if(file.size>MAX_FILE_BYTES)throw Error('1枚80MB以下の写真を使用してください。');
  const exif=await readExif(file),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
  let image;try{image=await decode(file);}catch{throw Error('読み込めない画像形式です。JPEG・PNG・WebPに変換してください。');}
  try{const w=image.width||image.naturalWidth,h=image.height||image.naturalHeight;if(w<64||h<64)throw Error('縦・横64ピクセル以上の画像を使用してください。');
    const s=Math.min(1,IMPORT_LONG_EDGE/Math.max(w,h)),width=Math.round(w*s),height=Math.round(h*s),c=canvas(width,height),ctx=c.getContext('2d');ctx.drawImage(image,0,0,width,height);const blob=await toBlob(c,0.92);
    const ts=Math.min(1,180/Math.max(w,h)),t=canvas(Math.round(w*ts),Math.round(h*ts));t.getContext('2d').drawImage(image,0,0,t.width,t.height);const thumb=await toBlob(t,0.76);c.width=c.height=1;t.width=t.height=1;
    return {photo:{id:crypto.randomUUID(),name:file.name||`写真-${Date.now()}.jpg`,width,height,originalWidth:w,originalHeight:h,size:blob.size,originalSize:file.size,hash,added:Date.now(),...exif},blob,thumb};
  }finally{image.close?.();}
}
export async function pixels(blob,width,height){const image=await decode(blob);try{const c=canvas(width,height),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,width,height);const data=ctx.getImageData(0,0,width,height);c.width=c.height=1;return {width,height,data:data.data};}finally{image.close?.();}}
