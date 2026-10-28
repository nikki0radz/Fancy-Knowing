const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user=null,current=null,todayId=null,library=[],mode='choice',reviewing=false,busy=false,authMode='login',bankTab='saved',chatId=null,chatMessages=[],chatBusy=false;
const settingsOpen=new Set();
let visibleRoute=null,navigationReady=false,navigationRestoring=false,navigationIndex=0,navigationKey='',navigationQueue=Promise.resolve();
const navigationClosing=new Set();
let dailySlots=[],dailyDay=null,activeSlot=0,requestedSlot=0,requestedDay=null,settingsSaveQueue=Promise.resolve(),todayNeedsRefresh=false,editingTopicsOnly=false;
const heartIcon=saved=>saved?'<span class="heart-icon" aria-hidden="true">❤️</span>':'<svg class="heart-outline" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>';
const copyIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M15 8V4H4v11h4"/></svg>';
const shareIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/></svg>';
let challengeInvite=null,pendingGameId=null;
let guestToken=null,guestQuestion=null,guestBusy=false;
let setupDraft=null,resetToken=null,profileEditing=false,onboardingLoadId=0;
function needsProfileSetup(){return !!user&&!user.profile?.onboardingComplete}
function saveSetupDraft(){if(!setupDraft||setupDraft.owner!==user?.id)return;try{localStorage.setItem('fancy-knowing-setup:'+user.id,JSON.stringify({name:setupDraft.name,interests:setupDraft.interests,includeEverything:setupDraft.includeEverything}))}catch{}}
let theme='dark';try{theme=localStorage.getItem('fancy-knowing-theme')||'dark'}catch{}
const loading=text=>`<div class="loading" role="status" aria-live="polite"><div class="spinner" aria-hidden="true"></div>${esc(text)}</div>`;
function renderHeaderProfile(){if(typeof updateChallengeBadges==='function')updateChallengeBadges();const button=$('#headerprofile');button.hidden=!user||needsProfileSetup();if(user)button.innerHTML=user.avatar?`<img src="${esc(user.avatar)}" alt="">`:`<span aria-hidden="true">${esc((user.profile?.name||'?').slice(0,1).toUpperCase())}</span>`}
function applyTheme(value){renderHeaderProfile();theme=value;FancyDesign.apply({...user?.settings,theme:value});try{localStorage.setItem('fancy-knowing-theme',value)}catch{}}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').hidden=true,4000)}
async function api(path,options={}){
 let response;try{response=await fetch('/api'+path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},body:options.body?JSON.stringify(options.body):undefined})}catch{throw new Error('Could not connect. Check your internet and try again.')}
 let data;try{data=await response.json()}catch{throw new Error(response.status>=500?'The server connection stopped before it could reply. Please try again.':'The server returned an unreadable response. Refresh the app and try again.')}
 if(!response.ok){const e=new Error(data.error||'Something went wrong. Please try again.');e.status=response.status;if(response.status===401&&user){clearAccount();showAuth()}throw e}return data;
}
function rememberNavigation(route){
 if(document.getElementById(route.page)?.hidden)return;
 if(!route.dialog&&!route.menu&&(!navigationClosing.size||navigationRestoring))visibleRoute=route;
 if(!user||guestToken||navigationRestoring||navigationClosing.size)return;
 const previous=history.state?.route;
 if(previous?.dialog&&!route.dialog)return;
 if(previous?.menu&&$('#reminderMenu')?.hidden)return;
 const key=JSON.stringify(route);if(navigationReady&&key===navigationKey)return;
 if(!navigationReady){history.replaceState({fancyKnowing:true,index:0,route},'');navigationIndex=1;history.pushState({fancyKnowing:true,index:1,route},'');navigationReady=true}
 else history.pushState({fancyKnowing:true,index:++navigationIndex,route},'');
 navigationKey=key;
}
function openAppDialog(dialog){dialog.showModal();rememberNavigation({...visibleRoute,dialog:dialog.id})}
function appBack(fallback){if(navigationReady&&history.state?.index>1)history.back();else fallback()}
async function restoreNavigation(route){
 if(needsProfileSetup()){await showOnboarding();return}
 if(route.page==='onboarding'&&!route.edit){await loadHome();return}
 navigationRestoring=true;
 try{
  for(const dialog of document.querySelectorAll('dialog[open]'))if(dialog.id!==route.dialog){navigationClosing.add(dialog.id);dialog.close()}
  closeReminderMenu(true);
  const base={...route};delete base.dialog;delete base.menu;delete base.field;delete base.reminder;
  if(JSON.stringify(base)!==JSON.stringify(visibleRoute)){
   if(base.page==='admin')await openAdminPanel();else if(base.page==='myprofile')await openMyProfile();else if(base.page==='friends')await openFriendsHub();else if(base.page==='notifications')await openNotifications();else if(base.page==='home')await loadHome();else if(base.page==='games')await openChallengeList();else if(base.page==='gameSetup')restoreQuizFlow(base);else if(base.page==='gamePlay')await openGame(base.id,base.invite);else if(base.page==='settings'){page('settings');renderSettings()}
   else if(base.page==='bank'){bankTab=base.tab||'saved';page('bank');await loadLibrary();renderBank()}
   else if(base.page==='today'){if(base.view==='daily')await loadToday(base.slot||0,base.day);else await openDiscovery(base.id,base.view==='review')}
   else if(base.page==='onboarding'){
    profileEditing=base.edit;editingTopicsOnly=base.topicsOnly;page('onboarding');
    if(!setupDraft||setupDraft.owner!==user.id)await showOnboarding(base.edit,base.step==='topics');else if(base.step==='topics')renderTopicsStep();else renderNameStep();
   }
   else if(base.page==='emailsetup')showEmailSetup(base.canSkip);
   else if(base.page==='auth'&&base.view==='forgot')showForgot();
   else showAuth();
   visibleRoute=base;
  }
  if(route.dialog){const dialog=document.getElementById(route.dialog);if(dialog&&!dialog.open){if(dialog.id==='chat')await openChat();else if(dialog.id==='avatarDialog')await openAvatarEditor();else if(dialog.id==='shareDialog')await showShare(current.id);else if(dialog.id==='colourDialog')FancyDesign.wheel(dialog,{...user.settings,theme},async patch=>{await saveSettings(patch);renderSettings()});else dialog.showModal()}}
  if(route.menu){const trigger=document.querySelector(`[data-reminder-menu="${route.menu}"][data-reminder-index="${route.reminder||0}"]`);if(trigger){const extra=trigger.closest('details');if(extra)extra.open=true;openReminderMenu(route.menu,trigger,false)}}
 }finally{navigationRestoring=false}
}
window.addEventListener('popstate',event=>{
 if(!event.state?.fancyKnowing)return;
 if(!user){showAuth();return}
 const state=event.state;navigationIndex=state.index;navigationKey=JSON.stringify(state.route);
 navigationQueue=navigationQueue.catch(()=>{}).then(async()=>{
  try{await restoreNavigation(state.route)}catch(e){toast(e.message)}
  // At the app's root, Back stays on the root screen instead of leaving the app.
  if(state.index===0&&history.state?.index===0&&user){navigationIndex=1;history.pushState({fancyKnowing:true,index:1,route:state.route},'')}
 });
});
function clearAccount(){if(typeof stopWalkthrough==='function')stopWalkthrough();setupDraft=null;profileEditing=false;editingTopicsOnly=false;onboardingLoadId++;if(typeof clearGameState==='function')clearGameState();navigationReady=false;navigationKey='';visibleRoute=null;user=null;reminderDraft=null;reminderDraftOwner=null;editingReminderSlot=null;reminderSaving=false;reminderNotice='';renderHeaderProfile();current=null;todayId=null;library=[];chatId=null;chatMessages=[];if($('#chat').open)$('#chat').close();$('#nav').hidden=true}
function page(name){if(needsProfileSetup()&&!['auth','onboarding','emailsetup'].includes(name)){showOnboarding();return false}['admin','home','myprofile','friends','notifications','gameSetup','games','gamePlay','auth','today','bank','settings','onboarding','emailsetup'].forEach(p=>$('#'+p).hidden=p!==name);$('#nav').hidden=!user||['auth','onboarding','emailsetup'].includes(name);document.querySelectorAll('[data-page]').forEach(b=>{if(b.dataset.page===(['today','gameSetup','games','gamePlay'].includes(name)?'home':name))b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});window.scrollTo({top:0})}
function showAuth(error=''){
 page('auth');const signup=authMode==='signup';
 $('#auth').innerHTML=`<div class="eyebrow">A LITTLE MORE CURIOUS</div><h1>Fancy knowing<br><em>something new?</em></h1><p class="intro">A little discovery, at your own pace.<br>Your discoveries, saved just for you.</p><div class="auth-tabs"><button id="loginmode" aria-pressed="${!signup}">Sign in</button><button id="signupmode" aria-pressed="${signup}">Create account</button></div><form id="authform" class="authform"><label>Email address<input class="field" id="identity" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required></label><label>Password<span class="secret-field"><input class="field" id="password" type="password" autocomplete="${signup?'new-password':'current-password'}" maxlength="200" required aria-label="Password"><button class="secret-toggle" type="button" data-reveal="password" data-reveal-label="password" aria-controls="password" aria-label="Show password" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="secret-slash" d="m3 3 18 18"/></svg><span>Show</span></button></span></label>${signup?'<label>Invitation code<span class="secret-field"><input class="field" id="code" type="password" autocomplete="off" maxlength="200" required aria-label="Invitation code"><button class="secret-toggle" type="button" data-reveal="code" data-reveal-label="invitation code" aria-controls="code" aria-label="Show invitation code" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="secret-slash" d="m3 3 18 18"/></svg><span>Show</span></button></span></label><p class="smallnote">A simple password is fine.</p>':''}<p class="error" role="alert" id="autherror">${esc(error)}</p><button class="primary" id="authsubmit">${signup?'Create my account':'Welcome back'}</button></form>${!signup?`<button class="textbtn" id="forgot">Forgot password?</button>`:''}`;
 $('#loginmode').onclick=()=>{authMode='login';showAuth()};$('#signupmode').onclick=()=>{authMode='signup';showAuth()};
 if($('#forgot'))$('#forgot').onclick=()=>showForgot();
 $('#authform').onsubmit=async e=>{e.preventDefault();const button=$('#authsubmit');button.disabled=true;$('#autherror').textContent='';try{const data=await api('/auth/'+(signup?'signup':'login'),{method:'POST',body:{email:$('#identity').value.trim(),password:$('#password').value,...(signup?{code:$('#code').value}:{})}});user=data.user;applyTheme(user.settings.theme||theme);$('#auth').innerHTML='';await afterSignIn()}catch(err){if($('#autherror'))$('#autherror').textContent=err.message}finally{if($('#authsubmit'))$('#authsubmit').disabled=false}};
 rememberNavigation({page:'auth',view:'login'});
}
async function afterSignIn(){
 if(!user.email)return showEmailSetup(true);
 if(!user.profile?.onboardingComplete)return showOnboarding();
 if(typeof resumeWalkthrough==='function'&&user.walkthrough&&user.walkthrough!=='done')return resumeWalkthrough();
 if(pendingGameId){const id=pendingGameId;pendingGameId=null;return openGame(id)}
 if(challengeInvite)return openGame(null,challengeInvite);
 if(new URLSearchParams(location.search).has('requests')){history.replaceState(history.state,'',location.pathname);return openNotifications()}
 if(new URLSearchParams(location.search).has('inbox')){history.replaceState(history.state,'',location.pathname);return openNotifications()}
 if(requestedDay||requestedSlot)await loadToday(requestedSlot,requestedDay);else await loadHome();requestedSlot=0;requestedDay=null;
}
function showForgot(){
 page('auth');$('#auth').innerHTML=`<div class="eyebrow">LET’S GET YOU BACK IN</div><h1>Forgot your<br><em>password?</em></h1><p class="intro">Enter the email you use for Fancy Knowing. We’ll send you a link to choose a new password.</p><form class="authform" id="forgotform"><label>Email address<input class="field" id="recoveryemail" type="email" autocomplete="email" maxlength="254" value="${esc(user?.email||'')}" required></label><p class="error" id="recoveryerror" role="alert"></p><button class="primary" id="recoverybutton">Send reset link</button></form><p id="recoverysuccess" class="intro" role="status"></p><button class="textbtn" id="backlogin">Back to sign in</button>`;
 $('#backlogin').onclick=()=>appBack(()=>{authMode='login';showAuth()});$('#forgotform').onsubmit=async e=>{e.preventDefault();$('#recoverybutton').disabled=true;$('#recoveryerror').textContent='';$('#recoverysuccess').textContent='';try{const data=await api('/auth/forgot-password',{method:'POST',body:{email:$('#recoveryemail').value.trim()}});$('#recoverysuccess').textContent=data.message;$('#recoverybutton').textContent='Send another link'}catch(err){$('#recoveryerror').textContent=err.message}finally{if($('#recoverybutton'))$('#recoverybutton').disabled=false}};
 rememberNavigation({page:'auth',view:'forgot'});
}
function showReset(){
 page('auth');$('#auth').innerHTML=`<div class="eyebrow">A FRESH START</div><h1>A new<br><em>password.</em></h1><p class="intro">Choose a password you’ll remember.</p><form class="authform" id="resetform"><label>New password<span class="secret-field"><input class="field" id="newpassword" type="password" autocomplete="new-password" maxlength="200" required aria-label="New password"><button class="secret-toggle" type="button" data-reveal="newpassword" data-reveal-label="new password" aria-controls="newpassword" aria-label="Show new password" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="secret-slash" d="m3 3 18 18"/></svg><span>Show</span></button></span></label><label>Repeat password<span class="secret-field"><input class="field" id="repeatpassword" type="password" autocomplete="new-password" maxlength="200" required aria-label="Repeat password"><button class="secret-toggle" type="button" data-reveal="repeatpassword" data-reveal-label="repeat password" aria-controls="repeatpassword" aria-label="Show repeat password" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="secret-slash" d="m3 3 18 18"/></svg><span>Show</span></button></span></label><p class="error" id="reseterror" role="alert"></p><button class="primary" id="resetbutton">Save password</button></form><button class="textbtn" id="newresetlink">Request a new link</button>`;
 $('#newresetlink').onclick=showForgot;$('#resetform').onsubmit=async e=>{e.preventDefault();$('#reseterror').textContent='';if($('#newpassword').value!==$('#repeatpassword').value){$('#reseterror').textContent='Those passwords do not match.';return}$('#resetbutton').disabled=true;try{const data=await api('/auth/reset-password',{method:'POST',body:{token:resetToken,password:$('#newpassword').value}});resetToken=null;clearAccount();authMode='login';showAuth();toast(data.message)}catch(err){$('#reseterror').textContent=err.message}finally{if($('#resetbutton'))$('#resetbutton').disabled=false}};
}
function showEmailSetup(canSkip=false){
 page('emailsetup');$('#emailsetup').innerHTML=`<div class="eyebrow">YOUR ACCOUNT, ALL TOGETHER</div><h1>Let’s add<br><em>your email.</em></h1><p class="intro">Keep your existing discoveries and use email to sign in or recover your password.</p><form class="authform" id="emailform"><label>Email address<input class="field" id="linkemail" type="email" autocomplete="email" value="${esc(user.email||'')}" maxlength="254" required></label><label>Current password<span class="secret-field"><input class="field" id="linkpassword" type="password" autocomplete="current-password" maxlength="200" required aria-label="Current password"><button class="secret-toggle" type="button" data-reveal="linkpassword" data-reveal-label="current password" aria-controls="linkpassword" aria-label="Show current password" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="secret-slash" d="m3 3 18 18"/></svg><span>Show</span></button></span></label><p class="error" id="emailerror" role="alert"></p><button class="primary" id="linkbutton">Send confirmation link</button></form><p class="intro" id="linksuccess" role="status"></p><button class="textbtn" id="skipemail">${canSkip?'Do this later':'Back to settings'}</button>`;
 $('#skipemail').onclick=()=>{if(canSkip){if(!user.profile?.onboardingComplete)showOnboarding();else loadToday()}else appBack(()=>{page('settings');renderSettings()})};
 $('#emailform').onsubmit=async e=>{e.preventDefault();$('#linkbutton').disabled=true;$('#emailerror').textContent='';try{const data=await api('/account/email',{method:'POST',body:{email:$('#linkemail').value.trim(),password:$('#linkpassword').value}});$('#linksuccess').textContent=data.message;$('#linkpassword').value=''}catch(err){$('#emailerror').textContent=err.message}finally{if($('#linkbutton'))$('#linkbutton').disabled=false}};
 rememberNavigation({page:'emailsetup',canSkip});
}
async function showOnboarding(edit=false,topicsOnly=false){
 const owner=user?.id;if(!owner)return showAuth();if(needsProfileSetup()){edit=false;topicsOnly=false}
 profileEditing=edit;editingTopicsOnly=topicsOnly;const requestId=++onboardingLoadId;page('onboarding');$('#onboarding').innerHTML=loading('A little about you…');
 try{
  const data=await api('/topics');if(user?.id!==owner||requestId!==onboardingLoadId||$('#onboarding').hidden)return;
  let draft=setupDraft?.owner===owner?setupDraft:null;
  if(!draft&&!edit)try{draft=JSON.parse(localStorage.getItem('fancy-knowing-setup:'+owner)||'null')}catch{}
  setupDraft={owner,name:typeof draft?.name==='string'?draft.name:user.profile?.name||'',interests:Array.isArray(draft?.interests)?draft.interests.filter(t=>typeof t==='string'&&[...data.subjects,...data.custom].includes(t)).slice(0,20):[...(user.profile?.interests||[])],includeEverything:typeof draft?.includeEverything==='boolean'?draft.includeEverything:user.profile?.includeEverything===true||!user.profile?.interests?.length,subjects:data.subjects,custom:data.custom};
  if(!edit||topicsOnly)renderTopicsStep();else renderNameStep();
 }catch(err){if(user?.id!==owner||requestId!==onboardingLoadId)return;$('#onboarding').innerHTML=`<p class="intro">${esc(err.message)}</p><button class="primary" id="retrysetup">Try again</button>`;$('#retrysetup').onclick=()=>showOnboarding(edit,topicsOnly)}
}
function renderNameStep(){
 if(!profileEditing)return renderTopicsStep();
 $('#onboarding').innerHTML=`<div class="eyebrow">${profileEditing?'MAKE IT YOURS':'A QUICK HELLO · 1 OF 2'}</div><h1>What should<br><em>we call you?</em></h1><p class="intro">Just your first name, or whatever you like going by.</p><form id="nameform" class="authform"><label>Your name<input class="field" id="displayname" autocomplete="given-name" maxlength="60" value="${esc(setupDraft.name)}" required></label><button class="primary">Continue</button></form>${profileEditing?'<button class="textbtn" id="cancelprofile">Back to settings</button>':''}`;
 $('#nameform').onsubmit=e=>{e.preventDefault();const value=$('#displayname').value.trim();if(!value)return;setupDraft.name=value;saveSetupDraft();renderTopicsStep()};if($('#cancelprofile'))$('#cancelprofile').onclick=()=>appBack(()=>{page('settings');renderSettings()});
 rememberNavigation({page:'onboarding',step:'name',edit:profileEditing,topicsOnly:editingTopicsOnly});
}
function renderTopicsStep(){
 if(!setupDraft||setupDraft.owner!==user?.id)return showOnboarding();
 const options=[...new Set([...setupDraft.subjects,...setupDraft.custom,...setupDraft.interests])],needsName=!profileEditing||!setupDraft.name.trim();
 $('#onboarding').innerHTML=`<div class="eyebrow">${profileEditing?'YOUR INTERESTS':'LET’S MAKE IT YOURS'}</div><h1>${profileEditing?'What catches<br><em>your interest?</em>':'A quick hello. <span aria-hidden="true">👋</span>'}</h1><p class="intro">${profileEditing?'Choose your favourites, explore everything, or combine both.':'Your name and a few interests. That’s all we need.'}</p>${needsName?`<label class="setup-name" for="displayname">What should we call you?<input class="field" id="displayname" autocomplete="given-name" maxlength="60" value="${esc(setupDraft.name)}" placeholder="Your name" required></label><h2 class="setup-interests-heading">What catches your interest?</h2>`:''}<button type="button" class="topicpill everything-pill" id="everything" aria-pressed="${setupDraft.includeEverything}">Tell me a bit about everything</button><p class="smallnote" id="mixhint">${setupDraft.includeEverything&&setupDraft.interests.length?'Mostly your chosen topics, with a discovery from elsewhere about one question in three.':'Choose specific topics below, explore everything, or mix both.'}</p><div class="topicgrid" aria-label="Choose your interests">${options.map((t,i)=>`<button type="button" class="topicpill" data-topic="${i}" aria-pressed="${setupDraft.interests.includes(t)}">${esc(t)}</button>`).join('')}</div><p class="smallnote" id="selectioncount" role="status">${setupDraft.interests.length} selected · choose up to 20</p><label class="customlabel" for="customtopic">Something more specific?</label><form class="customform" id="customform"><input class="field" id="customtopic" placeholder="Marine biology focused on sharks" aria-label="Your own learning topic" maxlength="120" required><button class="askbutton" id="addtopic">Add</button></form><p class="smallnote">Unusual interests welcome. We’ll check custom topics make sense as a subject to learn about.</p><p class="error" id="topicerror" role="alert"></p><button class="primary" id="finishprofile">${profileEditing?'Save my interests':'Save and start exploring'}</button>${profileEditing?`<button class="textbtn" id="backname">${editingTopicsOnly?'Back to settings':'Back'}</button>`:'<button class="textbtn" id="setupsignout">Use a different account</button>'}`;
 if($('#displayname'))$('#displayname').oninput=e=>{setupDraft.name=e.target.value;saveSetupDraft()};
 if($('#setupsignout'))$('#setupsignout').onclick=async()=>{try{saveSetupDraft();await disconnectPhonePush();await api('/auth/logout',{method:'POST',body:{}});clearAccount();showAuth()}catch(e){toast(e.message)}};
 $('#everything').onclick=()=>{setupDraft.includeEverything=!setupDraft.includeEverything;saveSetupDraft();renderTopicsStep()};
 document.querySelectorAll('[data-topic]').forEach(b=>b.onclick=()=>{const topic=options[Number(b.dataset.topic)],i=setupDraft.interests.indexOf(topic);if(i>=0)setupDraft.interests.splice(i,1);else{if(setupDraft.interests.length>=20){toast('Choose up to 20 interests.');return}setupDraft.interests.push(topic)}b.setAttribute('aria-pressed',setupDraft.interests.includes(topic));$('#mixhint').textContent=setupDraft.includeEverything&&setupDraft.interests.length?'Mostly your chosen topics, with a discovery from elsewhere about one question in three.':'Choose specific topics below, explore everything, or mix both.';$('#selectioncount').textContent=`${setupDraft.interests.length} selected · choose up to 20`;$('#finishprofile').textContent=profileEditing?'Save my interests':'Save and start exploring';saveSetupDraft()});
 if($('#backname'))$('#backname').onclick=()=>appBack(editingTopicsOnly?()=>{page('settings');renderSettings()}:renderNameStep);$('#customform').onsubmit=async e=>{e.preventDefault();if(setupDraft.interests.length>=20){$('#topicerror').textContent='Unselect a topic before adding another.';return}$('#addtopic').disabled=true;$('#finishprofile').disabled=true;if($('#backname'))$('#backname').disabled=true;$('#addtopic').textContent='Checking…';$('#topicerror').textContent='';try{const data=await api('/topics',{method:'POST',body:{topic:$('#customtopic').value.trim()}});if(!setupDraft.custom.includes(data.topic))setupDraft.custom.push(data.topic);if(!setupDraft.interests.includes(data.topic))setupDraft.interests.push(data.topic);saveSetupDraft();renderTopicsStep();toast('Topic added')}catch(err){$('#topicerror').textContent=err.message}finally{if($('#addtopic')){$('#addtopic').disabled=false;$('#addtopic').textContent='Add';$('#finishprofile').disabled=false;if($('#backname'))$('#backname').disabled=false}}};
 $('#finishprofile').onclick=async()=>{if($('#displayname')){setupDraft.name=$('#displayname').value.trim();if(!setupDraft.name){$('#displayname').reportValidity();return}}if(!setupDraft.name.trim()){renderNameStep();return}saveSetupDraft();$('#finishprofile').disabled=true;$('#topicerror').textContent='';try{const data=await api('/profile',{method:'PUT',body:{name:setupDraft.name,interests:setupDraft.interests,includeEverything:setupDraft.includeEverything}});user.profile=data.profile;renderHeaderProfile();try{localStorage.removeItem('fancy-knowing-setup:'+user.id)}catch{}if(homeData)homeData.readyCount=0;warmReadyQuestions();setupDraft=null;if(profileEditing){page('settings');renderSettings();toast('Interests saved · We’ll use these for your next new question.')}else await afterSignIn()}catch(err){if($('#topicerror'))$('#topicerror').textContent=err.message}finally{if($('#finishprofile'))$('#finishprofile').disabled=false}};
 rememberNavigation({page:'onboarding',step:'topics',edit:profileEditing,topicsOnly:editingTopicsOnly});
}
function dailyPicker(){return dailySlots.length>1?`<div class="daily-picker" aria-label="Today’s different questions"><p>Question ${activeSlot+1} of ${dailySlots.length}</p><div>${dailySlots.map(item=>`<button data-daily-slot="${item.slot}" aria-label="Question ${item.slot+1}${item.answered?', answered':''}" aria-pressed="${item.slot===activeSlot}" ${busy?'disabled':''}>${item.slot+1}${item.answered?'<span aria-hidden="true">✓</span>':''}</button>`).join('')}</div></div>`:''}
async function loadLibrary(){const data=await api('/library');library=data.questions;return library}
async function loadToday(slot=0,day=null){if(!Number.isInteger(slot))slot=0;page('today');$('#today').innerHTML=loading('Finding your little discovery…');try{const data=await api('/today?slot='+slot+(day?'&day='+encodeURIComponent(day):''));todayNeedsRefresh=false;dailySlots=data.slots||[{slot:0,id:data.question.id}];dailyDay=data.day||data.question.day;activeSlot=data.slot||0;current={...data.question,saved:data.saved};todayId=current.id;mode='choice';reviewing=false;await loadLibrary();await attachConversation(current);renderToday()}catch(e){if(!user)return;$('#today').innerHTML=`<h1>A little<br><em>patience.</em></h1><p class="intro" role="alert">${esc(e.message)}</p><button class="primary" id="retrytoday">Try again</button>`;$('#retrytoday').onclick=()=>loadToday(slot,day)}}
function dueQuestions(){return library.filter(q=>q.saved&&q.saved.due&&q.saved.due<=Date.now()&&q.id!==current?.id)}
function renderToday(){if(!current)return;const q=current,a=q.attempt,answered=!!a,saved=!!q.saved;const due=dueQuestions();
 $('#today').innerHTML=`<button class="textbtn" id="questionhome">‹ Home</button><h1 class="question-greeting">Hi ${esc(user.profile?.name||'there')}, do you know…</h1>${!reviewing&&dailySlots.some(item=>item.id===q.id)?dailyPicker():''}<article class="card"><div class="question-meta"><span class="topic" title="${esc(q.topic)}">${esc(q.topic)}</span></div><h2 class="question">${esc(q.q)}</h2>${!answered?`<div class="mode"><button id="choice" aria-pressed="${mode==='choice'}" ${busy?'disabled':''}>Choose an answer</button><button id="type" aria-pressed="${mode==='type'}" ${busy?'disabled':''}>Type my guess</button></div>`:''}<div class="answers ${q.format&&q.format!=='multiple_choice'?'binary-answers':''}">${mode==='choice'||answered?q.options.map((o,i)=>`<button class="answer ${answered&&i===q.correct?'correct':answered&&i===a.choice?'wrong':''}" data-answer="${i}" ${answered||busy?'disabled':''}><span class="letter">${answered&&i===q.correct?'✓':String.fromCharCode(65+i)}</span>${esc(o)}</button>`).join(''):`<form id="guessform"><input class="field" id="guess" placeholder="Your best guess…" aria-label="Your answer" required maxlength="150" ${busy?'disabled':''}><button class="primary" ${busy?'disabled':''}>${busy?'Checking…':'Check my answer'}</button></form>`}</div>${answered?`<div class="result" role="status"><strong>${a.correct?'You got it. ✨':'A new thing to know. ✧'}</strong>${a.typed?`<p class="smallnote">Your guess: ${esc(a.typed)}</p>`:''}<p>${esc(q.explanation)}</p>${q.source?`<a href="${esc(q.source)}" target="_blank" rel="noopener noreferrer">Check the source</a>`:''}</div>`:`<p class="smallnote" role="status">${busy?'Checking your guess…':'No timer. No pressure. Take a guess.'}</p>`}<div class="question-bottom-actions"><span class="smallnote">${saved?'Saved to your discoveries':''}</span><div class="question-actions">${answered?`<button class="share-question" id="sharequestion" aria-label="Share question">${shareIcon}</button>`:''}<button class="save" id="save" aria-label="${saved?'Unsave':'Save'} question" aria-pressed="${saved}" ${busy?'disabled':''}>${heartIcon(saved)}</button></div></div></article>${answered&&!reviewing?'<button class="textbtn question-recall" id="recallquestion">Try remembering</button>':''}${answered&&q.origin!=='manual'?`${conversationSection(q)}<div class="sectionhead"><h2>Dive deeper</h2><span class="badge">Only if you’re curious</span></div><form class="customform questionask" id="askform"><input class="field" id="ownquestion" placeholder="Ask your own question…" aria-label="Ask your own question" maxlength="1500" required><button class="askbutton">Ask</button></form><div class="suggestions">${q.follow.map((f,i)=>`<button data-follow="${i}">${esc(f)}<span class="follow-plus" aria-hidden="true">+</span></button>`).join('')}</div><p class="done">That’s your little discovery. You can stop here.</p>`:''}${q.id!==todayId||reviewing?'<button class="textbtn" id="backtoday">Back to today’s question</button>':''}`;
 $('#questionhome').onclick=()=>appBack(loadHome);
 if($('#sharequestion'))$('#sharequestion').onclick=()=>showShare(q.id);if($('#continuechat'))$('#continuechat').onclick=()=>openChat();
 document.querySelectorAll('[data-daily-slot]').forEach(b=>b.onclick=()=>{if(!busy)loadToday(Number(b.dataset.dailySlot),dailyDay)});
 if($('#recallquestion'))$('#recallquestion').onclick=()=>review(q.id);$('#save').onclick=toggleSave;if($('#saveagain'))$('#saveagain').onclick=toggleSave;
 if($('#choice'))$('#choice').onclick=()=>{mode='choice';renderToday()};if($('#type'))$('#type').onclick=()=>{mode='type';renderToday();$('#guess').focus()};
 document.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>answer({choice:Number(b.dataset.answer)}));
 if($('#guessform'))$('#guessform').onsubmit=e=>{e.preventDefault();answer({typed:$('#guess').value.trim()})};
 document.querySelectorAll('[data-follow]').forEach(b=>b.onclick=()=>openChat(q.follow[Number(b.dataset.follow)]));if($('#askform'))$('#askform').onsubmit=e=>{e.preventDefault();const text=$('#ownquestion').value.trim();if(text)openChat(text)};
 if($('#duereview'))$('#duereview').onclick=()=>review(due[0].id);if($('#backtoday'))$('#backtoday').onclick=()=>appBack(loadToday);
 rememberNavigation({page:'today',view:reviewing?'review':dailySlots.some(item=>item.id===q.id)?'daily':'discovery',id:q.id,slot:activeSlot,day:dailyDay});
}
async function answer(input){if(busy||!current)return;busy=true;const q=current,id=q.id,attemptId=crypto.randomUUID();renderToday();const stopLoading=questionWait($('#today .card'),'Checking your answer…');try{const data=await api(`/questions/${id}/answer`,{method:'POST',body:{...input,attemptId}});if(current?.id===id){const slot=dailySlots.find(item=>item.id===id);if(slot)slot.answered=true;current={...data.question,saved:q.saved?{due:q.saved.due?Date.now()+(data.question.attempt.correct?14:7)*86400000:null}:null};await loadLibrary();await attachConversation(current)}}catch(e){toast(e.message)}finally{stopLoading();busy=false;if(user&&current?.id===id)renderToday()}}
async function toggleSave(){if(busy||!current)return;busy=true;const id=current.id;try{const data=await api(`/questions/${id}/save`,{method:'POST',body:{saved:!current.saved}});if(current?.id===id)current.saved=data.saved;await loadLibrary();if(data.saved)showRefresherPrompt(id);else toast('Removed from saved discoveries')}catch(e){toast(e.message)}finally{busy=false;if(user&&current?.id===id)renderToday()}}
async function attachConversation(question){
 if(!question.attempt)return;
 const item=library.find(q=>q.id===question.id);if(item?.chatCount===0){question.conversation=[];return}
 try{const data=await api(`/questions/${question.id}/chat`);question.conversation=data.messages}catch{question.conversationUnavailable=true}
}
function conversationSection(q){
 if(q.conversationUnavailable)return '<p class="smallnote">Your conversation could not load. Open Dive deeper to try again.</p><button class="textbtn" id="continuechat">Open conversation</button>';
 if(!q.conversation?.length)return '';
 return `<details class="conversation-history" open><summary>Your conversation <span>${q.conversation.length} messages</span></summary><div class="saved-messages">${q.conversation.map(m=>`<div class="message ${m.role==='user'?'user':''}"><span class="sr-only">${m.role==='user'?'You':'Fancy Knowing'}: </span>${esc(m.content)}</div>`).join('')}</div><button class="textbtn" id="continuechat">Continue conversation</button></details>`;
}
async function openDiscovery(id,refresh=false){
 if(busy)return;page('today');$('#today').innerHTML=loading(refresh?'A little refresher…':'Opening your discovery…');
 try{const data=await api(`/questions/${id}${refresh?'?blind=1':''}`);current={...data.question,saved:library.find(q=>q.id===id)?.saved||null};reviewing=refresh;mode='choice';if(!refresh)await attachConversation(current);renderToday()}catch(e){toast(e.message);await loadToday()}
}
const review=id=>openDiscovery(id,true);
function renderBank(){
 $('#bank').classList.toggle('history-view',bankTab==='history');
 const items=bankTab==='saved'?library.filter(q=>q.saved):library;
 $('#bank').innerHTML=`<div class="eyebrow">KEEP THE GOOD BITS</div><h1>Saved<br><em>discoveries.</em></h1><div class="tabbar"><button id="savedtab" aria-pressed="${bankTab==='saved'}">Saved</button><button id="historytab" aria-pressed="${bankTab==='history'}">History</button></div><p class="intro">${items.length} ${items.length===1?'discovery':'discoveries'}</p>${items.length?bankTab==='history'?`<div class="history-question-list">${items.map(q=>`<article class="history-question-row"><button class="history-question-open" data-discovery="${esc(q.id)}" aria-label="Open question: ${esc(q.q)}">${esc(q.q)}</button>${q.attempt?`<button class="history-recall" data-review="${esc(q.id)}">Try remembering</button>`:''}</article>`).join('')}</div>`:items.map(q=>`<article class="bankitem compact-saved-discovery"><button class="discovery-card" data-discovery="${esc(q.id)}" aria-label="Open discovery: ${esc(q.q)}"><p>${esc(q.q)}</p><small class="${q.saved&&!q.saved.due&&!q.chatCount?'sr-only':''}">${q.saved&&!q.saved.due?'Saved · no refresher':q.saved?'Refresher '+(q.saved.due<=Date.now()?'due now':'on '+new Date(q.saved.due).toLocaleDateString('en-GB',{day:'numeric',month:'short'})):'Discovered '+esc(q.day)}${q.chatCount?` · ${q.chatCount} chat messages`:''}</small></button><div class="bankitem-footer"><span class="saved-topic-label" title="${esc(q.topic)}">${esc(q.topic)}</span>${q.attempt?`<button class="saved-recall-action" data-review="${esc(q.id)}">Try remembering <span aria-hidden="true">↻</span></button>`:''}</div></article>`).join(''):'<div class="empty"><span aria-hidden="true">❤️</span>'+(bankTab==='saved'?'Heart a question that catches your attention. Its conversation stays with it.':'Your answered questions will appear here.')+'</div>'}`;
 $('#savedtab').onclick=()=>{bankTab='saved';renderBank()};$('#historytab').onclick=()=>{bankTab='history';renderBank()};document.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>review(b.dataset.review));document.querySelectorAll('[data-discovery]').forEach(b=>b.onclick=()=>openDiscovery(b.dataset.discovery));
 rememberNavigation({page:'bank',tab:bankTab});
}
function saveSettings(patch){const task=settingsSaveQueue.catch(()=>{}).then(async()=>{const data=await api('/settings',{method:'PUT',body:patch});if((user.settings.dailyAmount||1)!==(data.settings.dailyAmount||1))todayNeedsRefresh=true;user.settings=data.settings;applyTheme(data.settings.theme||theme);return data.settings});settingsSaveQueue=task;return task}
const reminderPeriods={morning:{label:'Morning',start:'08:00',end:'12:00'},midday:{label:'Midday',start:'12:00',end:'14:00'},afternoon:{label:'Afternoon',start:'14:00',end:'18:00'},evening:{label:'Evening',start:'18:00',end:'22:00'},night:{label:'Night',start:'22:00',end:'24:00'}};
function periodWindow(period,settings=user.settings){return settings.periodWindows?.[period]||reminderPeriods[period]}
function periodHours(period,settings=user.settings){const w=periodWindow(period,settings);return formatTime(w.start)+' – '+formatTime(w.end)}
function preparePeriodRow(row){if(row.mode==='period')Object.assign(row,periodWindow(row.period));return row}
const reminderLabels={random:'Random time',fixed:'Set time',period:'Time of day'};
let reminderDraft=null,reminderDraftOwner=null,reminderMenuKind=null,reminderMenuIndex=0,editingReminderSlot=null,reminderSaving=false,reminderNotice='',reminderError=false;
function formatTime(value){const [hour,minute]=value.split(':').map(Number);return `${hour%12||12}:${String(minute).padStart(2,'0')}${hour===24||hour<12?'am':'pm'}`}
function minuteTime(minute){return String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0')}
function savedReminderRows(settings=user.settings){
 if(Array.isArray(settings.reminders))return settings.reminders.map((row,index)=>({...row,slot:row.slot??index}));
 const count=settings.dailyAmount||1,[h,m]=(settings.time||'08:00').split(':').map(Number),start=h*60+m;
 return Array.from({length:count},(_,slot)=>({slot,mode:settings.notificationMode||'fixed',time:minuteTime(Math.min(1439,start+Math.floor((1440-start)*slot/count))),period:settings.notificationPeriod||'morning',start:settings.randomStart||'08:00',end:settings.randomEnd||'21:00'}));
}
function initialiseReminders(settings){if(reminderDraftOwner===user.id&&reminderDraft)return;reminderDraftOwner=user.id;reminderDraft=savedReminderRows(settings)}
function reminderDescription(row){return row.mode==='fixed'?'at '+formatTime(row.time):row.mode==='period'?'in the '+reminderPeriods[row.period].label.toLowerCase():'at a random time between '+formatTime(row.start)+' and '+formatTime(row.end)}
function reminderShort(row){return row.mode==='fixed'?formatTime(row.time):row.mode==='period'?reminderPeriods[row.period].label:formatTime(row.start)+'–'+formatTime(row.end)}
function notificationSummary(settings){
 const rows=savedReminderRows(settings);if(!rows.length)return 'No notifications saved. Add one when you’re ready.';
 if(settings.notificationsEnabled===false)return 'Notifications are off. Your saved times are kept below.';
 if(rows.length>3)return `Your first notification is set ${reminderDescription(rows[0])}, with ${rows.length-1} more saved below.`;
 return 'Your '+(rows.length===1?'notification is set ':'notifications are set ')+rows.map(reminderDescription).join(rows.length===2?' and ':', ')+'.';
}
function updateReminder(index,patch){reminderDraft[index]={...reminderDraft[index],...patch};reminderNotice='';renderSettings()}
function startReminderEdit(slot){if(reminderSaving||editingReminderSlot!==null)return;reminderDraft=savedReminderRows().map(preparePeriodRow);editingReminderSlot=slot;reminderNotice='';renderSettings()}
function cancelReminderEdit(){if(reminderSaving)return;editingReminderSlot=null;reminderDraft=null;reminderNotice='';renderSettings()}
async function saveNotification(index){
 if(reminderSaving)return;
 const row={...reminderDraft[index]},rows=savedReminderRows().filter(item=>item.slot!==row.slot);rows.push(row);rows.sort((a,b)=>a.slot-b.slot);
 reminderSaving=true;renderSettings();
 try{await saveSettings({reminders:rows,...(row.mode==='period'?{periodWindows:{...user.settings.periodWindows,[row.period]:{start:row.start,end:row.end}}}:{})});editingReminderSlot=null;reminderDraft=null;reminderError=false;reminderNotice='Notification saved.';toast('Notification saved')}catch(e){reminderError=true;reminderNotice=e.message}finally{reminderSaving=false;renderSettings()}
}
async function deleteNotification(slot){
 if(reminderSaving||editingReminderSlot!==null)return;reminderSaving=true;renderSettings();
 try{await saveSettings({reminders:savedReminderRows().filter(row=>row.slot!==slot)});reminderDraft=null;reminderError=false;reminderNotice='Notification deleted.';toast('Notification deleted')}catch(e){reminderError=true;reminderNotice=e.message}finally{reminderSaving=false;renderSettings()}
}
function addNotification(){
 if(reminderSaving||editingReminderSlot!==null)return;
 reminderDraft=savedReminderRows();const usedSlots=new Set(reminderDraft.map(row=>row.slot)),slot=Array.from({length:user.settings.dailyAmount||1},(_,i)=>i).find(i=>!usedSlots.has(i));if(slot===undefined)return;
 const usedTimes=new Set(reminderDraft.filter(row=>row.mode==='fixed').map(row=>row.time)),previous=reminderDraft.at(-1),[h,m]=(previous?.time||'08:00').split(':').map(Number);let next=Math.min(1439,h*60+m+60);while(usedTimes.has(minuteTime(next)))next=(next+1439)%1440;
 reminderDraft.push({slot,mode:'fixed',time:minuteTime(next),start:'08:00',end:'21:00',period:'morning'});reminderDraft.sort((a,b)=>a.slot-b.slot);editingReminderSlot=slot;reminderNotice='';renderSettings();
}
function closeReminderMenu(fromNavigation=false){const menu=$('#reminderMenu');if(menu)menu.hidden=true;document.querySelectorAll('[data-reminder-menu]').forEach(b=>b.setAttribute('aria-expanded','false'));reminderMenuKind=null;if(!fromNavigation&&history.state?.route?.menu)history.back()}
function afterReminderMenu(action){if(!reminderMenuKind)return action();window.addEventListener('popstate',()=>navigationQueue.then(action),{once:true});closeReminderMenu()}
function openReminderMenu(kind,trigger,track=true){
 const menu=$('#reminderMenu'),index=Number(trigger.dataset.reminderIndex);if(!menu)return;
 if(reminderMenuKind===kind&&reminderMenuIndex===index&&!menu.hidden){closeReminderMenu();return}
 reminderMenuKind=kind;reminderMenuIndex=index;const row=reminderDraft[index];trigger.parentElement.append(menu);
 menu.innerHTML=kind==='mode'?Object.entries(reminderLabels).map(([key,label])=>`<button role="menuitemradio" aria-checked="${row.mode===key}" data-mode="${key}"><span>${label}<small>${key==='random'?'Choose a random time within a window':key==='fixed'?'Choose an exact clock time':'Morning, midday, afternoon, evening or night'}</small></span><span class="menu-selected" aria-hidden="true">${row.mode===key?'✓':''}</span></button>`).join(''):Object.entries(reminderPeriods).map(([key,value])=>`<button role="menuitemradio" aria-checked="${row.period===key}" data-period="${key}"><span>${value.label}<small>${periodHours(key)}</small></span><span class="menu-selected" aria-hidden="true">${row.period===key?'✓':''}</span></button>`).join('');
 menu.hidden=false;document.querySelectorAll('[data-reminder-menu]').forEach(b=>b.setAttribute('aria-expanded',String(b===trigger)));
 if(track)rememberNavigation({...visibleRoute,menu:kind,reminder:index});
 menu.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{const mode=b.dataset.mode;closeReminderMenu();updateReminder(index,mode==='period'?{mode,...periodWindow(row.period)}:{mode})});
 menu.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{const period=b.dataset.period;closeReminderMenu();updateReminder(index,{period,...periodWindow(period)})});
 menu.onkeydown=e=>{const buttons=[...menu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();closeReminderMenu();trigger.focus()}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus()}};
 (menu.querySelector('[aria-checked=true]')||menu.querySelector('button')).focus();
}
document.addEventListener('click',e=>{if(reminderMenuKind&&!e.target.closest('.reminder-controls'))closeReminderMenu()});
const INLINE_WHEEL_ROW=40,inlineWheelTimers=new Map();
function inlineTimeWheels(row,index,field,label=''){
 const [hour,minute]=row[field].split(':');
 return `<div class="inline-time-pair">${label?`<strong class="inline-pair-label">${label}</strong>`:''}<div class="inline-pair-columns">${[['hour',field==='end'&&row.mode==='period'?25:24,hour,'Hour'],['minute',60,minute,'Minute']].map(([kind,count,value,title])=>{const id=`inline-${index}-${field}-${kind}`;return `<div class="inline-wheel-column"><span id="${id}-label">${title}</span><div class="inline-wheel-frame"><div class="inline-time-wheel" role="listbox" tabindex="0" aria-labelledby="${id}-label" data-inline-wheel data-reminder-index="${index}" data-field="${field}" data-kind="${kind}" data-value="${value}" id="${id}">${Array.from({length:count},(_,number)=>String(number).padStart(2,'0')).map(v=>`<div class="inline-time-option" role="option" id="${id}-${v}" data-value="${v}" aria-selected="${v===value}">${v}</div>`).join('')}</div></div></div>`}).join('')}</div></div>`;
}
function selectInlineWheel(wheel){
 const index=Number(wheel.dataset.reminderIndex),field=wheel.dataset.field,kind=wheel.dataset.kind,max=kind==='hour'?(wheel.dataset.field==='end'&&reminderDraft[index]?.mode==='period'?24:23):59,value=Math.max(0,Math.min(max,Math.round(wheel.scrollTop/INLINE_WHEEL_ROW))),text=String(value).padStart(2,'0');
 const row=reminderDraft[index];if(!row)return value;let [hour,minute]=row[field].split(':');if(kind==='hour')hour=text;else minute=text;if(hour==='24')minute='00';row[field]=hour+':'+minute;
 wheel.setAttribute('aria-activedescendant',wheel.id+'-'+text);wheel.querySelectorAll('[role=option]').forEach((option,i)=>{option.setAttribute('aria-selected',String(i===value));option.style.opacity=i===value?'1':'.4'});return value;
}
function bindInlineWheels(){
 document.querySelectorAll('[data-inline-wheel]').forEach(wheel=>{
  if(wheel.dataset.bound||!wheel.getClientRects().length)return;wheel.dataset.bound='true';
  wheel.scrollTop=Number(wheel.dataset.value)*INLINE_WHEEL_ROW;selectInlineWheel(wheel);
  wheel.onscroll=()=>{if(!wheel.isConnected)return;const value=selectInlineWheel(wheel);clearTimeout(inlineWheelTimers.get(wheel.id));inlineWheelTimers.set(wheel.id,setTimeout(()=>{if(wheel.isConnected&&Math.abs(wheel.scrollTop-value*INLINE_WHEEL_ROW)>.5)wheel.scrollTo({top:value*INLINE_WHEEL_ROW,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'})},120))};
  wheel.onclick=e=>{const option=e.target.closest('[data-value]');if(option&&option!==wheel)wheel.scrollTo({top:Number(option.dataset.value)*INLINE_WHEEL_ROW,behavior:'smooth'})};
  wheel.onkeydown=e=>{const max=wheel.querySelectorAll('[role=option]').length-1,steps={ArrowUp:-1,ArrowDown:1,PageUp:-5,PageDown:5};if(e.key in steps||e.key==='Home'||e.key==='End'){e.preventDefault();const current=Math.round(wheel.scrollTop/INLINE_WHEEL_ROW),next=e.key==='Home'?0:e.key==='End'?max:Math.max(0,Math.min(max,current+steps[e.key]));wheel.scrollTop=next*INLINE_WHEEL_ROW;selectInlineWheel(wheel)}};
 });
}
function reminderEditor(row,index){
 return `<article class="notification-editor" aria-busy="${reminderSaving}"><div class="notification-editor-title"><strong>Question ${row.slot+1}</strong><span>Unsaved changes</span></div><div class="reminder-editor"><strong>Remind me at…</strong><div class="reminder-controls"><button class="reminder-type" data-reminder-menu="mode" data-reminder-index="${index}" aria-label="Reminder type for question ${row.slot+1}: ${reminderLabels[row.mode]}" aria-haspopup="menu" aria-expanded="false" ${reminderSaving?'disabled':''}>${reminderLabels[row.mode]}<span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span></button></div>${row.mode==='fixed'?inlineTimeWheels(row,index,'time'):row.mode==='random'?`<div class="inline-window-pairs">${inlineTimeWheels(row,index,'start','From')}<span class="window-divider" aria-hidden="true">–</span>${inlineTimeWheels(row,index,'end','Until')}</div>`:`<div class="reminder-controls"><button class="reminder-type" data-reminder-menu="period" data-reminder-index="${index}" aria-label="Time of day for question ${row.slot+1}" aria-haspopup="menu" aria-expanded="false" ${reminderSaving?'disabled':''}>${reminderPeriods[row.period].label}<small>${periodHours(row.period)}</small><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span></button></div><details class="period-window-edit"><summary>${pencilIcon} Edit this time window</summary><div class="inline-window-pairs">${inlineTimeWheels(row,index,'start','From')}<span class="window-divider" aria-hidden="true">–</span>${inlineTimeWheels(row,index,'end','Until')}</div><p class="smallnote">Applies to all ${reminderPeriods[row.period].label.toLowerCase()} reminders when saved.</p></details>`}<div class="notification-editor-actions"><button class="primary" data-save-notification="${index}" ${reminderSaving?'disabled':''}>${reminderSaving?'Saving…':'Save notification'}</button><button class="textbtn" id="cancelnotification" ${reminderSaving?'disabled':''}>Cancel</button></div></div></article>`;
}
function savedNotificationCard(row){
 const disabled=reminderSaving||editingReminderSlot!==null;
 return `<article class="saved-notification"><div class="saved-notification-head"><strong>Question ${row.slot+1}</strong><span class="notification-saved-label">Saved</span><div class="notification-icon-actions"><button data-edit-notification="${row.slot}" aria-label="Edit notification for question ${row.slot+1}" ${disabled?'disabled':''}>${pencilIcon}</button><button data-delete-notification="${row.slot}" aria-label="Delete notification for question ${row.slot+1}" ${disabled?'disabled':''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></div><div class="saved-notification-time ${row.mode==='period'?'saved-period-time':''}">${reminderShort(row)}${row.mode==='period'?`<small>${periodHours(row.period)}</small>`:''}</div><p>${row.mode==='fixed'?'Every day · Set time':row.mode==='period'?'A random time in this window':'A random time in this window'}</p></article>`;
}
function settingCard(id,icon,title,subtitle,body){return `<details class="setting-card" data-setting-card="${id}" ${settingsOpen.has(id)?'open':''}><summary><span class="setting-symbol" aria-hidden="true">${icon}</span><span><strong>${title}</strong><small>${subtitle}</small></span><span class="setting-chevron" aria-hidden="true">›</span></summary><div class="setting-body">${body}</div></details>`}
function accountAction(id,label,kind){
 const paths={name:'<path d="m15 4 5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/>',email:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',password:'<circle cx="8" cy="9" r="4"/><path d="m11 12 8 8m-4-4 3-3m-1 5 3-3"/>'};
 return `<button class="account-action" id="${id}"><span class="account-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${paths[kind]}</svg></span><span>${label}</span><svg class="account-action-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>`;
}
function settingSwitch(id,checked){return `<span class="setting-switch"><input type="checkbox" role="switch" id="${id}" ${checked?'checked':''}><span class="switch-track" aria-hidden="true"></span></span>`}
function renderSettings(){
 renderHeaderProfile();
 const s=user.settings,c=FancyDesign.colours({...s,theme}),fonts=FancyDesign.fonts;initialiseReminders(s);
 const design=`<div class="setting"><label>Appearance<button class="theme-slider" id="settingsTheme" data-theme-slider role="switch" aria-checked="${theme==='dark'}" aria-label="Dark mode"><span class="theme-thumb" aria-hidden="true"></span><span class="theme-sun" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg></span><span class="theme-moon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20.4 14A8.5 8.5 0 0 1 10 3.6 8.5 8.5 0 1 0 20.4 14Z"/></svg></span></button></label></div><div class="setting"><strong>Colours</strong><div class="colour-slots"><button class="colour-slot" id="editaccent"><i style="background:${c.accent}"></i>Accent</button><button class="colour-slot" id="editbackground"><i style="background:${c.background}"></i>Background</button></div><p>Set the colours for ${theme} mode. Light and dark keep their own palettes.</p></div><div class="setting"><strong>Your font</strong><div class="font-grid">${Object.entries(fonts).map(([key,font])=>`<button class="font-card" data-font="${key}" aria-pressed="${(s.font||'clean')===key}" style="font-family:${font.family.replaceAll('"','&quot;')}"><span>A little curious</span><small>${font.label}</small></button>`).join('')}</div><label class="range-label" for="fontSize">Overall font size <output id="fontSizeValue">${s.fontSize||100}%</output></label><input id="fontSize" type="range" min="75" max="160" step="5" value="${s.fontSize||100}"><div class="design-preview"><strong>A little more curious.</strong><br>A new thing to know, in your own style.</div><button class="textbtn" id="resetdesign">Reset design</button></div>`;
 const count=s.dailyAmount||1,savedRows=savedReminderRows(s),missing=Math.max(0,count-savedRows.length),editorIndex=reminderDraft.findIndex(row=>row.slot===editingReminderSlot);

 const notifications=`<div class="setting"><label for="notificationsEnabled">Question notifications${settingSwitch('notificationsEnabled',s.notificationsEnabled!==false)}</label><p>Your preferences are saved. Phone delivery will be enabled in the Android app.</p></div>${phoneSettingsMarkup(s)}<div class="setting notification-schedules" ${s.notificationsEnabled===false?'hidden':''}><p class="notification-summary">${notificationSummary(s)}</p><p class="notification-save-status ${reminderError?'is-error':''}" role="${reminderError?'alert':'status'}">${esc(reminderNotice)}</p>${savedRows.map(row=>row.slot===editingReminderSlot?reminderEditor(reminderDraft[editorIndex],editorIndex):savedNotificationCard(row)).join('')}${editingReminderSlot!==null&&!savedRows.some(row=>row.slot===editingReminderSlot)?reminderEditor(reminderDraft[editorIndex],editorIndex):''}<div id="reminderMenu" class="reminder-menu" role="menu" aria-label="Reminder choices" hidden></div>${missing?`<button class="secondary-button add-notification-button" id="addreminder" ${editingReminderSlot!==null||reminderSaving?'disabled':''}>+ ${savedRows.length?'Add another notification':'Add notification'}</button><p class="missing-reminders">${missing} ${missing===1?'question has':'questions have'} no saved notification.</p>`:''}</div>`;
 const questions=`<div class="setting"><label for="quiztimerenabled">Quiz timer${settingSwitch('quiztimerenabled',(s.timerSeconds||0)>0)}</label><div id="quiztimercontrols" ${(s.timerSeconds||0)>0?'':'hidden'}><label class="range-label" for="quiztimerseconds">Time per question <output id="quiztimersecondsvalue">${s.timerSeconds||30}s</output></label><input type="range" id="quiztimerseconds" min="10" max="120" step="5" value="${s.timerSeconds||30}"></div><p>Optional. New quizzes use this timer for every player.</p></div><div class="setting"><strong>Measurements</strong><p>Metric by default. Imperial shows converted values with the original metric measurement.</p><div class="measurement-switch" role="group" aria-label="Measurement units" data-selected="${s.units||'metric'}"><span class="measurement-thumb" aria-hidden="true"></span>${['metric','imperial'].map(units=>`<button data-units="${units}" aria-pressed="${(s.units||'metric')===units}"><strong>${units==='metric'?'Metric':'Imperial'}</strong><small>${units==='metric'?'kg · km · °C':'lb · mi · °F'}</small></button>`).join('')}</div></div><div class="setting"><label class="range-label" for="dailyAmount">Different questions per day <output id="dailyAmountValue">${count}</output></label><input type="range" id="dailyAmount" min="1" max="10" step="1" value="${count}" ${editingReminderSlot!==null||reminderSaving?'disabled':''}><p>This also sets how many question reminders you can add.</p></div><div class="setting"><strong>Your topics</strong><p>${user.profile?.interests?.length?user.profile.interests.map(esc).join(', ')+(user.profile.includeEverything?' · plus a bit of everything':''):'A bit of everything'}</p><button class="secondary-button full-row-action" id="editprofile">Edit my topics<span aria-hidden="true">+</span></button></div>`;
 const picture=user.avatar?`<img class="avatar" src="${esc(user.avatar)}" alt="Your profile picture">`:`<span class="avatar" aria-label="No profile picture">${esc((user.profile?.name||'?').slice(0,1).toUpperCase())}</span>`;
 const account=`<div class="setting"><div class="avatar-row"><div class="editable-avatar">${picture}<button class="avatar-pencil icon-button" id="editavatar" aria-label="Edit profile photo">${pencilIcon}</button></div><div class="profile-details"><div class="editable-name"><span class="name-centre"><strong>${esc(user.profile?.name||'Your profile')}</strong><button class="icon-button" id="editname" aria-label="Change display name">${pencilIcon}</button></span></div></div></div><p id="avatarstatus" role="status"></p>${usernameCard()}</div><div class="setting"><strong>Welcome email</strong><div id="welcomestatus" role="status">Checking the sender…</div><button class="secondary-button" id="retrywelcome">Send welcome email again</button></div><div class="setting"><strong>Email & password</strong><p class="account-email">${user.email?esc(user.email):'Your old username: '+esc(user.legacyUsername)}</p><div class="account-actions">${accountAction('editemail',user.email?'Change email':'Add email for recovery','email')}${user.email?accountAction('recoverfromsettings','Change password','password'):''}</div></div>`;
 $('#settings').innerHTML=`<div class="eyebrow">MAKE YOURSELF AT HOME</div><h1>Your kind<br><em>of curious.</em></h1>${settingCard('design','◉','Design','Colours, fonts & text size',design)}${settingCard('notifications','♧','Notifications','When & how often',notifications)}${settingCard('questions','✧','Question preferences','Topics, daily questions & quiz timer',questions)}${settingCard('account','☺','My account','Picture, name, email & password',account)}<div class="settings-savebar"><button class="primary" id="saveallsettings">Save settings</button><p id="settingssavestatus" role="status">Other settings save automatically.</p></div><button class="secondary-button settings-signout" id="logout">Sign out</button>`;
 document.querySelectorAll('[data-setting-card]').forEach(d=>d.ontoggle=()=>{if(d.open){settingsOpen.add(d.dataset.settingCard);if(d.dataset.settingCard==='notifications')requestAnimationFrame(bindInlineWheels)}else settingsOpen.delete(d.dataset.settingCard)});

 $('#saveallsettings').onclick=async()=>{const button=$('#saveallsettings');button.disabled=true;$('#settingssavestatus').textContent='Saving…';try{const patch={fontSize:Number($('#fontSize').value),dailyAmount:Number($('#dailyAmount').value),notificationsEnabled:$('#notificationsEnabled').checked,reminders:savedReminderRows()};await saveSettings(patch);$('#settingssavestatus').textContent=editingReminderSlot!==null?'Settings saved. Use Save notification for your notification edits.':'Settings saved.';toast('Settings saved')}catch(e){$('#settingssavestatus').textContent=e.message}finally{if($('#saveallsettings'))$('#saveallsettings').disabled=false}};
 bindPhoneSettings();
 $('#settingsTheme').onclick=toggleTheme;
 const openColours=target=>{FancyDesign.wheel($('#colourDialog'),{...s,theme},async patch=>{await saveSettings(patch);renderSettings()});rememberNavigation({...visibleRoute,dialog:'colourDialog'});if(target==='background')$('#colourDialog [data-colour="background"]').click()};$('#editaccent').onclick=()=>openColours('accent');$('#editbackground').onclick=()=>openColours('background');
 document.querySelectorAll('[data-font]').forEach(b=>b.onclick=async()=>{try{await saveSettings({font:b.dataset.font});renderSettings()}catch(e){toast(e.message)}});
 $('#fontSize').oninput=e=>{const fontSize=Number(e.target.value);$('#fontSizeValue').textContent=fontSize+'%';FancyDesign.apply({...s,theme,fontSize})};
 $('#fontSize').onchange=async e=>{try{await saveSettings({fontSize:Number(e.target.value)})}catch(err){applyTheme(theme);toast(err.message)}};
 $('#resetdesign').onclick=async()=>{try{await saveSettings({font:'clean',fontSize:100,accentDark:'#c3a2ff',accentLight:'#7441c5',backgroundDark:'#191329',backgroundLight:'#f7f1ff'});renderSettings();toast('Design reset')}catch(e){toast(e.message)}};
 $('#notificationsEnabled').onchange=async e=>{if(!e.target.checked){editingReminderSlot=null;reminderDraft=null}try{await saveSettings({notificationsEnabled:e.target.checked});renderSettings()}catch(err){toast(err.message);renderSettings()}};
 document.querySelectorAll('[data-reminder-menu]').forEach(b=>b.onclick=()=>openReminderMenu(b.dataset.reminderMenu,b));
 document.querySelectorAll('.period-window-edit').forEach(d=>d.ontoggle=()=>{if(d.open)bindInlineWheels()});
 bindInlineWheels();
 document.querySelectorAll('[data-save-notification]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-inline-wheel]').forEach(w=>{if(w.getClientRects().length)selectInlineWheel(w)});saveNotification(Number(button.dataset.saveNotification))});
 document.querySelectorAll('[data-edit-notification]').forEach(button=>button.onclick=()=>startReminderEdit(Number(button.dataset.editNotification)));
 document.querySelectorAll('[data-delete-notification]').forEach(button=>button.onclick=()=>deleteNotification(Number(button.dataset.deleteNotification)));
 if($('#cancelnotification'))$('#cancelnotification').onclick=cancelReminderEdit;
 if($('#addreminder'))$('#addreminder').onclick=addNotification;
 $('#dailyAmount').oninput=e=>$('#dailyAmountValue').textContent=e.target.value;
 $('#dailyAmount').onchange=async e=>{const dailyAmount=Number(e.target.value);try{await saveSettings({dailyAmount,reminders:savedReminderRows().filter(row=>row.slot<dailyAmount)});reminderDraft=null;renderSettings()}catch(err){toast(err.message);renderSettings()}};
 $('#quiztimerenabled').onchange=async e=>{try{await saveSettings({timerSeconds:e.target.checked?Number($('#quiztimerseconds').value):0});renderSettings()}catch(err){toast(err.message)}};$('#quiztimerseconds').oninput=e=>$('#quiztimersecondsvalue').textContent=e.target.value+'s';$('#quiztimerseconds').onchange=async e=>{try{await saveSettings({timerSeconds:Number(e.target.value)})}catch(err){toast(err.message)}};
 document.querySelectorAll('[data-units]').forEach(b=>b.onclick=async()=>{const wrap=b.closest('.measurement-switch'),previous=user.settings.units||'metric',paint=value=>{wrap.dataset.selected=value;wrap.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.units===value)))};wrap.querySelectorAll('button').forEach(button=>button.disabled=true);paint(b.dataset.units);try{await saveSettings({units:b.dataset.units});todayNeedsRefresh=true}catch(e){paint(previous);toast(e.message)}finally{wrap.querySelectorAll('button').forEach(button=>button.disabled=false)}});
 $('#editprofile').onclick=()=>showOnboarding(true,true);$('#editname').onclick=showDisplayNameEditor;$('#editemail').onclick=()=>showEmailSetup(false);if($('#recoverfromsettings'))$('#recoverfromsettings').onclick=showForgot;
 bindUsernameCopy();$('#editavatar').onclick=openAvatarEditor;loadWelcomeStatus();
 $('#retrywelcome').onclick=async()=>{const button=$('#retrywelcome');button.disabled=true;try{const status=await api('/account/welcome-email',{method:'POST',body:{}});renderWelcomeStatus(status)}catch(e){toast(e.message)}finally{if($('#retrywelcome'))$('#retrywelcome').disabled=false}};
 $('#logout').onclick=async()=>{try{await disconnectPhonePush();await api('/auth/logout',{method:'POST',body:{}});clearAccount();showAuth()}catch(e){toast(e.message)}};
 rememberNavigation({page:'settings'});
}
function renderWelcomeStatus(status){const node=$('#welcomestatus');if(!node)return;node.innerHTML=`<p>${!status.configured?'Email sender is not configured yet.':status.state==='sent'?'The '+esc(status.provider)+' sender accepted your welcome email. Check your inbox and spam folder.':status.state==='failed'?'The welcome email could not be sent.':'Your welcome email is queued.'}</p>${status.reason?`<p class="error">${esc(status.reason)}</p>`:''}`;}
async function loadWelcomeStatus(){const owner=user?.id;try{const status=await api('/account/welcome-email');if(user?.id===owner&&!$('#settings').hidden)renderWelcomeStatus(status)}catch(e){if($('#welcomestatus'))$('#welcomestatus').textContent=e.message}}
let chatReveal=null,chatLoaded=false;
function stopChatReveal(){if(chatReveal)chatReveal.cancel()}
function nearChatBottom(){const box=$('#messages');return box.scrollHeight-box.scrollTop-box.clientHeight<90}
function showMessages({typingIndex=-1,preserveScroll=false,pending=chatBusy}={}){
 if(!$('#chat').open)return;
 const box=$('#messages'),oldTop=box.scrollTop,follow=!preserveScroll||nearChatBottom();
 box.innerHTML=chatMessages.map((m,i)=>`<div class="message ${m.role==='user'?'user':''}" data-message="${i}">${i===typingIndex?'':esc(m.content)}</div>`).join('')+(pending?'<div class="message thinking" role="status"><span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="sr-only">Thinking…</span></div>':'');
 if(!chatMessages.length&&!pending)box.innerHTML='<div class="message">Ask one small thing. We’ll keep the answer small, too.</div>';
 box.scrollTop=follow?box.scrollHeight:oldTop;$('#sendchat').disabled=chatBusy;$('#chatinput').disabled=chatBusy;
}
function revealChatReply(text,index){
 if(!$('#chat').open||matchMedia('(prefers-reduced-motion: reduce)').matches){showMessages({pending:false});return Promise.resolve()}
 showMessages({typingIndex:index,pending:false});const element=$('#messages').querySelector('[data-message="'+index+'"]');if(!element)return Promise.resolve();
 const parts=typeof Intl.Segmenter==='function'?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),part=>part.segment):Array.from(text);
 return new Promise(resolve=>{
  let frame=0,startTime=null,finished=false;const speed=Math.max(75,parts.length/3.5);
  element.classList.add('is-typing');
  const finish=()=>{if(finished)return;finished=true;cancelAnimationFrame(frame);element.textContent=text;element.classList.remove('is-typing');if(chatReveal===controller)chatReveal=null;resolve()};
  const controller={cancel:finish};chatReveal=controller;
  const step=now=>{
   if(!$('#chat').open){finish();return}if(startTime===null)startTime=now;
   const follow=nearChatBottom(),count=Math.min(parts.length,Math.max(1,Math.floor((now-startTime)*speed/1000)));
   element.textContent=parts.slice(0,count).join('');if(follow)$('#messages').scrollTop=$('#messages').scrollHeight;
   if(count===parts.length)finish();else frame=requestAnimationFrame(step);
  };
  frame=requestAnimationFrame(step);
 });
}
function syncChatViewport(){if(!$('#chat').open)return;const viewport=window.visualViewport;$('#chat').style.setProperty('--chat-height',(viewport?.height||window.innerHeight)+'px');$('#chat').style.setProperty('--chat-top',(viewport?.offsetTop||0)+'px')}
window.visualViewport?.addEventListener('resize',syncChatViewport);window.visualViewport?.addEventListener('scroll',syncChatViewport);window.addEventListener('resize',syncChatViewport);
async function loadChat(id){const data=await api(`/questions/${id}/chat`);if(chatId===id){chatMessages=data.messages;chatLoaded=true;showMessages()}}
async function openChat(suggestion){
 if(chatBusy)return;stopChatReveal();chatId=current.id;chatMessages=[];chatLoaded=false;$('#chaterror').textContent='';$('#chatannounce').textContent='';openAppDialog($('#chat'));document.body.classList.add('chat-open');syncChatViewport();$('#messages').innerHTML=loading('Opening your conversation…');
 try{await loadChat(chatId);if(!$('#chat').open)return;if(suggestion)await sendChat(suggestion);else $('#chatinput').focus({preventScroll:true})}catch(e){$('#chaterror').textContent=e.message}
}
async function sendChat(text){
 if(chatBusy||!text.trim())return;const id=chatId;chatBusy=true;$('#chaterror').textContent='';$('#chatannounce').textContent='';chatMessages.push({role:'user',content:text});$('#chatinput').value='';showMessages();
 try{const data=await api(`/questions/${id}/chat`,{method:'POST',body:{message:text}});if(chatId===id){chatMessages.push({role:'assistant',content:data.reply});if(current?.id===id){current.conversation=[...chatMessages];const item=library.find(q=>q.id===id);if(item)item.chatCount=chatMessages.length;if(!$('#chat').open)renderToday()}await revealChatReply(data.reply,chatMessages.length-1);if($('#chat').open)$('#chatannounce').textContent=data.reply}}
 catch(e){if(chatId===id){chatMessages.pop();$('#chatinput').value=text;$('#chaterror').textContent=e.message}}
 finally{chatBusy=false;if(chatId===id){showMessages({preserveScroll:true});if($('#chat').open)$('#chatinput').focus({preventScroll:true})}}
}
$('#chatform').onsubmit=e=>{e.preventDefault();sendChat($('#chatinput').value.trim())};$('#closechat').onclick=()=>$('#chat').close();
$('#chat').addEventListener('close',()=>{stopChatReveal();document.body.classList.remove('chat-open');$('#chatannounce').textContent='';if(chatLoaded&&current?.id===chatId&&current.attempt){current.conversation=[...chatMessages];current.conversationUnavailable=false;if(!$('#today').hidden)renderToday()}});
async function toggleTheme(){const previous=theme;applyTheme(theme==='dark'?'light':'dark');if(user){try{const data=await api('/settings',{method:'PUT',body:{theme}});user.settings=data.settings}catch(e){applyTheme(previous);toast(e.message)}if(!$('#settings').hidden)renderSettings()}};
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>afterReminderMenu(async()=>{if(!user)return;const p=b.dataset.page;if(p==='friends'){await openFriendsHub()}if(p==='home'){await loadHome()}if(p==='today'){if(current&&!todayNeedsRefresh){page('today');renderToday()}else await loadToday(activeSlot<(user.settings.dailyAmount||1)?activeSlot:0)}if(p==='settings'){page('settings');renderSettings()}if(p==='bank'){page('bank');$('#bank').innerHTML=loading('Opening your collection…');try{await loadLibrary();renderBank()}catch(e){toast(e.message)}}}));
async function showShare(id){
 const dialog=$('#shareDialog');$('#shareurl').value='';$('#sharestatus').textContent='Preparing your link…';$('#copyshare').disabled=true;$('#nativeshare').hidden=!navigator.share;$('#nativeshare').disabled=true;openAppDialog(dialog);
 try{const data=await api(`/questions/${id}/share`,{method:'POST',body:{}});if(!dialog.open)return;$('#shareurl').value=data.url;$('#sharestatus').textContent='';$('#copyshare').disabled=false;$('#nativeshare').disabled=false}catch(e){$('#sharestatus').textContent=e.message}
}
$('#closeshare').onclick=()=>$('#shareDialog').close();
$('#copyshare').onclick=async()=>{try{await navigator.clipboard.writeText($('#shareurl').value);$('#sharestatus').textContent='Link copied.'}catch{$('#shareurl').focus();$('#shareurl').select();$('#sharestatus').textContent='Select and copy the link above.'}};
$('#nativeshare').onclick=async()=>{try{await navigator.share({title:'Fancy knowing the answer?',url:$('#shareurl').value})}catch(e){if(e.name!=='AbortError')$('#sharestatus').textContent='Try copying the link instead.'}};
async function loadGuest(){
 document.body.classList.add('guest-view');page('today');$('#today').innerHTML=loading('Opening a shared discovery…');
 try{const data=await api('/shared/'+encodeURIComponent(guestToken));guestQuestion=data.question;renderGuest()}catch(e){$('#today').innerHTML=`<h1>A little<br><em>hiccup.</em></h1><p class="intro" role="alert">${esc(e.message)}</p>`}
}
function renderGuest(error=''){
 const q=guestQuestion,answered=!!q.attempt;
 $('#today').innerHTML=`<div class="eyebrow">A DISCOVERY SHARED WITH YOU</div><p class="intro">Fancy knowing the answer? Take a guess.</p><article class="card"><span class="topic">${esc(q.topic)}</span><h1 class="question">${esc(q.q)}</h1><div class="answers">${q.options.map((option,i)=>`<button class="answer ${answered&&i===q.correct?'correct':answered&&i===q.attempt.choice?'wrong':''}" data-guest-answer="${i}" ${guestBusy||answered?'disabled':''}><span class="letter">${answered&&i===q.correct?'✓':String.fromCharCode(65+i)}</span>${esc(option)}</button>`).join('')}</div>${answered?`<div class="result" role="status"><strong>${q.attempt.correct?'You got it.':'A new thing to know.'}</strong><p>${esc(q.explanation)}</p></div>`:`<p class="smallnote">${guestBusy?'Checking your guess…':'No account needed. Just a little curiosity.'}</p>`}<p class="error" role="alert">${esc(error)}</p></article>`;
 document.querySelectorAll('[data-guest-answer]').forEach(button=>button.onclick=()=>answerGuest(Number(button.dataset.guestAnswer)));
}
async function answerGuest(choice){
 if(guestBusy||guestQuestion.attempt)return;guestBusy=true;renderGuest();let error='';
 try{const data=await api(`/shared/${encodeURIComponent(guestToken)}/answer`,{method:'POST',body:{choice}});guestQuestion=data.question}catch(e){error=e.message}finally{guestBusy=false;renderGuest(error)}
}
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('close',()=>{
 if(navigationClosing.delete(dialog.id))return;
 if(!navigationRestoring&&user&&history.state?.route?.dialog===dialog.id)history.back();
}));
$('#headerprofile').onclick=()=>afterReminderMenu(openMyProfile);
applyTheme(theme);
window.addEventListener('DOMContentLoaded',async()=>{
 const params=new URLSearchParams(location.search);challengeInvite=params.get('challenge');const initialGame=params.get('game');if(challengeInvite||initialGame){try{const data=await api('/me');user=data.user;applyTheme(user.settings.theme||theme)}catch{}if(initialGame&&!user){pendingGameId=initialGame;showAuth();return}if(needsProfileSetup()){pendingGameId=initialGame;await showOnboarding();return}await openGame(initialGame,challengeInvite);return}requestedSlot=/^[0-9]$/.test(params.get('slot')||'')?Number(params.get('slot')):0;requestedDay=params.get('day');guestToken=params.get('share');if(guestToken!==null){await loadGuest();return}resetToken=params.get('reset');const verifyToken=params.get('verify');
 if(resetToken||verifyToken)history.replaceState(null,'',location.pathname);
 if(resetToken){showReset();return}
 if(verifyToken){page('auth');$('#auth').innerHTML=loading('Confirming your email…');try{const result=await api('/auth/confirm-email',{method:'POST',body:{token:verifyToken}});toast(result.message)}catch(e){showAuth(e.message);return}}
 try{const data=await api('/me');user=data.user;applyTheme(user.settings.theme||theme);await afterSignIn()}catch(e){showAuth(e.status===401?'':e.message)}
});

