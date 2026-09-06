"""Deterministic perspective renders for pixel-to-3D tests, not a UI demo."""
import json, pathlib, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
out=pathlib.Path(sys.argv[1]); out.mkdir(parents=True,exist_ok=True)
rng=np.random.default_rng(214); textures=[]
for face in range(12):
 im=Image.fromarray(rng.integers(80,185,(384,384,3),dtype=np.uint8)).filter(ImageFilter.GaussianBlur(1));d=ImageDraw.Draw(im)
 for n in range(450):
  x,y=rng.integers(0,384,2);sz=int(rng.integers(3,12));c=tuple(int(v) for v in rng.integers(15,240,3));d.rectangle((int(x),int(y),int(x)+sz,int(y)+sz),fill=c)
 textures.append(np.array(im))
w,h,f=640,480,480.;uv=np.stack(np.meshgrid(np.arange(w),np.arange(h)),axis=-1);rays=np.dstack(((uv[:,:,0]-(w-1)/2)/f,(uv[:,:,1]-(h-1)/2)/f,np.ones((h,w))))
surfaces=[]
for bi,(lo,hi) in enumerate([([-1,-1,-1],[1,1,1]),([1.25,-1,-1.3],[2.05,.05,-.5])]):
 for axis in range(3):
  for side in range(2): surfaces.append((axis,[lo[axis],hi[axis]][side],lo,hi,bi*6+axis*2+side))
surfaces.append((1,-1.05,[-6,-1.05,-6],[6,-1.05,6],9));surfaces.append((2,-2.2,[-6,-1.05,-2.2],[6,5,-2.2],10))
meta=[]
for i,angle in enumerate(np.linspace(-.18,.40,12)):
 C=np.array([5*np.sin(angle),1.4,5*np.cos(angle)]);forward=-C/np.linalg.norm(C);right=np.cross(forward,[0,1,0]);right/=np.linalg.norm(right);down=np.cross(forward,right);R=np.stack([right,down,forward]);t=-R@C;dirs=rays@R;depth=np.full((h,w),np.inf);rgb=np.zeros((h,w,3),dtype=np.uint8)+25
 for axis,val,lo,hi,ti in surfaces:
  with np.errstate(divide='ignore',invalid='ignore'): dist=(val-C[axis])/dirs[:,:,axis]
  xyz=C+dirs*dist[:,:,None];valid=(dist>0)&(dist<depth)
  axes=[a for a in range(3) if a!=axis]
  for a in axes: valid&=(xyz[:,:,a]>=lo[a])&(xyz[:,:,a]<=hi[a])
  uu=(xyz[:,:,axes[0]]-lo[axes[0]])*145;vv=(xyz[:,:,axes[1]]-lo[axes[1]])*145
  xx=np.nan_to_num(uu).astype(np.int32)%384;yy=np.nan_to_num(vv).astype(np.int32)%384
  rgb[valid]=textures[ti][yy[valid],xx[valid]];depth[valid]=dist[valid]
 rgba=np.dstack((rgb,np.full((h,w),255,dtype=np.uint8)));(out/f'{i:03}.rgba').write_bytes(rgba.tobytes());Image.fromarray(rgb).save(out/f'{i:03}.jpg',quality=95)
 meta.append({'id':str(i),'name':f'{i:03}.jpg','width':w,'height':h,'k':{'f':f,'cx':(w-1)/2,'cy':(h-1)/2,'width':w,'height':h},'R':R.tolist(),'t':t.tolist()})
(out/'meta.json').write_text(json.dumps(meta));print(json.dumps({'images':len(meta),'path':str(out)}))
