import * as db from './db.mjs';
import {preparePhoto} from './media.mjs';
import {MAX_PHOTOS,orderPhotos,PRESETS,configKey} from './policy.mjs';
import {exportModel} from './export.mjs';
import {canResume,restoreRun,runPresentation,diagnosticSummary} from './run-state.mjs';
const $=id=>document.getElementById(id),fmt=n=>Number(n).toLocaleString('ja-JP'),PAGE_SIZE=24;
let project,photos=[],result=null,viewer=null,viewMode='points',page=0,selected=new Set(),selecting=false,busy=null,worker=null,stopImport=false,hasCheckpoint=false,viewerLoading=null,urls=[],renderSerial=0,runStarted=0,timer,wake,installPrompt,toastTimer,activeTab='photos',runState='idle',runError=null,lastProgress=null;
const defaults={preset:navigator.deviceMemory&&navigator.deviceMemory<=4?'light':'standard',focal35:26,useExif:true,surface:true,sort:'capture'};
const bytes=n=>n>=1024**3?`${(n/1024**3).toFixed(2)} GB`:`${(n/1024**2).toFixed(1)} MB`;
function notice(text,type=''){const e=$('message');e.textContent=text;e.className=`notice ${type}`;e.hidden=!text;}
function toast(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function on(id,event,fn){$(id).addEventListener(event,e=>{try{Promise.resolve(fn(e)).catch(error=>notice(humanError(error),'error'));}catch(error){notice(humanError(error),'error');}});}
function humanError(e){if(e?.name==='QuotaExceededError')return '端末の保存容量が不足しています。不要なプロジェクトを削除するか、写真を減らしてください。保存済みの写真から再開できます。';return e?.message||'処理に失敗しました。ページを開き直してください。';}
async function exclusive(fn){if(navigator.locks)return navigator.locks.request('pocketscan-write',{ifAvailable:true},async lock=>{if(!lock)throw Error('別のタブで処理中です。処理を中断してから操作してください。');return fn();});throw Error('このブラウザでは安全に保存できません。Chrome最新版で開いてください。');}
function confirmAction(title,message){const d=$('confirm-dialog');$('confirm-title').textContent=title;$('confirm-message').textContent=message;return new Promise(resolve=>{d.returnValue='cancel';d.addEventListener('close',()=>resolve(d.returnValue==='yes'),{once:true});$('confirm-no').onclick=()=>d.close('cancel');$('confirm-yes').onclick=()=>d.close('yes');d.showModal();});}
function editName(title,value=''){const d=$('edit-dialog');$('edit-title').textContent=title;$('name-input').value=value;d.returnValue='cancel';return new Promise(resolve=>{d.addEventListener('close',()=>resolve(d.returnValue==='save'?$('name-input').value.trim():null),{once:true});d.showModal();$('name-input').focus();});}
async function patchProject(changes){const current=await db.get('projects',project.id);project=await db.put('projects',{...current,...changes,updated:Date.now()});}
async function projectsList(){const list=(await db.all('projects')).sort((a,b)=>b.updated-a.updated);$('project-select').replaceChildren(...list.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;return o;}));if(project)$('project-select').value=project.id;return list;}
function applySettings(){const c=project.config;document.querySelectorAll('[name=quality]').forEach(e=>e.checked=e.value===c.preset);$('surface-setting').checked=c.surface;$('exif-setting').checked=c.useExif;$('focal-setting').value=c.focal35;$('sort-order').textContent={capture:'撮影順',name:'ファイル名順',added:'追加順'}[c.sort]||'撮影順';}
function setBusy(value){busy=value;for(const id of ['add-photos','take-photo','new-project','rename-project','project-select','sort-order','select-photos','delete-selected','selection-done','delete-project'])$(id).disabled=!!value;document.querySelectorAll('#panel-settings input').forEach(e=>e.disabled=!!value);$('start').hidden=value==='run';$('pause').hidden=value!=='run';$('restart').hidden=!!value||!hasCheckpoint;updateStart();}
function renderRunError(){
 const show=runState==='failed'&&runError&&!busy;
 $('run-error').hidden=!show;
 if(show){$('run-error-message').textContent=runError.message;$('run-error-details').textContent=diagnosticSummary(runError.diagnostics);}
}
function updateStart(){
 const supported=!!(window.Worker&&window.indexedDB&&window.OffscreenCanvas&&window.createImageBitmap&&window.isSecureContext&&navigator.locks),complete=result&&!result.partial,presentation=runPresentation(runState,hasCheckpoint);
 $('start').disabled=!!busy||photos.length<3||!supported;
 $('start-label').textContent=complete?'3Dを表示':presentation?.button||'3Dを作成';
 $('run-state').textContent=busy==='run'?'処理中':busy==='import'?'取込中':complete?'完了':presentation?.badge||(photos.length>=3?'準備完了':'準備中');
 $('run-state').dataset.status=busy||runState;
 if(!busy){
  $('process-title').textContent=complete?'立体を、手元に。':presentation?.title||'写真から、立体へ。';
  $('process-description').textContent=complete?`${fmt(result.registered)} / ${fmt(result.total)}枚から再構成しました。`:presentation?.description||(photos.length>=3?`${fmt(photos.length)}枚 · ${PRESETS[project.config.preset].label}モードで再構成します。`:'写真を3枚以上追加すると、3Dを作成できます。');
 }
 $('restart').hidden=!!busy||(!hasCheckpoint&&!result);
 renderRunError();
}
async function loadProject(id){
 project=await db.get('projects',id);if(!project)throw Error('プロジェクトが見つかりません。');
 project.config={...defaults,...project.config};photos=orderPhotos(await db.all('photos',id),project.config.sort);result=(await db.get('results',id))?.result??null;
 const restored=restoreRun(project,result,await db.get('states',id),configKey(project.config,photos.map(p=>p.id)));
 runState=restored.status;runError=restored.error;hasCheckpoint=restored.resumable;lastProgress=project.runProgress||null;
 page=0;selected.clear();selecting=false;applySettings();$('project-name').textContent=project.name;$('project-date').textContent=`${new Date(project.updated).toLocaleDateString('ja-JP')} · この端末に保存`;$('project-select').value=id;
 try{localStorage.setItem('pocketscan-project',id);}catch{}
 notice('');setBusy(null);await renderGallery();showResult(result);
 if(result&&!result.partial)progress({stage:'done',done:1,total:1,message:'再構成が完了しました'});
 else if(lastProgress)progress(lastProgress);
 else{$('progress-text').textContent=runState==='failed'?'再構成に失敗しました':hasCheckpoint?'再開できます':photos.length?'作成できます':'写真待ち';$('run-bar').value=0;$('progress-percent').textContent='—';document.querySelectorAll('.steps li').forEach(e=>{e.className='';e.querySelector('.step-state').textContent='';});}
 updateStart();await updateStorage();
}
async function createProject(name){const p={id:crypto.randomUUID(),name,created:Date.now(),updated:Date.now(),count:0,config:{...defaults},started:false};await db.put('projects',p);await projectsList();await loadProject(p.id);showTab('photos');}
async function renderGallery(){
 const serial=++renderSerial;urls.forEach(URL.revokeObjectURL);urls=[];const gallery=$('photo-gallery');gallery.replaceChildren();page=Math.min(page,Math.max(0,Math.ceil(photos.length/PAGE_SIZE)-1));const shown=photos.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
 $('photo-summary').textContent=`${fmt(photos.length)} / 1,000枚${photos.length?' · '+bytes(photos.reduce((n,p)=>n+p.size,0)):''}`;$('tab-count').textContent=fmt(photos.length);$('dropzone').classList.toggle('has-photos',photos.length>0);$('gallery-controls').hidden=!photos.length;$('gallery-pagination').hidden=photos.length<=PAGE_SIZE;$('page-label').textContent=photos.length?`${page*PAGE_SIZE+1}–${page*PAGE_SIZE+shown.length} / ${fmt(photos.length)}枚`:'';$('page-number').textContent=`${page+1} / ${Math.max(1,Math.ceil(photos.length/PAGE_SIZE))}`;$('prev-page').disabled=page===0;$('next-page').disabled=(page+1)*PAGE_SIZE>=photos.length;
 for(let j=0;j<shown.length;j++){
  const p=shown[j],record=await db.get('blobs',p.id);if(serial!==renderSerial)return;if(!record)continue;const url=URL.createObjectURL(record.thumb);urls.push(url);const button=document.createElement('button');button.className=`photo-card${selected.has(p.id)?' selected':''}`;button.setAttribute('aria-label',`${page*PAGE_SIZE+j+1}: ${p.name}${selecting?' を選択':''}`);button.setAttribute('aria-pressed',String(selected.has(p.id)));button.title=`${p.name}\n${p.originalWidth} × ${p.originalHeight}${p.focal35?' / '+p.focal35+'mm':''}`;button.disabled=!!busy;
  const img=document.createElement('img');img.src=url;img.alt=p.name;img.loading='lazy';const no=document.createElement('span');no.className='photo-index';no.textContent=String(page*PAGE_SIZE+j+1).padStart(3,'0');button.append(img,no);button.onclick=()=>{if(busy)return;if(!selecting){toast(`${p.name} · ${p.originalWidth}×${p.originalHeight}${p.focal35?' · '+p.focal35+'mm':''}`);return;}selected.has(p.id)?selected.delete(p.id):selected.add(p.id);button.classList.toggle('selected',selected.has(p.id));button.setAttribute('aria-pressed',String(selected.has(p.id)));updateSelection();};gallery.append(button);
 }updateSelection();updateStart();
}
function updateSelection(){$('select-photos').hidden=selecting;$('selection-done').hidden=!selecting;$('delete-selected').hidden=!selecting;$('delete-selected').disabled=!selected.size||!!busy;$('delete-selected').textContent=`${selected.size}枚を削除`;}
async function resetResult(){await db.invalidate(project.id);await patchProject({started:false,runStatus:'idle',runError:null,runProgress:null});result=null;hasCheckpoint=false;runState='idle';runError=null;lastProgress=null;showResult(null);$('run-bar').value=0;updateStart();}
async function importFiles(files){
 if(busy||!files.length)return;const list=Array.from(files);await exclusive(async()=>{
  if(photos.length>=MAX_PHOTOS)throw Error('最大1,000枚です。写真を削除するか、新しいプロジェクトを作成してください。');
  if(hasCheckpoint||result){if(!await confirmAction('写真セットを変更しますか？','写真を追加すると、現在の3D結果と再開データを破棄します。必要な3Dデータは先に書き出してください。'))return;await resetResult();}
  if(!hasCheckpoint&&!result&&(runState==='failed'||runState==='interrupted'))await resetResult();
  setBusy('import');stopImport=false;$('import-progress').hidden=false;notice('');let added=0,dupes=0,failed=[],limit=0;
  try{const known=new Set(photos.map(p=>p.hash));
   for(let i=0;i<list.length;i++){
    if(stopImport)break;if(photos.length+added>=MAX_PHOTOS){limit=list.length-i;break;}
    $('import-label').textContent=`写真を保存 ${i+1} / ${fmt(list.length)}`;$('import-bar').value=(i/list.length)*100;
    try{const data=await preparePhoto(list[i]);if(known.has(data.photo.hash)){dupes++;continue;}await db.addPhoto(project.id,data.photo,data.blob,data.thumb);known.add(data.photo.hash);added++;}
    catch(e){if(e.message==='DUPLICATE'){dupes++;continue;}if(e.message==='LIMIT'){limit=list.length-i;break;}if(e.name==='QuotaExceededError')throw e;failed.push(`${list[i].name}: ${humanError(e)}`);}
    await new Promise(r=>setTimeout(r,0));
   }
   const summary=[`${fmt(added)}枚を追加しました。`,dupes?`重複${dupes}枚は追加していません。`:'',limit?`1,000枚の上限に達したため、残り${fmt(limit)}枚は追加していません。`:'',stopImport?'取り込みを中止しました。':'',failed.length?`${failed.length}枚を読み込めませんでした。${failed.slice(0,3).join(' / ')}`:''].filter(Boolean).join(' ');notice(summary,failed.length||limit?'warning':'');
  }finally{photos=orderPhotos(await db.all('photos',project.id),project.config.sort);project=await db.get('projects',project.id);$('import-progress').hidden=true;setBusy(null);page=Math.max(0,Math.ceil(photos.length/PAGE_SIZE)-1);await renderGallery();await projectsList();await updateStorage();$('files').value='';$('camera-file').value='';}
 });
}
async function ensureViewer(){if(viewer)return viewer;if(viewerLoading)return viewerLoading;viewerLoading=(async()=>{try{const {Viewer}=await import('./viewer.mjs');viewer=new Viewer($('model-canvas'));viewer.onError=e=>notice(e,'warning');if(result)viewer.set(result,viewMode);return viewer;}catch{notice('この端末では3D表示を開始できません。再構成とファイルの書き出しは利用できます。','warning');return null;}})();return viewerLoading;}
async function showTab(tab){activeTab=tab;for(const t of ['photos','model','settings']){const b=$('tab-'+t);b.setAttribute('aria-selected',String(t===tab));b.tabIndex=t===tab?0:-1;$('panel-'+t).hidden=t!==tab;}if(tab==='model'){await ensureViewer();viewer?.fitCanvas();}if(tab==='settings')await updateStorage();}
function showResult(r){result=r;viewMode='points';$('viewer-empty').hidden=!!r?.positions.length;$('export-open').disabled=!r?.positions.length;$('view-mesh').disabled=!r?.dense?.indices.length;$('result-stats').hidden=!r;$('result-notice').hidden=!r;$('view-points').setAttribute('aria-pressed','true');$('view-mesh').setAttribute('aria-pressed','false');$('model-subtitle').textContent=r?'指1本で回転 · 2本で移動・拡大縮小':'再構成した形状を確認';if(!r){viewer?.clear();return;}
 const dense=r.dense?.positions.length/3||0,items=[[fmt(dense||r.positions.length/3),'3D点'],[`${fmt(r.registered)} / ${fmt(r.total)}`,'使用できた写真'],[fmt((r.dense?.indices.length||0)/3),'三角形']];$('result-stats').replaceChildren(...items.map(([value,label])=>{const d=document.createElement('div'),s=document.createElement('strong'),l=document.createElement('span');s.textContent=value;l.textContent=label;d.append(s,l);return d;}));
 const n=$('result-notice');n.replaceChildren();const p=document.createElement('p');p.textContent=`${r.partial?'途中までの結果です。処理を再開できます。 ':''}縮尺は任意です。${r.dense?.indices.length?'表面は部分メッシュです。穴や重なりが残る場合があります。':'点群を再構成しました。表面を作れた領域はありません。'}${r.capped||r.denseCapped?' 端末負荷を抑えるため、出力点数の上限に達した後は点を追加していません。':''}`;n.append(p);
 if(r.skipped?.length){const d=document.createElement('details'),s=document.createElement('summary'),u=document.createElement('ul');s.textContent=`撮影位置を特定できなかった写真：${r.skipped.length}枚`;for(const name of r.skipped){const li=document.createElement('li');li.textContent=name;u.append(li);}d.append(s,u);n.append(d);}if(viewer)viewer.set(r,viewMode);updateStart();
}
function progress(p){lastProgress=p;const per=Math.round(Math.min(100,p.done/Math.max(1,p.total)*100));$('progress-text').textContent=p.message;$('progress-percent').textContent=`${per}%`;$('run-bar').value=per;if(p.points!==undefined)$('live-points').textContent=`${fmt(p.points)} 点`;if(p.registered!==undefined)$('process-description').textContent=`${fmt(p.registered)}枚の撮影位置を特定しました。`;
 const stage={load:0,features:0,seed:1,align:1,refine:2,dense:2,done:3}[p.stage]??0;document.querySelectorAll('.steps li').forEach((e,i)=>{e.className=i<stage?'complete':i===stage?'active':'';e.querySelector('.step-state').textContent=i<stage?'✓':'';});}
