const VERSION='0.2.0',status=document.getElementById('update-status'),retry=document.getElementById('update-retry'),progress=document.getElementById('update-progress');let busy=false;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function version(worker){if(!worker)return Promise.resolve(null);return new Promise(resolve=>{const channel=new MessageChannel();let timer;const done=value=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};timer=setTimeout(()=>done(null),900);channel.port1.onmessage=e=>done(e.data?.version||null);try{worker.postMessage({type:'GET_VERSION'},[channel.port2]);}catch{done(null);}});}
async function update(){if(busy)return;busy=true;retry.hidden=true;progress.hidden=false;
 try{
  if(!navigator.serviceWorker||!navigator.locks)throw Error('このブラウザでは更新できません。Chromeでこのページを開いてください。');
  await navigator.locks.request('pocketscan-write',{ifAvailable:true},async lock=>{
   if(!lock)throw Error('別のタブで処理中です。処理を完了または中断してから更新してください。');
   if(await version(navigator.serviceWorker.controller)===VERSION){location.replace('./');return;}
   status.textContent='更新データを読み込んでいます。画面を開いたままお待ちください。';
   const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});await registration.update();
   const deadline=Date.now()+90000;
   while(Date.now()<deadline){
    if(registration.waiting)registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});
    if(await version(navigator.serviceWorker.controller)===VERSION){status.textContent='更新が完了しました。アプリに戻ります。';location.replace('./');return;}
    await delay(350);
   }
   throw Error('更新が完了しませんでした。通信状態を確認して、もう一度お試しください。');
  });
 }catch(e){status.textContent=e.message||'更新データを読み込めませんでした。通信状態を確認してください。';retry.hidden=false;progress.hidden=true;}
 finally{busy=false;}
}
retry.addEventListener('click',update);update();