// Delegate so every dynamically rendered password/code field has the same control.
document.addEventListener('click',event=>{
 const button=event.target.closest?.('button[data-reveal]');if(!button)return;
 const input=document.getElementById(button.dataset.reveal);if(!input)return;
 const show=input.type==='password';input.type=show?'text':'password';
 button.setAttribute('aria-pressed',String(show));
 button.setAttribute('aria-label',(show?'Hide ':'Show ')+button.dataset.revealLabel);
 button.querySelector('span').textContent=show?'Hide':'Show';
});

function showRefresherPrompt(id){
 const dialog=document.createElement('dialog');dialog.className='refresher-dialog';dialog.innerHTML=`<div class="dialoginner"><div class="dialoghead"><h2>Keep this one in mind? ❤️</h2><button class="round" aria-label="Close refresher settings">×</button></div><form><label for="refresherdays">Ask me again in</label><div class="refresher-days"><input class="field" id="refresherdays" type="number" min="1" max="365" step="1" value="7" required><span>days</span></div><p class="smallnote">Revisiting something after a few days helps it stick. Try recalling the answer before you peek.</p><p class="error" role="alert"></p><button class="primary">Save refresher</button><button class="textbtn" type="button" id="skiprefresher">Just save it</button></form><p class="smallnote">Saved already · your first refresher is in 7 days unless you change it.</p></div>`;document.body.append(dialog);dialog.querySelector('.round').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const days=Number(dialog.querySelector('input').value),data=await api('/questions/'+id+'/save',{method:'POST',body:{saved:true,reviewDays:days}});if(current?.id===id)current.saved=data.saved;await loadLibrary();dialog.close();toast('Saved · refresher in '+days+' '+(days===1?'day':'days'))}catch(error){dialog.querySelector('.error').textContent=error.message;button.disabled=false}};dialog.querySelector('#skiprefresher').onclick=async e=>{e.target.disabled=true;try{const data=await api('/questions/'+id+'/save',{method:'POST',body:{saved:true,reviewDays:null}});if(current?.id===id)current.saved=data.saved;await loadLibrary();dialog.close();toast('Saved · no refresher scheduled')}catch(error){dialog.querySelector('.error').textContent=error.message;e.target.disabled=false}};openAppDialog(dialog);
}
