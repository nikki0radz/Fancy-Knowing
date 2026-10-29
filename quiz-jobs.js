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
 let data=resume?await api('/quiz-jobs/'+resume.id):await api('/quiz-jobs',{method:'POST',body:{...body,background:true}});
 if(data.job?.background&&data.job.status==='preparing'){
  saveQuizPreparation(owner,{id:data.job.id,body:data.job.setup||body});startQuizPreparationWatcher(owner);
  if(!resume)await new Promise(resolve=>setTimeout(resolve,5000));
  return {queued:true,job:data.job};
 }
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
 try{const data=await prepareQuizInSteps(pending.body,owner,pending);if(user?.id!==owner)return;if(data.queued){showQueuedQuiz(data.job);return}activeGame=data.game;page('gamePlay');renderGame()}catch(e){if(user?.id===owner){toast(e.message);await loadHome()}}finally{gameCreating=false}
}
function showQueuedQuiz(job){
 if($('#gameSetup').hidden)return;
 $('#gameSetup').innerHTML=`<section class="express-loading quiz-background-card" data-queued-quiz="${esc(job.id)}"><div class="express-rocket" aria-hidden="true">🤖</div><p class="express-kicker">QUIZ SENT TO OUR LITTLE ROBOTS</p><h1>Leave it with us.</h1><p class="intro">Your ${esc(job.setup?.topic||'new')} quiz is being researched and checked in the background. You can leave this screen—even close the app.</p><p class="express-status" role="status">${esc(job.label||'The robots are on it…')}</p><p class="express-note">We’ll add a notification when all ${job.setup?.count||''} questions are ready. Phone alerts need to be enabled for this device.</p><button class="primary" id="queuedquizhome">Back to Home</button></section>`;
 $('#queuedquizhome').onclick=loadHome;
}
let quizPreparationWatcher=null,quizPreparationOwner=null;
function startQuizPreparationWatcher(owner){
 if(quizPreparationOwner===owner)return;clearTimeout(quizPreparationWatcher);quizPreparationOwner=owner;
 const check=async()=>{
  if(user?.id!==owner){quizPreparationOwner=null;return}const pending=pendingQuizPreparation();if(!pending){quizPreparationOwner=null;return}
  try{
   const data=await api('/quiz-jobs/'+pending.id);if(user?.id!==owner){quizPreparationOwner=null;return}
   const panel=$('#gameSetup [data-queued-quiz]');
   if(data.game){saveQuizPreparation(owner,null);await refreshChallengeNotifications(false);if(panel?.dataset.queuedQuiz===pending.id){panel.querySelector('h1').textContent='Your quiz is ready!';panel.querySelector('.express-kicker').textContent='ROBOTS REPORT: MISSION COMPLETE';panel.querySelector('.intro').textContent='Every question is checked. Your quiz is ready whenever you are.';panel.querySelector('.express-note').textContent='You can also open it from your notification inbox.';panel.querySelector('.express-status').textContent='The robots have checked every question.';$('#queuedquizhome').textContent='Open my quiz';$('#queuedquizhome').onclick=()=>openGame(data.game.id)}if(!$('#home').hidden)await loadHome();toast('Your '+data.game.topic+' quiz is ready 🤖');quizPreparationOwner=null;return}
   if(data.job?.status==='failed'){saveQuizPreparation(owner,null);await refreshChallengeNotifications(false);if(panel){panel.querySelector('h1').textContent='This one needs another go.';panel.querySelector('.intro').textContent='The robots could not safely finish this quiz. Your app quiz credit has been returned.';panel.querySelector('.express-note').textContent='You can start a new quiz from Home.';panel.querySelector('.express-status').textContent=data.job.error}if(!$('#home').hidden)renderHome();toast(data.job.error);quizPreparationOwner=null;return}
   if(panel?.dataset.queuedQuiz===pending.id)panel.querySelector('.express-status').textContent=data.job.label;
  }catch(e){if(e.status===404){saveQuizPreparation(owner,null);quizPreparationOwner=null;return}}
  quizPreparationWatcher=setTimeout(check,8000);
 };quizPreparationWatcher=setTimeout(check,8000);
}
async function openNoticeResource(notice){
 if(notice.resourceKind==='game')return openGame(notice.resourceId);
 if(notice.resourceKind==='quiz_job'){const data=await api('/quiz-jobs/'+notice.resourceId);if(data.game)return openGame(data.game.id);if(data.job?.status==='preparing'){saveQuizPreparation(user.id,{id:data.job.id,body:data.job.setup});return resumeQuizPreparation()}toast(data.job?.error||'This preparation has finished.');return loadHome()}
 return openRequestThread(notice.resourceKind,notice.resourceId);
}
const homeBeforeQuizPreparation=renderHome;
renderHome=function(){homeBeforeQuizPreparation();const pending=pendingQuizPreparation();if(pending){const button=document.createElement('button');button.id='resumequizpreparation';button.className='home-session';button.textContent='🤖 Preparing your '+(pending.body?.topic||'new')+' quiz · check progress';button.onclick=resumeQuizPreparation;$('#home .home-session-heading').before(button);startQuizPreparationWatcher(user.id)}};
