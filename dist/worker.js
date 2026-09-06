// Classic worker: OpenCV's UMD build uses importScripts; all application modules are ESM.
let stop=false,running=false,cvReady;
function opencv(){if(!cvReady)cvReady=new Promise((resolve,reject)=>{try{importScripts('./vendor/opencv.js');const cv=self.cv;if(cv.Mat)resolve({cv});else{cv.onRuntimeInitialized=()=>resolve({cv});cv.onAbort=()=>reject(Error('3Dエンジンの初期化に失敗しました。'));}}catch(e){reject(e);}});return cvReady;}
const emit=data=>postMessage(data);
onmessage=async event=>{
  if(event.data.type==='pause'){stop=true;return;}
  if(event.data.type!=='run'||running)return;running=true;stop=false;
  const {project,photos:input,config}=event.data;
  try{
    const [db,policy,media,sfm,dense]=await Promise.all([import('./db.mjs'),import('./policy.mjs'),import('./media.mjs'),import('./engine/sfm.mjs'),import('./engine/dense.mjs')]);
    policy.validateCount(input.length);const preset=policy.PRESETS[config.preset]??policy.PRESETS.standard,params={...preset,...config},photos=input.map(p=>({...p,k:policy.intrinsics(p,config.focal35,config.useExif,preset.edge)})),key=policy.configKey(config,photos.map(p=>p.id));
    emit({type:'progress',stage:'load',message:'3Dエンジンを準備しています',done:0,total:1});const {cv}=await opencv();cv.setRNGSeed(42);
    const featureKey=(i,algorithm)=>`${photos[i].id}:${preset.edge}:${preset.features}${algorithm==='orb'?'':':akaze'}`;
    const stateRecord=await db.get('states',project);let state=stateRecord?.key===key?stateRecord.state:null;
    if(stateRecord&&stateRecord.key!==key)await db.invalidate(project);
    const pause=()=>{if(stop)throw Error('PAUSED');};
    const engine=await sfm.reconstructWithFallback(cv,photos,params,{
      prepare:async(algorithm,currentState)=>{
        await db.put('states',{id:project,key,state:currentState,updated:Date.now()});
        for(let i=0;i<photos.length;i++){
          pause();let feature=await db.get('features',featureKey(i,algorithm));
          if(!feature){const blob=(await db.get('blobs',photos[i].id))?.blob;if(!blob)throw Error('写真が見つかりません。再取り込みしてください。');const k=photos[i].k,data=await media.pixels(blob,k.width,k.height),f=sfm.extractFeatures(cv,data,preset.features,algorithm);await db.put('features',{id:featureKey(i,algorithm),project,photoId:photos[i].id,...f});}
          emit({type:'progress',stage:'features',done:i+1,total:photos.length,message:`${algorithm==='akaze'?'細かい模様を再解析':'写真の特徴を解析'} ${i+1} / ${photos.length}`});await new Promise(r=>setTimeout(r,0));
        }
      },
      features:(i,algorithm)=>db.get('features',featureKey(i,algorithm)),
      progress:async p=>{emit({type:'progress',...p});await new Promise(r=>setTimeout(r,0));},
      cancelled:()=>stop,
      save:s=>db.put('states',{id:project,key,state:s,updated:Date.now()})
    },state);
    state=engine.state;pause();
    const sparse=await engine.result();emit({type:'sparse',result:{...sparse,partial:true}});await db.put('results',{id:project,key,result:{...sparse,partial:true},updated:Date.now()});
    if(config.surface&&state.stage==='dense'){
      let chunks=await db.all('chunks',project),vertices=chunks.reduce((n,c)=>n+c.positions.length/3,0);const done=new Set(chunks.map(c=>c.index));chunks=null;
      for(;state.denseIndex<photos.length;state.denseIndex++){
        pause();const i=state.denseIndex;
        if(!done.has(i)&&vertices<preset.maxDense){const j=dense.choosePair(state,i);
          if(j>=0){const p=photos[i],q=photos[j],kA=policy.intrinsics(q,config.focal35,config.useExif,preset.denseEdge),kB=policy.intrinsics(p,config.focal35,config.useExif,preset.denseEdge);
            if(kA.width===kB.width&&kA.height===kB.height){const a=await db.get('blobs',q.id),b=await db.get('blobs',p.id),A=await media.pixels(a.blob,kA.width,kA.height),B=await media.pixels(b.blob,kB.width,kB.height),chunk=dense.densePair(cv,A,B,state.poses[j],state.poses[i],kA,kB,preset.step,preset.maxDense-vertices);
              vertices+=chunk.positions.length/3;await db.put('chunks',{id:`${project}:${i}`,project,index:i,...chunk});}
          }
        }
        emit({type:'progress',stage:'dense',done:i+1,total:photos.length,points:vertices,message:`表面を再構成 ${i+1} / ${photos.length}`});await db.put('states',{id:project,key,state,updated:Date.now()});await new Promise(r=>setTimeout(r,0));
      }
    }
    pause();const chunks=config.surface?await db.all('chunks',project):[],result=dense.mergeChunks(sparse,chunks);result.denseCapped=result.dense.positions.length/3>=preset.maxDense;result.created=Date.now();result.config=config;state.stage='done';await db.put('states',{id:project,key,state,updated:Date.now()});await db.put('results',{id:project,key,result,updated:Date.now()});emit({type:'done',result});
  }catch(e){emit({type:e?.message==='PAUSED'?'paused':'error',code:e?.code||'PROCESSING_ERROR',diagnostics:e?.diagnostics||null,message:e?.message==='PAUSED'?'処理を中断しました。保存済みの解析から再開できます。':(typeof e==='number'?'画像の解析に失敗しました。軽量モードで再試行してください。':e?.message||'3D処理に失敗しました。')});}finally{running=false;}
};
