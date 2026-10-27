export function compareResults(a,b){const score=(b.score??-1)-(a.score??-1);if(score)return score;return Number.isFinite(a.elapsed_ms)&&Number.isFinite(b.elapsed_ms)?a.elapsed_ms-b.elapsed_ms:0}
export function rankPlayers(players){
 const finished=players.filter(p=>p.completed_at).sort((a,b)=>(b.score??-1)-(a.score??-1)),ranked=[];
 while(finished.length){const score=finished[0].score,bucket=finished.splice(0,finished.findIndex(p=>p.score!==score)<0?finished.length:finished.findIndex(p=>p.score!==score)),timed=bucket.every(p=>Number.isFinite(p.elapsed_ms));if(timed)bucket.sort((a,b)=>a.elapsed_ms-b.elapsed_ms);const offset=ranked.length;let rank=offset+1;bucket.forEach((p,i)=>{if(timed&&i&&p.elapsed_ms!==bucket[i-1].elapsed_ms)rank=offset+i+1;ranked.push({...p,rank,timingAvailable:timed})});
 }return ranked;
}
export function resultNotice(finisher,recipient,count){
 const score=`${finisher.score}/${count}`,comp=compareResults(finisher,recipient);
 if(!recipient?.completed_at)return `${finisher.name} completed your challenge · ${score}`;
 if(comp<0)return `${finisher.name} beat you · ${score}${finisher.score===recipient.score?' with a faster time':''}`;
 if(comp>0)return `${finisher.name} finished · ${score}. You’re still ahead!`;
 return `${finisher.name} matched your ${score}${Number.isFinite(finisher.elapsed_ms)&&Number.isFinite(recipient.elapsed_ms)?' and time':''}`;
}
