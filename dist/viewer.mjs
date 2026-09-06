import * as THREE from './vendor/three.module.js';
import {OrbitControls} from './vendor/OrbitControls.js';
export class Viewer{
  constructor(canvas){
    this.canvas=canvas;this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(45,1,.001,1000);this.camera.position.set(2,1.2,3);this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=false;this.controls.addEventListener('change',()=>this.draw());
    this.group=new THREE.Group();this.scene.add(this.group);this.grid=new THREE.GridHelper(6,24,0x375060,0x21323d);this.grid.position.y=-1.2;this.scene.add(this.grid);this.scene.add(new THREE.HemisphereLight(0xffffff,0x253544,2));this.axes=new THREE.AxesHelper(.55);this.axes.position.set(-2,-1.19,2);this.scene.add(this.axes);
    this.resize=new ResizeObserver(()=>this.fitCanvas());this.resize.observe(canvas.parentElement);this.fitCanvas();this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.onError?.('3D表示が停止しました。ページを開き直してください。データは保存されています。');});
  }
  fitCanvas(){const b=this.canvas.parentElement.getBoundingClientRect();if(!b.width||!b.height)return;this.renderer.setSize(b.width,b.height,false);this.camera.aspect=b.width/b.height;this.camera.updateProjectionMatrix();this.draw();}
  draw(){this.renderer.render(this.scene,this.camera);}
  clear(){for(const o of [...this.group.children]){o.geometry?.dispose();o.material?.dispose();this.group.remove(o);}this.result=null;this.draw();}
  set(result,mode='points'){
    this.clear();this.result=result;this.mode=mode;let g=mode==='mesh'&&result.dense?.indices.length?result.dense:(result.dense?.positions.length?result.dense:result);if(!g.positions.length)return;
    const p=new Float32Array(g.positions.length),c=new Float32Array(g.colors.length);const col=new THREE.Color();for(let i=0;i<p.length;i+=3){p[i]=g.positions[i];p[i+1]=-g.positions[i+1];p[i+2]=-g.positions[i+2];col.setRGB(g.colors[i]/255,g.colors[i+1]/255,g.colors[i+2]/255,THREE.SRGBColorSpace);c[i]=col.r;c[i+1]=col.g;c[i+2]=col.b;}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(p,3));geo.setAttribute('color',new THREE.BufferAttribute(c,3));geo.computeBoundingBox();const center=geo.boundingBox.getCenter(new THREE.Vector3()),size=geo.boundingBox.getSize(new THREE.Vector3()),extent=Math.max(size.x,size.y,size.z,1e-6);geo.translate(-center.x,-center.y,-center.z);geo.scale(3/extent,3/extent,3/extent);let object;
    if(mode==='mesh'&&g.indices.length){geo.setIndex(new THREE.BufferAttribute(g.indices,1));geo.computeVertexNormals();object=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}));}
    else object=new THREE.Points(geo,new THREE.PointsMaterial({vertexColors:true,size:0.013,sizeAttenuation:true}));this.group.add(object);this.object=object;this.grid.position.y=-size.y/extent*1.5-.02;this.axes.position.y=this.grid.position.y+.01;this.reset();
  }
  reset(){this.camera.position.set(0.5,0.4,5);this.controls.target.set(0,0,0);this.controls.update();this.draw();}
  setSize(n){if(this.object?.isPoints){this.object.material.size=.006*n;this.draw();}}
  toggleGrid(on){this.grid.visible=on;this.axes.visible=on;this.draw();}
  dispose(){this.resize.disconnect();this.clear();this.controls.dispose();this.renderer.dispose();}
}
