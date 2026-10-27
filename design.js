window.FancyDesign=(()=>{
 const fonts={clean:{label:'Clean',family:"'Nunito Sans',sans-serif"},typewriter:{label:'Typewriter',family:"'Special Elite',monospace"},classic:{label:'Classic',family:"'Libre Baskerville',serif"},script:{label:'Script',family:"'Dancing Script',cursive"},gothic:{label:'Gothic',family:"'UnifrakturCook',serif"},handwritten:{label:'Handwritten',family:"'Caveat',cursive"}};
 const hex=c=>/^#[a-f0-9]{6}$/i.test(c||'');
 const rgb=c=>c.slice(1).match(/../g).map(n=>parseInt(n,16));
 function mix(a,b,t){return '#'+rgb(a).map((n,i)=>Math.round(n+(rgb(b)[i]-n)*t).toString(16).padStart(2,'0')).join('')}
 function luminance(c){return rgb(c).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0)}
 function contrast(a,b){const [x,y]=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (x+.05)/(y+.05)}
 function ink(c){const dark=contrast(c,'#161821'),light=contrast(c,'#ffffff');return Math.max(dark,light)<4.5?'#000000':dark>light?'#161821':'#ffffff'}
 function readable(c,bg){if(contrast(c,bg)>=4.5)return c;const to=ink(bg);for(let t=.05;t<=1;t+=.05){const x=mix(c,to,t);if(contrast(x,bg)>=4.5)return x}return to}
 function colours(settings={},mode=settings.theme||'dark'){const dark=mode==='dark';return {accent:hex(settings[dark?'accentDark':'accentLight'])?settings[dark?'accentDark':'accentLight']:dark?'#d8ac47':'#d8ac47',background:hex(settings[dark?'backgroundDark':'backgroundLight'])?settings[dark?'backgroundDark':'backgroundLight']:dark?'#101426':'#f8f5ed'}}
 function apply(settings={}){
  const root=document.documentElement,mode=settings.theme==='light'?'light':'dark',c=colours(settings,mode),text=ink(c.background),light=luminance(text)<.1;
  root.classList.toggle('light',mode==='light');root.dataset.theme=mode;
  const vars={'--bg':c.background,'--text':text,'--muted':mix(c.background,text,.68),'--panel':mix(c.background,text,.055),'--card':mix(c.background,text,.09),'--input':mix(c.background,text,.025),'--line':light?'#16182128':'#ffffff22','--accent':c.accent,'--pink':readable(c.accent,c.background),'--accent-ink':ink(c.accent),'--mint':readable('#65bd94',c.background),'--font-scale':Math.max(.75,Math.min(1.6,(settings.fontSize||100)/100)),'--app-font':fonts[settings.font]?.family||fonts.clean.family};
  for(const [key,value]of Object.entries(vars))root.style.setProperty(key,value);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',c.background);
  document.querySelectorAll('[data-theme-slider]').forEach(b=>{b.setAttribute('aria-checked',mode==='dark');b.setAttribute('aria-label',mode==='dark'?'Dark mode on. Switch to light mode':'Light mode on. Switch to dark mode')});
  try{localStorage.setItem('fancy-knowing-appearance',JSON.stringify(settings))}catch{}
 }
 function hsvHex(h,s,v){s/=100;v/=100;const c=v*s,x=c*(1-Math.abs(h/60%2-1)),m=v-c;return '#'+(h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x]).map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('')}
 function hexHsv(c){const [r,g,b]=rgb(c).map(n=>n/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;if(d)h=max===r?60*((g-b)/d%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4);return{h:(h+360)%360,s:max?d/max*100:0,v:max*100}}
 function wheel(dialog,settings,onSave){
  let target='accent',hsv=hexHsv(colours(settings).accent),draft={...colours(settings)};
  dialog.innerHTML=`<div class="dialoginner"><div class="dialoghead"><h2>Your colours</h2><button class="round" id="closewheel" aria-label="Cancel colour changes">×</button></div><p class="smallnote">Editing ${settings.theme||'dark'} mode. Drag around the wheel or use the sliders.</p><div class="colour-slots"><button class="colour-slot" data-colour="accent"><i></i>Accent</button><button class="colour-slot" data-colour="background"><i></i>Background</button></div><div class="colour-wheel" id="colourWheel" role="group" aria-label="Hue and saturation colour wheel"><span class="colour-cursor" id="colourCursor"></span></div><div class="colour-preview-row"><i id="colourPreview"></i><input class="field" id="colourHex" aria-label="Colour hex code" maxlength="7" spellcheck="false"></div><label class="range-label" for="colourHue">Hue <output id="hueValue"></output></label><input class="colour-range hue-range" id="colourHue" type="range" min="0" max="359"><label class="range-label" for="colourSaturation">Saturation <output id="saturationValue"></output></label><input class="colour-range" id="colourSaturation" type="range" min="0" max="100"><label class="range-label" for="colourBrightness">Brightness <output id="brightnessValue"></output></label><input class="colour-range" id="colourBrightness" type="range" min="0" max="100"><p class="error" id="colourError" role="alert"></p><button class="primary" id="savecolours">Save colours</button><button class="textbtn" id="resetcolours">Reset to mustard & ${settings.theme==='light'?'cream':'navy'}</button></div>`;
  const $=s=>dialog.querySelector(s),wheel=$('#colourWheel');
  function render(){const c=hsvHex(hsv.h,hsv.s,hsv.v);$('#colourHex').value=c;$('#colourPreview').style.background=c;wheel.style.setProperty('--wheel-darkness',1-hsv.v/100);const angle=hsv.h*Math.PI/180;$('#colourCursor').style.left=(50+Math.cos(angle)*hsv.s/2)+'%';$('#colourCursor').style.top=(50+Math.sin(angle)*hsv.s/2)+'%';for(const [id,k,unit]of [['colourHue','h','°'],['colourSaturation','s','%'],['colourBrightness','v','%']]){$('#'+id).value=Math.round(hsv[k]);$('#'+({h:'hueValue',s:'saturationValue',v:'brightnessValue'}[k])).textContent=Math.round(hsv[k])+unit}$('#colourSaturation').style.background='linear-gradient(90deg,#fff,'+hsvHex(hsv.h,100,100)+')';$('#colourBrightness').style.background='linear-gradient(90deg,#000,'+hsvHex(hsv.h,hsv.s,100)+')';dialog.querySelectorAll('[data-colour]').forEach(b=>{b.querySelector('i').style.background=draft[b.dataset.colour];b.setAttribute('aria-pressed',b.dataset.colour===target)})}
  function update(){draft[target]=hsvHex(hsv.h,hsv.s,hsv.v);applyDraft();render()}
  function patch(){const suffix=settings.theme==='light'?'Light':'Dark';return {['accent'+suffix]:draft.accent,['background'+suffix]:draft.background}}
  function applyDraft(){apply({...settings,...patch()})}
  function point(e){const r=wheel.getBoundingClientRect(),x=(e.clientX-r.left-r.width/2)/(r.width/2),y=(e.clientY-r.top-r.height/2)/(r.height/2);hsv.h=(Math.atan2(y,x)*180/Math.PI+360)%360;hsv.s=Math.min(100,Math.hypot(x,y)*100);update()}
  wheel.onpointerdown=e=>{wheel.setPointerCapture(e.pointerId);point(e)};wheel.onpointermove=e=>{if(wheel.hasPointerCapture(e.pointerId))point(e)};wheel.onpointerup=e=>{if(wheel.hasPointerCapture(e.pointerId))wheel.releasePointerCapture(e.pointerId)};
  for(const id of ['colourHue','colourSaturation','colourBrightness'])$('#'+id).oninput=()=>{hsv={h:Number($('#colourHue').value),s:Number($('#colourSaturation').value),v:Number($('#colourBrightness').value)};update()};
  $('#colourHex').oninput=()=>{if(hex($('#colourHex').value)){hsv=hexHsv($('#colourHex').value);update()}};$('#colourHex').onchange=render;
  dialog.querySelectorAll('[data-colour]').forEach(b=>b.onclick=()=>{target=b.dataset.colour;hsv=hexHsv(draft[target]);render()});
  $('#closewheel').onclick=()=>dialog.close();dialog.onclose=()=>apply(settings);
  $('#resetcolours').onclick=()=>{draft=colours({theme:settings.theme});hsv=hexHsv(draft[target]);applyDraft();render()};
  $('#savecolours').onclick=async()=>{$('#savecolours').disabled=true;try{await onSave(patch());dialog.onclose=null;dialog.close()}catch(e){$('#colourError').textContent=e.message;$('#savecolours').disabled=false}};
  render();dialog.showModal();
 }
 return {fonts,apply,colours,wheel,ink,contrast};
})();
