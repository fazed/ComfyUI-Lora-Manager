/* ---- full detail flyout (replaces the old modal) ---- */
Object.assign(P,{
  pencil:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  left:'<path d="m15 6-6 6 6 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  ext:'<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'
});
const DET={open:false,i:0,tab:'examples',shot:0};
let lastRows=[];
const hex64=i=>{let s='';for(let k=0;k<64;k++)s+=(((Math.sin((i+2)*(k+3)*12.9898)*43758.5453)%1+1)%1*16|0).toString(16);return s};
const PROMPTS=['masterpiece, best quality, 1girl, long hair, window light, soft focus, detailed eyes, upper body','best quality, very aesthetic, 1girl, standing, city street, golden hour, cinematic lighting'];
function openDetail(i,tab){DET.i=i;DET.tab=tab||'examples';DET.shot=0;DET.open=true;sel=i;renderDetail();render()}
function closeDetail(){DET.open=false;$('detailHost').innerHTML=''}
function stepDetail(d){const k=lastRows.findIndex(x=>x.i===DET.i),n=lastRows[k+d];if(n){DET.i=n.i;DET.shot=0;sel=n.i;renderDetail();render()}}
function bindPane(root,l){
  root.querySelectorAll('[data-shot]').forEach(b=>b.onclick=()=>{DET.shot=+b.dataset.shot;renderDetail(true)});
  root.querySelectorAll('[data-x]').forEach(b=>b.onclick=()=>{
    const x=b.dataset.x;
    if(x==='rate')openRating('this example');
    else if(x==='del')confirmDelete([l.i]);
    else if(x==='local'){closeDetail();CUSTOM={label:`Local versions of ${l.name.slice(0,24)}`,fn:o=>o.base===l.base&&o.tags[0]===l.tags[0]};render()}
    else toast({prev:'Preview replaced',folder:'Opening examples folder',dl:'Download started',ignore:'Ignoring updates for this model',civitai:'Opening the Civitai page'}[x]||'Done');
  });
  root.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>toast('Copied to clipboard'));
}
function renderDetail(paneOnly){
  const l=LORAS[DET.i],upd=UPD.has(l.i),k=lastRows.findIndex(x=>x.i===l.i);
  const words=[...new Set(l.words.flatMap(w=>w.split(',')).map(w=>w.trim()).filter(Boolean))].slice(0,8);
  const hash=hex64(l.i),short=h=>h.slice(0,10)+'…'+h.slice(-6);
  const cp=(v,t='Copy')=>`<button class="mini" data-copy="${v}" title="${t}">${ico('copy',14)}</button>`;
  const ed=t=>`<button class="mini" title="${t}">${ico('pencil',14)}</button>`;
  const creator=l.i%3===0?null:['ArtistMoo','kitsune_lab','Hoshino','softgrain','nyx_works'][l.i%5];
  const others=LORAS.filter(x=>x.i!==l.i).slice(0,5);
  const shots=[l,...others.slice(0,4)];
  const shot=shots[DET.shot]||l;
  const tabs=[['examples','Examples'],['description','Description'],['versions','Versions',upd?'Update':''],['recipes','Recipes']];
  let pane='';
  if(DET.tab==='examples')pane=`
    <div class="stage"><img src="${shot.src}" alt=""></div>
    <div class="thumbs">${shots.map((s,j)=>`<img src="${s.src}" data-shot="${j}" alt="" ${j===DET.shot?'aria-current="true"':''}>`).join('')}</div>
    <div class="gen"><div class="sec"><h5>Prompt ${cp(PROMPTS[0],'Copy prompt')}</h5><div class="p">${PROMPTS[l.i%2]}</div></div>
      <div class="sec"><h5>Negative prompt ${cp('lowres, bad anatomy','Copy negative prompt')}</h5><div class="p">lowres, bad anatomy, bad hands, text, error, worst quality, jpeg artifacts</div></div>
      <div class="row3 mono"><div><span>Seed</span>${(l.i+3)*7919241}</div><div><span>Steps</span>28</div><div><span>Sampler</span>euler_a</div><div><span>CFG</span>5.5</div><div><span>Size</span>832×1216</div><div><span>LoRA</span>${l.name.slice(0,14)} @ 0.8</div></div>
      <div class="row" style="flex-wrap:wrap"><button class="btn">${ico('copy',15)}Copy all parameters</button><button class="btn">${ico('send',15)}Send as recipe</button><button class="btn" data-x="rate">${ico('eye',15)}Set rating</button><button class="btn" data-x="prev">${ico('file',15)}Use as preview</button></div></div>
    <div class="row" style="flex-wrap:wrap"><button class="btn" data-x="folder">${ico('folder',15)}Open examples folder</button><button class="btn" data-x="dl">${ico('download',15)}Download examples</button></div>`;
  if(DET.tab==='description')pane=`<div class="about" style="max-width:62ch;line-height:1.6"><p>${l.name}: a ${l.base} LoRA for ${l.tags[0]||'style'} work. Works best at strength 0.7 to 0.9 and mixes well with other style LoRAs.</p><p style="margin-top:.8rem">Training notes: 1,200 images, 12 epochs. Use the trigger words listed on the left for a stronger effect, or leave them out for a subtle touch.</p></div>`;
  if(DET.tab==='versions')pane=`<div class="note-off" style="display:flex;gap:.6rem;align-items:center;justify-content:space-between"><span>Update tracking is on for this model.</span><button class="btn" data-x="ignore">Ignore updates</button></div>`+[upd?['v2.1',l.size+30,'early','5 days ago','Early access, paid']:null,upd?['v2.0',l.size+14,'new','2 weeks ago','Free now']:null,['v1.0',l.size,'installed','3 months ago','Current']].filter(Boolean).map(([n,s,st,when,tag])=>`
    <div class="vrow ${st==='installed'?'cur':''}"><div><b>${n}</b>${st==='installed'?'<span class="pill q">Installed</span><span class="pill q">Current</span>':st==='new'?'<span class="pill">Newer</span><span class="pill q">Free now</span>':'<span class="pill q">Early access</span><span class="pill q">Paid</span>'}<small>${l.base} · ${s} MB · ${when}</small></div>
    <div class="acts">${st==='installed'?`<button class="btn" data-x="local">View local versions</button><button class="btn" data-x="civitai">${ico('ext',15)}Open on Civitai</button><button class="btn" data-x="del" style="color:#ff6b6b">${ico('trash',15)}Delete</button>`:st==='new'?`<button class="btn primary" data-x="dl">${ico('download',15)}Download</button>`:`<button class="btn" disabled>Not downloadable</button>`}</div></div>`).join('');
  if(DET.tab==='recipes')pane=`<div class="rgrid">${others.slice(0,4).map((o,j)=>`<div class="rcard"><img src="${o.src}" alt=""><b>Recipe ${j+1}: ${o.name.slice(0,18)}</b><small>${j+2} LoRAs · ${l.base}</small></div>`).join('')}</div>`;
  const host=$('detailHost');
  if(paneOnly&&host.querySelector('.pane')){
    /* A tab or thumbnail click only swaps the right-hand pane; header and info column stay as they are. */
    const pn=host.querySelector('.pane');pn.innerHTML=pane;
    host.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===DET.tab));
    bindPane(pn,l);
    return;
  }
  $('detailHost').innerHTML=`<div class="scrim" id="scrim"></div>
  <section class="detail" role="dialog" aria-label="${l.name}">
    <header class="dh">
      <div class="r1">
        <h2>${l.name}</h2>${ed('Edit model name')}
        <span class="sp"></span>
        <div class="nav2"><button class="ib" id="dprev" title="Previous model (←)" ${k<=0?'disabled style="opacity:.3"':''}>${ico('left',17)}</button><span class="mono">${k+1} / ${lastRows.length}</span><button class="ib" id="dnext" title="Next model (→)" ${k>=lastRows.length-1?'disabled style="opacity:.3"':''}>${ico('right',17)}</button></div>
        <button class="ib" id="dclose" title="Close (Esc)">${ico('x',18)}</button>
      </div>
      <div class="r2">
        <button class="btn primary">${ico('send',15)}Send to ComfyUI</button>
        <button class="btn">${ico('globe',15)}View on Civitai</button>
        ${creator?`<span class="creator"><i>${creator[0].toUpperCase()}</i>${creator}</span>`:`<button class="btn">${ico('user',15)}Add creator</button>`}
        <span class="lic"><span title="Credit not required">Credit</span><span title="Selling images allowed">Sell images</span><span class="off" title="Selling the model not allowed">Sell model</span></span>
        <button class="ib danger" title="Delete model (Del)">${ico('trash',17)}</button>
      </div>
      <div class="tags">${l.tags.map(t=>`<span class="tagx">${t}<button title="Remove tag">${ico('x',12)}</button></span>`).join('')}<button class="btn" style="min-height:1.9rem">${ico('plus',13)}Add tag</button></div>
    </header>
    <div class="dbody">
      <div class="dl">
        <div class="sec"><h5>Info</h5>
          <div class="f"><span>Version</span><span class="v">v1.0</span>${ed('Edit version name')}</div>
          <div class="f"><span>File name</span><span class="v mono">${l.file}</span>${ed('Edit file name')}</div>
          <div class="f"><span>Location</span><span class="v"><a href="#">${l.folder}</a></span><span class="acts"><button class="mini" title="Open file location">${ico('folder',14)}</button><button class="mini" title="Open sidecar location">${ico('file',14)}</button></span></div>
          <div class="f"><span>Base model</span><span class="v">${l.base}</span>${ed('Edit base model')}</div>
          <div class="f"><span>Size</span><span class="v mono">${l.size} MB</span><span></span></div>
        </div>
        <div class="sec"><h5>Hashes and IDs</h5>
          <div class="f"><span>SHA256</span><span class="v mono">${short(hash)}</span>${cp(hash,'Copy hash')}</div>
          <div class="f"><span>AutoV3</span><span class="v mono">${hash.slice(8,20)}</span>${cp(hash.slice(8,20),'Copy hash')}</div>
          <div class="f"><span>Model ID</span><span class="v mono">${3024146+l.i*37}</span>${cp(String(3024146+l.i*37),'Copy Civitai ID')}</div>
          <div class="f"><span>Version ID</span><span class="v mono">${3434268+l.i*91}</span>${cp(String(3434268+l.i*91),'Copy Civitai ID')}</div>
        </div>
        <div class="sec"><h5>Usage tips</h5>
          <div class="words"><span class="preset">Strength <b class="mono">0.8</b><button class="mini">${ico('x',12)}</button></span><span class="preset">Clip skip <b class="mono">2</b><button class="mini">${ico('x',12)}</button></span></div>
          <div class="addrow"><select aria-label="Preset parameter"><option>Add preset parameter…</option><option>Strength min</option><option>Strength max</option><option>Strength range</option><option>Strength</option><option>Clip strength</option><option>Clip skip</option></select><input class="mono" placeholder="Value" aria-label="Value"><button class="btn" disabled>Add</button></div>
        </div>
        <div class="sec"><h5>Trigger words ${words.length?'<span class="mono">click to copy</span>':''}</h5>
          ${words.length?`<div class="words">${words.map(w=>`<span class="word">${w}${ico('copy',13)}</span>`).join('')}</div>`:'<span class="none">None. This LoRA needs no trigger.</span>'}
          <div class="addrow"><input style="flex:1;width:auto" placeholder="Add trigger word" aria-label="Add trigger word"><button class="btn">Add</button></div>
        </div>
        <div class="sec"><h5>Notes <span class="mono">Enter saves, Shift+Enter new line</span></h5><textarea placeholder="Add your notes here…" aria-label="Notes"></textarea></div>
        <div class="sec"><h5>About this version</h5><div class="about">Fixes washed-out colours from v0.9 and adds support for wider aspect ratios. Retrained on a cleaner dataset.</div></div>
      </div>
      <div class="dr">
        <div class="tabsbar" role="tablist">${tabs.map(([id,n,b])=>`<button role="tab" data-tab="${id}" aria-selected="${DET.tab===id}">${n}${b?`<span class="cnt">${b}</span>`:''}</button>`).join('')}</div>
        <div class="pane">${pane}</div>
      </div>
    </div>
  </section>`;
  const h=$('detailHost');
  h.querySelector('#scrim').onclick=closeDetail;h.querySelector('#dclose').onclick=closeDetail;
  h.querySelector('#dprev').onclick=()=>stepDetail(-1);h.querySelector('#dnext').onclick=()=>stepDetail(1);
  h.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{DET.tab=b.dataset.tab;DET.shot=0;h.querySelector('.dr').scrollTop=0;renderDetail(true)});
  bindPane(h,l);
  h.querySelectorAll('.word').forEach(w=>w.onclick=()=>toast('Copied "'+w.textContent.trim()+'"'));
  h.querySelectorAll('.tagx button').forEach(b=>b.onclick=()=>toast('Tag removed',()=>toast('Tag restored')));
  const dl=h.querySelector('.dl');
  if(dl&&l.i%7===1){dl.querySelector('.sec').insertAdjacentHTML('afterend','<div class="note-off">No hash yet. Hashing a large file can take a minute. <button class="btn" id="calch" style="margin-left:.5rem">Calculate hash</button></div>')}
  const ch=h.querySelector('#calch');if(ch)ch.onclick=()=>{ch.disabled=true;ch.textContent='Calculating…';setTimeout(()=>{ch.closest('.note-off').remove();toast('Hash calculated')},900)};
}
document.addEventListener('keydown',e=>{
  if(!DET.open)return;
  if(e.key==='Escape'){closeDetail();e.stopPropagation()}
  else if(!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){if(e.key==='ArrowLeft')stepDetail(-1);if(e.key==='ArrowRight')stepDetail(1)}
},true);
