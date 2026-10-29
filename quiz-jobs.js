function pendingQuizPreparation(){try{return user?JSON.parse(localStorage.getItem('fk-quiz-preparing:'+user.id)||'null'):null}catch{return null}}
function saveQuizPreparation(owner,value){try{if(value)localStorage.setItem('fk-quiz-preparing:'+owner,JSON.stringify(value));else localStorage.removeItem('fk-quiz-preparing:'+owner)}catch{}}
function updateQuizPreparation(label,body){
 if($('#gameSetup').hidden)return;
 const current=$('#gameSetup .express-loading'),setupKey=body?JSON.stringify(body):null;
 if(body&&(!current||current.dataset.setup!==setupKey)){$('#gameSetup').innerHTML=expressLoading(body);$('#gameSetup .express-loading').dataset.setup=setupKey}
 const target=$('#gameSetup .express-status span:last-child');if(target)target.textContent=label;
 const note=$('#gameSetup .express-note');if(note)note.textContent='Progress is saved between steps. If the connection stops, you can resume from Home.';
}
async function prepareQuizInSteps(body,owner,resume=null){
 let data=resume?{job:{id:resume.id,status:'preparing',setup:resume.body}}:await api('/quiz-jobs',{method:'POST',body});
 for(let step=0;step<120;step++){
  if(user?.id!==owner)throw Error('Signed out while preparing the quiz.');
  if(data.game){saveQuizPreparation(owner,null);return data}
  if(!data.job)throw Error('The quiz preparation could not be read. Refresh and try again.');
  if(data.job.status==='failed'){saveQuizPreparation(owner,null);const error=new Error(data.job.error||'We could not prepare this quiz. Please try again.');error.quizJobFailed=true;throw error}
  body=data.job.setup||body;saveQuizPreparation(owner,{id:data.job.id,body});updateQuizPreparation(data.job.label||'Continuing your saved quiz…',body);
  if(data.busy)await new Promise(resolve=>setTimeout(resolve,1800));
  try{data=await api('/quiz-jobs/'+data.job.id+'/advance',{method:'POST',body:{}})}catch(e){if(e.status===404){saveQuizPreparation(owner,null);e.quizJobFailed=true;e.message='This saved preparation has expired. Start a fresh quiz.'}else e.message+=' Your quiz progress is saved; resume it from Home.';throw e}
 }
 throw Error('Your quiz is taking longer than expected. Resume its saved preparation from Home.');
}
async function resumeQuizPreparation(){
 if(gameCreating)return toast('Your quiz is already being prepared.');const pending=pendingQuizPreparation();if(!pending)return;
 const owner=user.id;gameCreating=true;page('gameSetup');$('#gameSetup').innerHTML=expressLoading(pending.body);
 try{const data=await prepareQuizInSteps(pending.body,owner,pending);if(user?.id!==owner)return;activeGame=data.game;page('gamePlay');renderGame()}catch(e){if(user?.id===owner){toast(e.message);await loadHome()}}finally{gameCreating=false}
}
const homeBeforeQuizPreparation=renderHome;
renderHome=function(){homeBeforeQuizPreparation();const pending=pendingQuizPreparation();if(pending){const button=document.createElement('button');button.id='resumequizpreparation';button.className='home-session';button.textContent='↻ Finish preparing your '+(pending.body?.topic||'saved')+' quiz';button.onclick=resumeQuizPreparation;$('#home .home-session-heading').before(button)}};