async function keepAwake(){try{if(navigator.wakeLock&&document.visibilityState==='visible')wake=await navigator.wakeLock.request('screen');}catch{}}
async function run(restart=false){
 if(busy)return;if(result&&!result.partial&&!restart){showTab('model');return;}
 await exclusive(async()=>{
  if(restart){if(!await confirmAction('最初から再計算しますか？','現在の3D結果と再開データを破棄し、保存済みの写真から再構成します。'))return;await resetResult();}
  const c={...project.config};if(!Number.isFinite(c.focal35)||c.focal35<10||c.focal35>200)throw Error('焦点距離を10〜200mmで入力してください。');
  let outcome;
  try{
   const estimate=await navigator.storage?.estimate?.();if(estimate?.quota&&estimate.quota-estimate.usage<120*1024**2)throw Error('計算結果を保存する空き容量が不足しています。120MB以上を確保してください。');
   runState='running';runError=null;lastProgress=null;setBusy('run');notice('');
   await patchProject({started:true,runStatus:'running',runError:null,runProgress:null});
   $('pause').disabled=false;$('pause').textContent='中断して保存';$('process-title').textContent='立体を再構成しています。';runStarted=Date.now();
   timer=setInterval(()=>{const s=Math.floor((Date.now()-runStarted)/1000);$('elapsed').textContent=`経過 ${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;},1000);await keepAwake();
   outcome=await new Promise((resolve,reject)=>{
    worker=new Worker('./worker.js');
    worker.onmessage=e=>{const m=e.data;
     if(m.type==='progress')progress(m);
     else if(m.type==='sparse'){showResult(m.result);$('process-title').textContent='表面を再構成しています。';}
     else if(['done','paused','error'].includes(m.type))resolve(m);
    };
    worker.onerror=e=>{e.preventDefault();resolve({type:'error',code:'WORKER_ERROR',message:'3Dエンジンが停止しました。設定を「軽量」にして再試行してください。写真は端末に残っています。'});};
    worker.onmessageerror=()=>resolve({type:'error',code:'MESSAGE_ERROR',message:'計算結果を受け取れませんでした。設定を「軽量」にして再試行してください。'});
    worker.postMessage({type:'run',project:project.id,photos,config:c});
   });
   if(outcome.type==='done'){runState='done';runError=null;showResult(outcome.result);progress({stage:'done',done:1,total:1,message:'再構成が完了しました'});toast('3Dデータを保存しました。');showTab('model');}
   else if(outcome.type==='paused'){runState='paused';runError=null;notice(outcome.message);}
   else{runState='failed';runError={message:outcome.message,code:outcome.code,diagnostics:outcome.diagnostics||null};}
  }catch(e){runState='failed';runError={message:humanError(e),code:e.code||'PROCESSING_ERROR'};}
  finally{
   worker?.terminate();worker=null;clearInterval(timer);try{await wake?.release?.();}catch{}wake=null;
   try{hasCheckpoint=canResume(await db.get('states',project.id),configKey(c,photos.map(p=>p.id)));await patchProject({runStatus:runState,runError,runProgress:lastProgress});}catch(e){notice('処理状態を保存できませんでした。端末の空き容量を確認してください。','warning');}
   setBusy(null);await updateStorage();
   if(runState==='failed'){$('run-error').scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});$('run-error').focus({preventScroll:true});}
  }
 });
}
async function settingsChanged(){if(busy)return;const c={...project.config,preset:document.querySelector('[name=quality]:checked').value,surface:$('surface-setting').checked,useExif:$('exif-setting').checked,focal35:Number($('focal-setting').value)};if(!Number.isFinite(c.focal35)||c.focal35<10||c.focal35>200){$('focal-setting').setCustomValidity('10〜200mmで入力してください');$('focal-setting').reportValidity();return;}$('focal-setting').setCustomValidity('');if(JSON.stringify(c)===JSON.stringify(project.config))return;await exclusive(async()=>{if((hasCheckpoint||result)&&!await confirmAction('設定を変更しますか？','現在の3D結果と再開データを破棄します。次回は新しい設定で再計算します。')){applySettings();return;}await resetResult();await patchProject({config:c});applySettings();updateStart();});}
async function updateStorage(){try{const e=await navigator.storage?.estimate?.();$('storage-detail').textContent=e?.quota?`${bytes(e.usage)} / ${bytes(e.quota)}`:'このブラウザでは取得できません';$('storage-bar').value=e?.quota?e.usage/e.quota*100:0;const persisted=await navigator.storage?.persisted?.();$('persist-state').textContent=persisted?'保存領域の保持：許可済み':'保存領域の保持はブラウザが判断します。';$('persist-storage').disabled=!!persisted;}catch{$('storage-detail').textContent='容量を取得できません';}}
function exportFile(){if(!result)throw Error('先に3Dを作成してください。');const format=$('export-format').value,mode=$('export-mode').value,blob=exportModel(result,format,mode),name=`${project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,60)||'scan'}-${mode}.${format}`;return new File([blob],name,{type:blob.type});}
async function init(){
 await db.openDB();const list=await projectsList();let saved;try{saved=localStorage.getItem('pocketscan-project');}catch{}if(list.length)await loadProject(list.some(p=>p.id===saved)?saved:list[0].id);else await exclusive(()=>createProject('新しいスキャン'));
 $('device-info').textContent=`${/Android/.test(navigator.userAgent)?'Android':/iPhone|iPad/.test(navigator.userAgent)?'iOS':'ブラウザ'}${navigator.deviceMemory?' · RAM '+navigator.deviceMemory+'GB級':''}`;
 if(!window.Worker||!window.OffscreenCanvas||!window.createImageBitmap||!window.isSecureContext||!navigator.locks)notice('このブラウザでは3D処理に必要な機能が不足しています。AndroidのChrome最新版で開いてください。','warning');
 if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});navigator.serviceWorker.ready.then(()=>{$('offline-state').textContent='オフライン準備済み';}).catch(()=>{});}catch{$('offline-state').textContent='オンラインで利用';toast('オフライン用の保存ができませんでした。通信した状態でご利用ください。');}}
}
for(const b of document.querySelectorAll('[data-tab]')){b.addEventListener('click',()=>showTab(b.dataset.tab));b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=['photos','model','settings'];let i=tabs.indexOf(b.dataset.tab);i=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;showTab(tabs[i]);$('tab-'+tabs[i]).focus();});}
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>b.closest('dialog').close();
on('run-error-add','click',()=>{showTab('photos');$('files').click();});on('run-error-guide','click',()=>$('guide-dialog').showModal());
on('update-app','click',e=>{if(busy){e.preventDefault();toast('処理を中断してから更新してください。');}});
on('guide-open','click',()=>$('guide-dialog').showModal());on('guide-inline','click',()=>$('guide-dialog').showModal());
on('add-photos','click',()=>$('files').click());on('take-photo','click',()=>$('camera-file').click());on('files','change',e=>importFiles(e.target.files));on('camera-file','change',e=>importFiles(e.target.files));
on('dropzone','dragover',e=>{e.preventDefault();if(!busy)$('dropzone').classList.add('dragging');});on('dropzone','dragleave',()=>$('dropzone').classList.remove('dragging'));on('dropzone','drop',e=>{e.preventDefault();$('dropzone').classList.remove('dragging');return importFiles(e.dataTransfer.files);});on('cancel-import','click',()=>{stopImport=true;});
on('prev-page','click',async()=>{page--;await renderGallery();});on('next-page','click',async()=>{page++;await renderGallery();});on('select-photos','click',async()=>{selecting=true;await renderGallery();});on('selection-done','click',async()=>{selecting=false;selected.clear();await renderGallery();});
on('delete-selected','click',()=>exclusive(async()=>{if(busy||!selected.size)return;if(!await confirmAction(`${selected.size}枚を削除しますか？`,'選択した写真と現在の再構成結果を、このプロジェクトから削除します。元の写真は残ります。'))return;await db.deletePhotos(project.id,[...selected]);await patchProject({started:false,runStatus:'idle',runError:null,runProgress:null});await loadProject(project.id);}));
on('rename-project','click',async()=>{if(busy)return;const name=await editName('プロジェクト名',project.name);if(name)await exclusive(async()=>{await patchProject({name});$('project-name').textContent=name;await projectsList();});});on('new-project','click',async()=>{if(busy)return;const name=await editName('新しいプロジェクト',`スキャン ${new Date().toLocaleDateString('ja-JP')}`);if(name)await exclusive(()=>createProject(name));});on('project-select','change',e=>{if(!busy)return loadProject(e.target.value);});
on('delete-project','click',()=>exclusive(async()=>{if(busy)return;if(!await confirmAction('プロジェクトを削除しますか？','保存した写真・3D結果を削除します。この操作は取り消せません。'))return;await db.deleteProject(project.id);const list=await projectsList();if(list.length)await loadProject(list[0].id);else await createProject('新しいスキャン');}));
on('sort-order','click',()=>exclusive(async()=>{if(busy)return;if((hasCheckpoint||result)&&!await confirmAction('写真の順序を変えますか？','現在の再構成結果を破棄し、次回は新しい順序で計算します。'))return;await resetResult();const order=['capture','name','added'];await patchProject({config:{...project.config,sort:order[(order.indexOf(project.config.sort)+1)%3]}});applySettings();photos=orderPhotos(photos,project.config.sort);page=0;await renderGallery();}));
for(const e of document.querySelectorAll('#panel-settings input'))e.addEventListener('change',()=>settingsChanged().catch(error=>{applySettings();notice(humanError(error),'error');}));
on('start','click',()=>run());on('restart','click',()=>run(true));on('pause','click',()=>{worker?.postMessage({type:'pause'});$('pause').disabled=true;$('pause').textContent='現在の写真の処理を終えて保存中…';});
on('reset-view','click',()=>viewer?.reset());on('view-points','click',()=>{viewMode='points';if(result)viewer?.set(result,viewMode);$('view-points').setAttribute('aria-pressed','true');$('view-mesh').setAttribute('aria-pressed','false');});on('view-mesh','click',()=>{viewMode='mesh';if(result)viewer?.set(result,viewMode);$('view-points').setAttribute('aria-pressed','false');$('view-mesh').setAttribute('aria-pressed','true');});on('show-grid','change',e=>viewer?.toggleGrid(e.target.checked));on('point-size','input',e=>viewer?.setSize(Number(e.target.value)));
on('export-open','click',()=>{const o=$('export-mode').querySelector('[value=mesh]');o.disabled=!result?.dense?.indices.length;$('export-mode').value=viewMode==='mesh'&&!o.disabled?'mesh':'points';$('export-share').hidden=!navigator.share||!navigator.canShare;$('export-dialog').showModal();});on('export-save','click',()=>{const f=exportFile(),url=URL.createObjectURL(f),a=document.createElement('a');a.href=url;a.download=f.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('保存を開始しました。ブラウザのダウンロードをご確認ください。');});on('export-share','click',async()=>{const file=exportFile();if(!navigator.canShare({files:[file]}))throw Error('この形式は共有できません。「ファイルを保存」を使用してください。');try{await navigator.share({files:[file]});}catch(e){if(e.name!=='AbortError')throw e;}});
on('persist-storage','click',async()=>{const ok=await navigator.storage?.persist?.();await updateStorage();toast(ok?'保存領域の保持が許可されました。':'保持はブラウザの判断です。大切な3Dデータは書き出して保存してください。');});window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});on('install-app','click',async()=>{if(installPrompt){await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;}else toast('Chromeのメニュー →「ホーム画面に追加」。iPhoneではSafariの共有 →「ホーム画面に追加」。');});
document.addEventListener('visibilitychange',()=>{if(busy==='run'&&document.visibilityState==='visible')keepAwake();});window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});window.addEventListener('error',()=>{if(!busy)notice('画面の処理でエラーが発生しました。ページを開き直してください。保存済みのデータは残っています。','error');});
init().catch(e=>notice(humanError(e),'error'));
