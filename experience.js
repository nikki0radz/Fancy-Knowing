// A short first-run guide, saved to the account so it resumes across devices.
let walkthroughBusy=false;
function stopWalkthrough(){document.querySelectorAll('.walkthrough-card').forEach(n=>n.remove());document.querySelectorAll('.walkthrough-highlight').forEach(n=>n.classList.remove('walkthrough-highlight'));$('#experienceDialog')?.close()}
async function saveWalkthrough(step){const owner=user?.id;if(!owner)return false;const data=await api('/account/walkthrough',{method:'PUT',body:{step}});if(user?.id!==owner)return false;user.walkthrough=data.step;return true}
async function finishWalkthrough(){if(walkthroughBusy)return;walkthroughBusy=true;try{if(await saveWalkthrough('done')){stopWalkthrough();await loadHome()}}catch(e){toast(e.message)}finally{walkthroughBusy=false}}
async function resumeWalkthrough(){
 if(!user||needsProfileSetup()||user.walkthrough==='done')return;
 const owner=user.id,step=user.walkthrough;
 stopWalkthrough();
 if(step==='welcome'){await loadHome();if(user?.id===owner)showWalkthroughCard('welcome');return}
 if(step==='question'||step==='deeper'){await loadToday(0);if(user?.id===owner){if(current?.attempt&&user.walkthrough==='question')await saveWalkthrough('deeper');updateQuestionWalkthrough()}return}
 if(step==='profile'){await openMyProfile();if(user?.id===owner)showWalkthroughCard(step);return}
 if(step==='friends'){friendHubTab='friends';await openFriendsHub();if(user?.id===owner)showWalkthroughCard(step)}
}
const walkthroughCopy={
 welcome:['💡','A little knowing, every day.','You start with one trivia question a day. Fancy more? Change it in Settings, or tap “Ask me another question” for an extra one today.','Try my first question'],
 question:['🎯','Your first little discovery.','Take a guess below. You’ll see the correct answer and a short explanation — getting it wrong is part of learning.',''],
 deeper:['✨','Follow that little spark.','Dive deeper lets you ask OpenAI follow-up questions. Try a suggested question or type your own. It’s optional. Tap the heart to save a discovery and revisit it later.','Show my profile'],
 profile:['📖','Your own field journal.','Your profile shows your learning, strongest topics and topics to practise. It starts filling up as you answer more questions. Tap your photo from Home to come back here.','Meet the friends bit'],
 friends:['🏆','A little friendly competition.','Add friends using their unique username, then create a challenge. Or share a quiz link — guests only need a name. Everyone can play in their own time.','That’s me ready!']
};
function showWalkthroughCard(step){
 if(!user||user.walkthrough!==step)return;
 document.querySelectorAll('.walkthrough-card').forEach(n=>n.remove());document.querySelectorAll('.walkthrough-highlight').forEach(n=>n.classList.remove('walkthrough-highlight'));
 const [emoji,title,copy,action]=walkthroughCopy[step]||walkthroughCopy.welcome;
 const host=step==='welcome'?$('#home'):step==='profile'?$('#myprofile'):step==='friends'?$('#friends'):$('#today');if(!host||host.hidden)return;
 const n=document.createElement('section');n.className='walkthrough-card';n.setAttribute('aria-label','App walkthrough');n.innerHTML=`<div class="walkthrough-top"><span>${emoji} YOUR LITTLE GUIDE · ${step==='welcome'?'1':step==='question'||step==='deeper'?'2':step==='profile'?'3':'4'} / 4</span><button class="textbtn" data-tour-skip>Skip guide</button></div><h2>${title}</h2><p>${copy}</p>${action?`<button class="secondary-button" data-tour-next>${action}</button>`:''}<p class="error" data-tour-error role="alert"></p>`;if(step==='deeper'&&$('#askform'))$('#askform').previousElementSibling.before(n);else host.prepend(n);
 n.querySelector('[data-tour-skip]').onclick=finishWalkthrough;
 const next=n.querySelector('[data-tour-next]');if(next)next.onclick=async()=>{
  if(walkthroughBusy)return;if(step==='friends')return finishWalkthrough();walkthroughBusy=true;next.disabled=true;
  try{const target=step==='welcome'?'question':step==='deeper'?'profile':'friends';if(await saveWalkthrough(target))await resumeWalkthrough()}catch(e){if(n.isConnected)n.querySelector('[data-tour-error]').textContent=e.message}finally{walkthroughBusy=false;if(next.isConnected)next.disabled=false}
 };
 if(step==='deeper'){const target=$('#askform');target?.classList.add('walkthrough-highlight')}
 n.scrollIntoView({block:'start',behavior:'instant'});
}
function updateQuestionWalkthrough(){
 if(!user||!['question','deeper'].includes(user.walkthrough)||$('#today').hidden)return;
 if(current?.attempt&&user.walkthrough==='question'){
  if(walkthroughBusy)return;walkthroughBusy=true;saveWalkthrough('deeper').then(ok=>{if(ok)showWalkthroughCard('deeper')}).catch(e=>toast(e.message)).finally(()=>walkthroughBusy=false);
 }else showWalkthroughCard(user.walkthrough);
}
const renderTodayBeforeGuide=renderToday;
renderToday=function(...args){const result=renderTodayBeforeGuide(...args);updateQuestionWalkthrough();return result};
function renderHomeQuizRequests(){
 const holder=$('#homequizrequests');if(!holder)return;
 const invitations=challengeNotifications.filter(n=>!n.read&&n.type==='challenge_invite');holder.hidden=!invitations.length;
 holder.innerHTML=invitations.length?`<div class="home-section-title"><h2>Quiz invitations <span>${invitations.length}</span></h2></div>`+invitations.map(n=>`<button class="dashboard-update unread" data-quiz-invite="${esc(n.gameId)}" data-notice="${esc(n.id)}"><span class="update-bubble" aria-hidden="true">💌</span><span><strong>${esc(n.title)}</strong><small>${esc(n.topic)}</small></span><i class="unread-dot" aria-label="New invitation"></i></button>`).join(''):'';
 holder.querySelectorAll('[data-quiz-invite]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/notifications/'+b.dataset.notice+'/read',{method:'POST',body:{}});await refreshChallengeNotifications();await openGame(b.dataset.quizInvite)}catch(e){toast(e.message);if(b.isConnected)b.disabled=false}});
}
function experienceDialog(title){
 let dialog=$('#experienceDialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='experienceDialog';document.body.append(dialog)}
 dialog.innerHTML=`<div class="dialoginner"><div class="dialoghead"><h2>${title}</h2><button class="round" id="experienceclose" aria-label="Close">×</button></div><div id="experiencebody"></div></div>`;$('#experienceclose').onclick=()=>dialog.close();return dialog;
}
function openTopicSuggestion(){
 const owner=user.id,id=crypto.randomUUID(),dialog=experienceDialog('Into the suggestion box 🗳️');
 $('#experiencebody').innerHTML='<p class="intro">What would you love to learn about? Nicole can use your suggestion to grow the question bank.</p><form id="suggestionform"><label for="suggestiontopic">Your suggested topic</label><input class="field" id="suggestiontopic" placeholder="e.g. species of birds" minlength="2" maxlength="120" required><label for="suggestionnote">Anything specific? (optional)</label><textarea class="field" id="suggestionnote" rows="3" maxlength="500" placeholder="British garden birds would be lovely…"></textarea><p class="smallnote">No AI credits used. Suggestions are reviewed, so new topics may take a little time.</p><p class="error" id="suggestionerror" role="alert"></p><button class="primary">Post my suggestion</button></form>';
 $('#suggestionform').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await api('/topic-suggestions',{method:'POST',body:{id,topic:$('#suggestiontopic').value,note:$('#suggestionnote').value}});if(user?.id!==owner||!dialog.open)return;$('#experiencebody').innerHTML='<div class="suggestion-thanks"><span aria-hidden="true">💌</span><h3>Safely in the box!</h3><p>Thank you. Nicole can now see your suggestion.</p><button class="primary" id="suggestiondone">Lovely</button></div>';$('#suggestiondone').onclick=()=>dialog.close()}catch(err){if($('#suggestionerror'))$('#suggestionerror').textContent=err.message;button.disabled=false}};openAppDialog(dialog);
}
function openDeleteAccount(){
 const owner=user.id,dialog=experienceDialog('Delete your account?');
 $('#experiencebody').innerHTML='<p class="intro">This permanently removes your profile, saved discoveries, conversations, results and friendships. Quizzes you created, including their guest links and shared results, will also be deleted.</p><p>You can sign up again with the same email afterwards.</p><form id="deleteaccountform"><label for="deletepassword">Confirm your password</label><input class="field" id="deletepassword" type="password" autocomplete="current-password" required><label class="delete-confirm"><input type="checkbox" id="deleteconfirmed" required> I understand this cannot be undone.</label><p class="error" id="deleteaccounterror" role="alert"></p><button class="primary danger-button">Permanently delete my account</button></form>';
 $('#deleteaccountform').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await api('/account',{method:'DELETE',body:{password:$('#deletepassword').value,confirm:'DELETE'}});if(user?.id!==owner)return;try{for(const key of Object.keys(localStorage))if(key.includes(owner))localStorage.removeItem(key)}catch{}dialog.close();clearAccount();authMode='signup';showAuth();toast('Account deleted. You can start fresh.')}catch(err){if($('#deleteaccounterror'))$('#deleteaccounterror').textContent=err.message;button.disabled=false}};openAppDialog(dialog);
}
const settingsBeforeExperience=renderSettings;
renderSettings=function(){
 settingsBeforeExperience();
 const account=$('[data-setting-card="account"] .setting-body');if(account){account.insertAdjacentHTML('beforeend','<div class="setting"><button class="secondary-button full-row-action" id="deleteaccount">Delete account</button><p>Permanently delete your account and start fresh.</p></div>');$('#deleteaccount').onclick=openDeleteAccount}
 $('#logout').insertAdjacentHTML('afterend','<div class="settings-help"><button class="secondary-button full-row-action" id="replayguide">💡 Show me around</button><button class="secondary-button full-row-action" id="topicsuggestion">🗳️ Suggest a topic</button><p class="smallnote">Something you’d love to see in the question bank?</p></div>');$('#topicsuggestion').onclick=openTopicSuggestion;$('#replayguide').onclick=async()=>{try{if(await saveWalkthrough('welcome'))await resumeWalkthrough()}catch(e){toast(e.message)}};
};
const adminBeforeSuggestions=renderAdminPanel;
renderAdminPanel=function(data){adminBeforeSuggestions(data);const owner=user.id;const section=document.createElement('section');section.className='admin-section';section.id='admintopicsuggestions';$('#admin').append(section);loadAdminSuggestions(owner)};
async function loadAdminSuggestions(owner){
 try{const data=await api('/topic-suggestions');const holder=$('#admintopicsuggestions');if(user?.id!==owner||!holder)return;holder.innerHTML='<h2>🗳️ Topic suggestions</h2>'+(data.suggestions.length?data.suggestions.map(s=>`<article class="admin-request"><div><strong>${esc(s.topic)}</strong><small>${esc(s.name||'Deleted account')} · ${new Date(s.created_at).toLocaleDateString('en-GB')}</small>${s.note?`<p>${esc(s.note)}</p>`:''}</div>${s.status==='pending'?`<button class="secondary-button" data-review-suggestion="${esc(s.id)}">Mark reviewed</button>`:'<span class="smallnote">Reviewed</span>'}</article>`).join(''):'<p class="smallnote">No suggestions yet.</p>');holder.querySelectorAll('[data-review-suggestion]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/topic-suggestions',{method:'PUT',body:{id:b.dataset.reviewSuggestion}});await loadAdminSuggestions(owner)}catch(e){toast(e.message);b.disabled=false}})}catch(e){if($('#admintopicsuggestions'))$('#admintopicsuggestions').textContent=e.message}
}
