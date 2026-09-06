export function canResume(record,key){return !!(record?.key===key&&record.state?.stage!=='seed'&&record.state?.poses?.some(Boolean));}
export function restoreRun(project,result,record,key){
  const resumable=canResume(record,key);
  if(result&&!result.partial)return {status:'done',error:null,resumable};
  if(project.runStatus==='failed')return {status:'failed',error:project.runError||{message:'前回の再構成に失敗しました。写真と設定を確認して再試行してください。'},resumable};
  if(project.runStatus==='paused')return {status:'paused',error:null,resumable};
  if(project.started||resumable)return {status:'interrupted',error:null,resumable};
  return {status:'idle',error:null,resumable:false};
}
export function runPresentation(status,resumable){
  switch(status){
    case 'failed':return {badge:'失敗',title:'3Dを作成できませんでした。',button:'再試行',description:'停止理由を確認してください。写真を追加したり、設定を変更して再試行できます。'};
    case 'paused':return {badge:'中断中',title:'処理を中断しました。',button:'続きから再開',description:'保存済みの写真と解析を使って、処理を再開できます。'};
    case 'interrupted':return {badge:'未完了',title:'前回の処理は未完了です。',button:resumable?'続きから再開':'再試行',description:resumable?'保存した撮影位置から処理を再開できます。':'保存した写真から、この版でもう一度処理を開始できます。'};
    default:return null;
  }
}
export function diagnosticSummary(d){
  if(!d)return '';
  const featureCounts=d.featureCounts||[];
  return [`写真 ${d.photos}枚`,`確認 ${d.checkedPairs} / ${d.pairs}組`,`共通点 最大${d.maxMatches}点`,featureCounts.length?`特徴点 最大${Math.max(...featureCounts)}点`:''].filter(Boolean).join(' · ');
}
