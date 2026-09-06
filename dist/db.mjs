import {MAX_PHOTOS} from './policy.mjs';
let opened;
export function openDB(){if(opened)return opened;opened=new Promise((resolve,reject)=>{const r=indexedDB.open('pocketscan-v1',1);r.onupgradeneeded=()=>{const db=r.result;db.createObjectStore('projects',{keyPath:'id'});for(const name of ['photos','blobs','features','chunks']){const s=db.createObjectStore(name,{keyPath:'id'});s.createIndex('project','project');}db.createObjectStore('states',{keyPath:'id'});db.createObjectStore('results',{keyPath:'id'});};r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result);};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('別のタブを閉じてから開き直してください。'));});return opened;}
export async function get(store,id){const db=await openDB();return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function all(store,project){const db=await openDB();return new Promise((resolve,reject)=>{const s=db.transaction(store).objectStore(store),r=project?s.index('project').getAll(project):s.getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function put(store,value){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('保存が中断されました。'));});}
export async function remove(store,id){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
export async function addPhoto(project,photo,blob,thumb){
  const db=await openDB();return new Promise((resolve,reject)=>{
    const tx=db.transaction(['projects','photos','blobs'],'readwrite'),ps=tx.objectStore('projects'),p=ps.get(project);let reason;
    p.onsuccess=()=>{const current=p.result;if(!current){reason=Error('プロジェクトが見つかりません。');tx.abort();return;}
      const list=tx.objectStore('photos').index('project').getAll(project);list.onsuccess=()=>{if(list.result.some(x=>x.hash===photo.hash)){reason=Error('DUPLICATE');tx.abort();return;}if(list.result.length>=MAX_PHOTOS){reason=Error('LIMIT');tx.abort();return;}
        tx.objectStore('photos').add({...photo,project});tx.objectStore('blobs').add({id:photo.id,project,blob,thumb});ps.put({...current,count:list.result.length+1,updated:Date.now()});};};
    tx.oncomplete=()=>resolve(photo);tx.onerror=()=>reject(reason??tx.error);tx.onabort=()=>reject(reason??tx.error??Error('保存が中断されました。'));
  });
}
export async function invalidate(project){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(['states','results','chunks'],'readwrite');tx.objectStore('states').delete(project);tx.objectStore('results').delete(project);const r=tx.objectStore('chunks').index('project').openCursor(project);r.onsuccess=()=>{const c=r.result;if(c){c.delete();c.continue();}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
export async function deletePhotos(project,ids){
 const db=await openDB(),chosen=new Set(ids);await new Promise((resolve,reject)=>{const tx=db.transaction(['photos','blobs','features','projects'],'readwrite');
  for(const id of ids){tx.objectStore('photos').delete(id);tx.objectStore('blobs').delete(id);}
  const r=tx.objectStore('features').index('project').openCursor(project);r.onsuccess=()=>{const c=r.result;if(c){if(chosen.has(c.value.photoId))c.delete();c.continue();}};
  const p=tx.objectStore('projects').get(project);p.onsuccess=()=>{const r=tx.objectStore('photos').index('project').count(project);r.onsuccess=()=>tx.objectStore('projects').put({...p.result,count:r.result,updated:Date.now()});};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
 });await invalidate(project);
}
export async function deleteProject(id){const photos=await all('photos',id);await deletePhotos(id,photos.map(p=>p.id));await remove('projects',id);}
