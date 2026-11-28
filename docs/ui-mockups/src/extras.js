/* ===================== extras: features carried over from the old UI ===================== */
Object.assign(P,{
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="M17.9 17.9A10 10 0 0 1 12 19c-6.5 0-10-7-10-7a18 18 0 0 1 5-5.9M9.9 5.2A9 9 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22M14.1 14.1a3 3 0 1 1-4.2-4.2"/>',
  shapes:'<path d="M8.3 3.5 4 11h8.6z"/><circle cx="17.5" cy="17.5" r="3.5"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  ban:'<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  folderplus:'<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/>',
  collapse:'<path d="m7 15 5-5 5 5M7 9l5-5 5 5"/>',
  tick:'<path d="m5 12 5 5 9-10"/>',
  pause:'<path d="M8 4v16M16 4v16"/>',
  stop:'<rect x="5" y="5" width="14" height="14" rx="1"/>',
  play:'<path d="M7 4v16l13-8z"/>'
});

/* ---- state ---- */
const FAVS=new Set(LORAS.filter(l=>l.fav||l.i%5===0).map(l=>l.i));
const NSFW=new Set(LORAS.filter(l=>l.i%6===2).map(l=>l.i));
const EXCL=new Set(LORAS.filter(l=>l.i%11===4).map(l=>l.i));
const SKIPR=new Set(LORAS.filter(l=>l.i%7===3).map(l=>l.i));
const REVEAL=new Set(),SELS=new Set(),DELETED=new Set();
const ST={blur:true,sfw:false,cycle:true,other:false,workflows:true,wildcards:true,excl:false,dup:false,onlyUpd:false,recursive:true,empty:false,list:false,alphaMin:false};
let PAGE='loras',SORT='date:desc',TYPE='All types',ALPHA=null,QUERY='',CUSTOM=null,TAGLOGIC='any',BULK=false,anchor=null,SEED=1;
const SO={filename:1,modelname:1,tags:1,creator:0,triggerWords:0};
const PAGES=[['loras','layers','LoRAs'],['recipes','book','Recipes'],['checkpoints','box','Checkpoints'],['embeddings','type','Embeddings'],['other','shapes','Other'],['workflows','workflow','Workflows'],['wildcards','shuffle','Wildcards'],['statistics','chart','Statistics']];
const SORTS=[['name:asc','Name, A to Z'],['name:desc','Name, Z to A'],['date:desc','Date added, newest first'],['date:asc','Date added, oldest first'],['published:desc','Published, newest first'],['published:asc','Published, oldest first'],['size:desc','Size, largest first'],['size:asc','Size, smallest first'],['usage:desc','Most used'],['usage:asc','Least used'],['random','Random shuffle']];
const typeOf=l=>l.i%9===1?'LyCORIS':l.i%13===2?'DoRA':'LoRA';
const usedOf=l=>(l.i*7)%40+1;
const letterOf=n=>{const c=n.trim()[0]||'';if(/[a-z]/i.test(c))return c.toUpperCase();if(/[0-9]/.test(c))return '#';if(/[\u3040-\u30ff\u4e00-\u9fff]/.test(c))return '漢';return '@'};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---- toasts, menus, modals ---- */
document.body.insertAdjacentHTML('beforeend','<div id="toasts" aria-live="polite"></div>');
function toast(msg,undo){const t=document.createElement('div');t.className='toast';t.innerHTML=`<span>${esc(msg)}</span>`;if(undo){const b=document.createElement('button');b.textContent='Undo';b.onclick=()=>{undo();t.remove()};t.append(b)}$('toasts').append(t);setTimeout(()=>t.remove(),undo?5000:2500)}
let menuEl=null;
function closeMenu(){if(menuEl){menuEl.remove();menuEl=null}}
function showMenu(x,y,items,head){
  closeMenu();
  const m=document.createElement('div');m.className='cmenu';m.setAttribute('role','menu');
  const lead=it=>it.c!==undefined?(it.c?ico('tick',15):'<span class="mph"></span>'):(it.i?ico(it.i,15):'<span class="mph"></span>');
  m.innerHTML=(head?`<div class="mh">${head}</div>`:'')+items.map((it,k)=>it==='-'?'<div class="ms"></div>':`<div class="mi ${it.danger?'danger':''} ${it.sub?'has-sub':''}" role="menuitem" data-k="${k}">${lead(it)}<span class="ml">${it.l}</span>${it.kbd?`<kbd>${it.kbd}</kbd>`:''}${it.sub?ico('right',13)+`<div class="cmenu sub">${it.sub.map((s,j)=>`<div class="mi" data-k="${k}.${j}"><span class="ml">${s.l}</span></div>`).join('')}</div>`:''}</div>`).join('');
  document.body.append(m);menuEl=m;
  const r=m.getBoundingClientRect();
  m.style.left=Math.max(4,Math.min(x,innerWidth-r.width-8))+'px';m.style.top=Math.max(4,Math.min(y,innerHeight-r.height-8))+'px';
  if(x>innerWidth-r.width*2-16)m.classList.add('flip');
  m.onclick=e=>{const mi=e.target.closest('.mi');if(!mi||mi.classList.contains('has-sub'))return;const [k,j]=mi.dataset.k.split('.');const it=items[k];const f=j===undefined?it.f:it.sub[j].f;closeMenu();if(f)f()};
}
const menuAt=(btn,items,head)=>{const r=btn.getBoundingClientRect();showMenu(r.left,r.bottom+4,items,head)};
const say=m=>()=>toast(m);
function modal({title,body,foot,wide,mount}){
  closeModal();
  $('modalHost').innerHTML=`<div class="mback"><div class="mbox ${wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h3>${title}</h3><button class="ib" id="mx" aria-label="Close">${ico('x',18)}</button></header>${body}${foot?`<div class="mfoot">${foot}</div>`:''}</div></div>`;
  const h=$('modalHost');h.querySelector('.mback').onmousedown=e=>{if(e.target.classList.contains('mback'))closeModal()};
  $('mx').onclick=closeModal;if(mount)mount(h);
}
function closeModal(){$('modalHost').innerHTML=''}
const tog=(k,v)=>`<button class="sw2" role="switch" aria-checked="${!!v}" data-k="${k}"></button>`;
const srow=(t,d,c)=>`<div class="srow"><div>${t}${d?`<small>${d}</small>`:''}</div>${c}</div>`;
const sel2=(opts,cur)=>`<select>${opts.map(o=>`<option ${o===cur?'selected':''}>${esc(o)}</option>`).join('')}</select>`;

/* ---- theme ---- */
const mq=matchMedia('(prefers-color-scheme: light)');
let THEME=store.get('lm-ui-theme','dark');
const effTheme=()=>THEME==='auto'?(mq.matches?'light':'dark'):THEME;
function applyTheme(save=true){
  document.documentElement.dataset.theme=effTheme();
  document.querySelectorAll('#theme button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===THEME));
  setHi(document.documentElement.dataset.hi||store.get('lm-ui-highlight','#ffffff'),false);
  if(save)store.set('lm-ui-theme',THEME);
}
$('theme').innerHTML=[['Dark','dark'],['Light','light'],['Auto','auto']].map(([l,v])=>`<button data-v="${v}" aria-pressed="false">${l}</button>`).join('');
$('theme').onclick=e=>{const b=e.target.closest('button');if(b){THEME=b.dataset.v;applyTheme()}};
mq.addEventListener('change',()=>{if(THEME==='auto')applyTheme(false)});

/* ---- rail ---- */
function buildRail(){
  const vis=([id])=>!(id==='other'&&!ST.other)&&!(id==='workflows'&&!ST.workflows)&&!(id==='wildcards'&&!ST.wildcards);
  $('rail').querySelectorAll('.rn,.rb,.mark,.rsp').forEach(e=>e.remove());
  const bottom=[['pbtn','moon','Appearance'],['setbtn','gear','Settings'],['helpbtn','help','Help'],['bellbtn','bell','Notifications'],['supbtn','heart','Support']];
  $('rail').insertAdjacentHTML('beforeend',`<span class="mark">${MARK(26)}</span>`+PAGES.filter(vis).map(([id,ic,n])=>`<a href="#" class="rn" data-p="${id}" ${id===PAGE?'aria-current="page"':''} aria-label="${n}">${ico(ic,20)}<span class="tip">${n}</span></a>`).join('')+'<span class="sp rsp"></span>'+
    bottom.map(([id,ic,n])=>`<button class="rb" id="${id}" aria-label="${n}">${ico(ic,19)}<span class="tip">${n}</span>${id==='bellbtn'?'<span class="rail-dot"></span>':''}</button>`).join(''));
  const m=$('rail').querySelector('.mark');$('rail').prepend(m);
}
$('rail').addEventListener('click',e=>{
  const a=e.target.closest('.rn');if(a){e.preventDefault();setPage(a.dataset.p);return}
  const b=e.target.closest('.rb');if(!b)return;e.stopPropagation();
  ({pbtn:()=>$('pop').classList.toggle('open'),setbtn:()=>openSettings(),helpbtn:()=>openHelp('start'),bellbtn:openNotif,supbtn:openSupport})[b.id]();
});
document.addEventListener('click',e=>{
  if(!e.target.closest('#pop')&&!e.target.closest('#pbtn'))$('pop').classList.remove('open');
  if(!e.target.closest('.fwrap'))closeFly();
  if(!e.target.closest('.cmenu'))closeMenu();
});
$('pop').addEventListener('click',e=>e.stopPropagation());

/* ---- search ---- */
$('qclear').innerHTML=ico('x',13);$('qopt').innerHTML=ico('sliders',15);
$('q').oninput=e=>{QUERY=e.target.value.trim();$('qclear').hidden=!QUERY;$('qk').hidden=!!QUERY;clearTimeout($('q')._t);$('q')._t=setTimeout(render,150)};
$('qclear').onclick=()=>{$('q').value='';$('q').oninput({target:$('q')});$('q').focus()};
$('q').onkeydown=e=>{if(e.key==='Escape'){if($('q').value){$('qclear').click()}else $('q').blur()}};
$('qopt').onclick=e=>{e.stopPropagation();const open=$('soPop').hidden;closeFly();$('soPop').hidden=!open};
const SOLAB={filename:'Filename',modelname:'Model name',tags:'Tags',creator:'Creator',triggerWords:'Trigger words'};
function soBuild(){$('soOpts').innerHTML=Object.keys(SOLAB).map(k=>`<div class="opt ${SO[k]?'on':''}" data-so="${k}"><i></i><span class="t">${SOLAB[k]}</span></div>`).join('')+`<div class="opt ${ST.recursive?'on':''}" data-so="_rec"><i></i><span class="t">Include subfolders</span></div>`}
soBuild();
$('soOpts').onclick=e=>{const o=e.target.closest('.opt');if(!o)return;const k=o.dataset.so;if(k==='_rec')ST.recursive=!ST.recursive;else SO[k]=SO[k]?0:1;soBuild();render()};

/* ---- toolbar ---- */
B('b-type','down','All types');B('a-import','plus','Import');B('a-batch','folderplus','Batch import');
B('a-refresh','refresh','Refresh','<kbd class="kb">R</kbd>');B('a-dl','download','Download','<kbd class="kb" style="color:inherit;opacity:.6;border-color:currentColor">D</kbd>');
B('a-bulk','check','Bulk select','<kbd class="kb">B</kbd>');B('a-doc','activity','Doctor','<span class="cnt">2</span>');
$('a-refresh-m').innerHTML=ico('down',14);$('a-upd-m').innerHTML=ico('down',14);
const sortLabel=()=>B('b-sort','down',SORTS.find(s=>s[0]===SORT)[1]);
sortLabel();
$('b-sort').onclick=e=>{e.stopPropagation();menuAt($('b-sort'),SORTS.map(([k,l])=>({l,c:SORT===k,f:()=>{SORT=k;if(k==='random')SEED=Math.random();sortLabel();render()}})))};
$('b-type').onclick=e=>{e.stopPropagation();menuAt($('b-type'),['All types','LoRA','LyCORIS','DoRA'].map(t=>({l:t,c:TYPE===t,f:()=>{TYPE=t;B('b-type','down',t);render()}})))};
function scan(full){$('scanst').textContent=full?'Rebuilding cache…':'Scanning…';setTimeout(()=>{$('scanst').textContent='Scan idle';toast(full?'Cache rebuilt':'Library refreshed')},1100)}
$('a-refresh').onclick=()=>scan(false);
$('a-refresh-m').onclick=e=>{e.stopPropagation();menuAt($('a-refresh'),[{i:'refresh',l:'Rebuild cache (full rescan)',f:()=>scan(true)},'-',{l:'Scan only…',f:()=>{}},{l:'G:\\ComfyUI\\models\\loras',f:()=>scan(false)},{l:'ComfyUI-Shared\\models\\loras',f:()=>scan(false)},'-',{i:'up',l:'Check for updates',f:say('Checking for updates…')}])};
$('a-fetch').onclick=say('Fetching metadata from Civitai…');
$('a-bulk').onclick=()=>setBulk(!BULK);
$('a-dup').onclick=()=>{ST.dup=!ST.dup;$('a-dup').setAttribute('aria-pressed',ST.dup);render()};
$('a-upd').onclick=()=>{ST.onlyUpd=!ST.onlyUpd;$('a-upd').setAttribute('aria-pressed',ST.onlyUpd);render()};
$('a-upd-m').onclick=e=>{e.stopPropagation();menuAt($('a-upd'),[{i:'up',l:'Check for updates',f:say('Checking for updates…')}])};
$('a-doc').onclick=openDoctor;
$('a-dl').onclick=openDownload;
$('a-import').onclick=openImport;$('a-batch').onclick=say('Batch import opens here: folder or URL list, with progress and a results summary.');
$('t-filters').addEventListener('click',()=>{$('soPop').hidden=true});

/* ---- filters: presets, any/all, licence cycle ---- */
const FP=JSON.parse(store.get('lm-ui-fpresets','null')||'null')||[{n:'Illustrious characters',f:['Illustrious','character']},{n:'Anima styles',f:['Anima','style']}];
function applyFacets(list){document.querySelectorAll('#fly .opt').forEach(o=>o.classList.toggle('on',list.includes(o.dataset.f)));filters()}
function presetsBuild(){
  $('presets').innerHTML=FP.map((p,i)=>`<span class="tagx"><a href="#" data-pa="${i}" style="color:inherit;text-decoration:none">${esc(p.n)}</a><button data-pd="${i}" title="Delete preset" aria-label="Delete preset ${esc(p.n)}">${ico('x',12)}</button></span>`).join('')+
   `<span id="psave"><button class="btn" id="padd" style="min-height:1.9rem">${ico('plus',13)}Save current</button></span>`;
}
$('presets').onclick=e=>{
  const a=e.target.closest('[data-pa]');if(a){e.preventDefault();applyFacets(FP[+a.dataset.pa].f);return}
  const d=e.target.closest('[data-pd]');if(d){const [p]=FP.splice(+d.dataset.pd,1);store.set('lm-ui-fpresets',JSON.stringify(FP));presetsBuild();toast(`Deleted preset "${p.n}"`,()=>{FP.push(p);store.set('lm-ui-fpresets',JSON.stringify(FP));presetsBuild()});return}
  if(e.target.closest('#padd')){$('psave').innerHTML='<input id="pname" maxlength="30" placeholder="Preset name" style="background:var(--panel);border:1px solid var(--line-2);border-radius:6px;padding:.3rem .6rem;color:var(--text);font:inherit;width:9rem"> <button class="btn" id="pok" style="min-height:1.9rem">Save</button>';$('pname').focus();return}
  if(e.target.closest('#pok')){const n=$('pname').value.trim();if(!n)return;FP.push({n,f:[...document.querySelectorAll('#fly .opt.on')].map(o=>o.dataset.f)});store.set('lm-ui-fpresets',JSON.stringify(FP));presetsBuild();toast(`Saved preset "${n}"`)}
};
presetsBuild();
$('taglogic').onclick=e=>{const b=e.target.closest('button');if(!b)return;TAGLOGIC=b.dataset.v;$('taglogic').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));render()};
document.querySelectorAll('#g-lic .opt').forEach(o=>o.onclick=()=>{if(o.classList.contains('on')){o.classList.remove('on');o.classList.add('ex')}else if(o.classList.contains('ex'))o.classList.remove('ex');else o.classList.add('on');filters()});

/* ---- folders ---- */
const TT=[['All',1185,0],['Anima',341,0],['action',62,1],['character',118,1],['clothing',74,1],['concept',51,1],['style',36,1],['Illustrious',702,0],['action',140,1],['character',266,1],['pony-merge',58,2],['xl-native',208,2],['clothing',121,1],['lingerie',34,2],['uniform',87,2],['concept',96,1],['style',79,1],['Krea 2',14,0],['SD 1.5',22,0],['archive',61,0],['2024',38,1],['2025',23,1],['Qwen',6,0],['MOSS Image',1,0],['unsorted',0,0]].map(([n,c,d],i)=>({n,c,d,i}));
TT.forEach((x,i)=>{x.kids=!!(TT[i+1]&&TT[i+1].d>x.d);let k=i-1;while(k>=0&&TT[k].d>=x.d)k--;x.par=x.d?k:-1});
const fopen=new Set([0,1,7,9]);let curFold=0;
const pathOf=i=>{const p=[];for(let k=i;k>=0;k=TT[k].par){p.unshift(k);if(TT[k].par<0)break}if(p[0]!==0)p.unshift(0);return p};
const rootName=()=>PAGES.find(p=>p[0]===PAGE)[2];
function tree(){
  const q=$('fq').value.trim().toLowerCase();
  const rows=[];let skip=null;
  TT.forEach(x=>{
    if(!ST.empty&&x.c===0)return;
    if(!ST.list&&skip!==null&&x.d>skip)return;skip=null;
    if(q&&!x.n.toLowerCase().includes(q))return;
    rows.push(x);
    if(!ST.list&&!q&&x.kids&&!fopen.has(x.i))skip=x.d;
  });
  $('tree').innerHTML=rows.map(x=>{
    const label=x.i===0?'All '+rootName():(ST.list?pathOf(x.i).slice(1).map(k=>TT[k].n).join(' / '):x.n);
    return `<div class="fold ${x.i===curFold?'on':''}" data-i="${x.i}" style="padding-left:${.5+(ST.list?0:x.d)*1.1}rem">
    <span class="tw ${!ST.list&&x.kids?(fopen.has(x.i)||q?'open':''):''}">${!ST.list&&x.kids?ico('right',12):''}</span>
    ${ico('folder',15)}<span class="nm">${label}</span><span class="n mono">${x.c}</span></div>`}).join('')||'<div class="none" style="padding:.6rem">No folder matches.</div>';
  let ht=null;
  $('tree').querySelectorAll('.fold').forEach(f=>{
    const i=+f.dataset.i;
    f.querySelector('.tw').onclick=e=>{if(!TT[i].kids||ST.list)return;e.stopPropagation();fopen.has(i)?fopen.delete(i):fopen.add(i);tree()};
    f.onclick=()=>{curFold=i;tree();crumbs()};
    f.ondragover=e=>{e.preventDefault();f.classList.add('dropt')};
    f.ondragenter=()=>{clearTimeout(ht);if(TT[i].kids&&!fopen.has(i))ht=setTimeout(()=>{fopen.add(i);tree()},600)};
    f.ondragleave=()=>{f.classList.remove('dropt');clearTimeout(ht)};
    f.ondrop=e=>{e.preventDefault();clearTimeout(ht);const n=DRAGN||1;toast(`Moved ${n} ${n>1?'models':'model'} to ${TT[i].n}`,()=>toast('Move undone'));tree()};
  });
}
$('fq').oninput=tree;
$('f-new').innerHTML=ico('folderplus',16);$('f-col').innerHTML=ico('collapse',16);$('f-opt').innerHTML=ico('sliders',16);
$('f-new').onclick=say('New folder: type a name, then press Enter.');
$('f-col').onclick=()=>{fopen.clear();tree()};
$('f-opt').onclick=e=>{e.stopPropagation();menuAt($('f-opt'),[{l:'Tree view',c:!ST.list,f:()=>{ST.list=false;tree()}},{l:'List view',c:ST.list,f:()=>{ST.list=true;tree()}},'-',{l:'Include subfolders',c:ST.recursive,f:()=>{ST.recursive=!ST.recursive;soBuild()}},{l:'Show empty folders (1)',c:ST.empty,f:()=>{ST.empty=!ST.empty;tree()}}])};
function crumbs(){
  const p=pathOf(curFold);
  $('crumbs').innerHTML=p.map((k,j)=>{
    const last=j===p.length-1,name=k===0?'All '+rootName():TT[k].n;
    const sibs=TT.filter(x=>x.par===TT[k].par&&x.i!==0);
    return `<button class="${last?'last':''}" data-c="${k}">${esc(name)}</button>`+(k!==0&&sibs.length>1||TT[k].kids?`<button data-sib="${k}" aria-label="Siblings of ${esc(name)}">${ico('down',13)}</button>`:'')+(last?'':'<span class="sepc">/</span>');
  }).join('')+`<span class="cnt mono">${TT[curFold].c} in this folder</span>`;
}
$('crumbs').onclick=e=>{
  const c=e.target.closest('[data-c]');if(c){curFold=+c.dataset.c;tree();crumbs();return}
  const s=e.target.closest('[data-sib]');if(!s)return;e.stopPropagation();
  const k=+s.dataset.sib;const list=TT[k].kids&&k===pathOf(curFold).slice(-1)[0]?TT.filter(x=>x.par===k):TT.filter(x=>x.par===TT[k].par&&x.i!==0);
  menuAt(s,list.map(x=>({l:x.n,c:x.i===k,f:()=>{curFold=x.i;tree();crumbs()}})));
};
crumbs();

/* ---- alphabet bar ---- */
const LETTERS=['#',...'ABCDEFGHIJKLMNOPQRSTUVWXYZ','@','漢'];
function alpha(){
  const cnt={};LORAS.forEach(l=>{const k=letterOf(l.name);cnt[k]=(cnt[k]||0)+1});
  $('alpha').classList.toggle('min',ST.alphaMin);
  $('alpha').innerHTML=`<button class="mini" id="alt" title="Show or hide the alphabet bar" aria-label="Show or hide the alphabet bar">${ico(ST.alphaMin?'down':'right',14)}</button><span class="mono" style="color:var(--text-3);margin-right:.4rem">${ALPHA||'A–Z'}</span><span class="letters">${LETTERS.map(k=>`<button class="l" data-l="${k}" ${cnt[k]?'':'disabled'} aria-pressed="${ALPHA===k}" title="${cnt[k]||0}">${k}</button>`).join('')}</span>`;
  $('alt').onclick=()=>{ST.alphaMin=!ST.alphaMin;alpha()};
}
$('alpha').addEventListener('click',e=>{const b=e.target.closest('.l');if(b){ALPHA=ALPHA===b.dataset.l?null:b.dataset.l;render()}});

/* ---- bulk mode ---- */
function setBulk(on,all){
  BULK=on;if(!on)SELS.clear();if(on&&all)lastRows.forEach(l=>SELS.add(l.i));
  $('a-bulk').setAttribute('aria-pressed',on);render();
}
function bulkBar(){
  const bb=$('bulkbar');bb.hidden=!BULK;if(!BULK)return;
  const A=(ic,t,f)=>({ic,t,f});
  const acts=[['select','check','Select all'],['tags','plus','Add tags'],['fav','star','Favorite'],['move','folder','Move'],['send','send','Send']];
  bb.innerHTML=`<b class="mono">${SELS.size} selected</b>`+acts.map(([k,ic,t])=>`<button class="btn" data-b="${k}">${ico(ic,15)}${t}</button>`).join('')+`<button class="btn" data-b="more" title="More actions" aria-label="More actions">${ico('more',15)}</button><span class="sepv"></span><button class="btn" data-b="del" style="color:#ff6b6b">${ico('trash',15)}Delete</button><button class="btn" data-b="exit">Done</button>`;
}
$('bulkbar').onclick=e=>{
  const b=e.target.closest('[data-b]');if(!b)return;e.stopPropagation();const n=SELS.size;
  ({select:()=>{lastRows.forEach(l=>SELS.add(l.i));render()},tags:()=>bulkTags(),base:()=>bulkBase(),fav:()=>{SELS.forEach(i=>FAVS.add(i));toast(`${n} marked as favorite`);render()},rate:()=>openRating(`${n} models`),move:()=>openMove(`${n} models`),organize:openOrganize,send:()=>toast(`Added ${n} LoRAs to ComfyUI`),more:()=>menuAt(b,bulkItems()),del:()=>confirmDelete([...SELS]),exit:()=>setBulk(false)})[b.dataset.b]();
};

/* ---- context menus ---- */
const dlSub=[{l:'Missing only',f:()=>startProgress()},{l:'Reprocess all',f:()=>startProgress()}];
function cardItems(l){
  return [{i:'refresh',l:'Refresh metadata',f:say('Refreshing metadata…')},{i:'up',l:'Check updates',f:say('Checking updates…')},{i:'sliders',l:'Edit precision',f:say('Opens the quantization editor.')},
   {i:'globe',l:'Link model',sub:[{l:'Link to Civitai…',f:()=>openLink('Civitai')},{l:'Link to Hugging Face or other source…',f:()=>openLink('Hugging Face')},{l:'Enrich via AI agent',f:say('Asking the AI agent…')}]},'-',
   {i:'copy',l:'Copy LoRA syntax',f:say(`Copied <lora:${l.name.slice(0,20)}:0.8>`)},{i:'send',l:'Send to workflow',sub:[{l:'Append',f:say('Added to ComfyUI')},{l:'Replace',f:say('Replaced in ComfyUI')}]},'-',
   {i:'folder',l:'Open examples folder',f:say('Opening examples folder')},{i:'download',l:'Download examples',sub:dlSub},{i:'file',l:'Replace preview',f:say('Choose an image or video.')},{i:'eye',l:'Set content rating',f:()=>openRating(l.name)},'-',
   {i:'folder',l:'Move to folder',f:()=>openMove(l.name)},{i:'eyeoff',l:EXCL.has(l.i)?'Restore model':'Exclude model',f:()=>{EXCL.has(l.i)?EXCL.delete(l.i):EXCL.add(l.i);render();toast(EXCL.has(l.i)?'Model excluded':'Model restored')}},{i:'trash',l:'Delete model',danger:1,f:()=>confirmDelete([l.i])}];
}
function bulkItems(){return [{i:'refresh',l:'Refresh metadata',f:say('Refreshing metadata…')},{i:'up',l:'Check updates',f:say('Checking updates…')},{i:'ban',l:'Skip metadata refresh',f:say('Will skip these models')},'-',{i:'send',l:'Send to workflow',sub:[{l:'Append',f:say('Added to ComfyUI')},{l:'Replace',f:say('Replaced in ComfyUI')}]},{i:'copy',l:'Copy all syntax',f:say('Copied syntax for all selected')},'-',{i:'plus',l:'Add tags…',f:bulkTags},{i:'box',l:'Set base model…',f:bulkBase},{i:'star',l:'Mark as favorite',f:()=>{SELS.forEach(i=>FAVS.add(i));render()}},{i:'eye',l:'Set content rating…',f:()=>openRating('selected models')},'-',{i:'download',l:'Download examples',sub:dlSub},{i:'file',l:'Apply filename template',f:say('Confirm the template, then rename.')},{i:'refresh',l:'Auto-organize…',f:openOrganize},{i:'folder',l:'Move all…',f:()=>openMove('selected models')},'-',{i:'trash',l:'Delete all',danger:1,f:()=>confirmDelete([...SELS])}]}
const globalItems=()=>[{i:'download',l:'Download example images',sub:dlSub},{i:'up',l:'Check model updates',f:say('Checking updates…')},{i:'file',l:'Fetch missing licenses',f:say('Fetching licenses…')},{i:'trash',l:'Clean up example-image folders',f:say('Cleaned up 3 orphaned folders')},'-',{i:'eyeoff',l:'Manage excluded models',f:()=>{ST.excl=true;render()}},{i:'layers',l:'Group by model',c:V.group==='base',f:()=>{V.group=V.group==='base'?'none':'base';view()}}];
const folderItems=i=>[{i:'refresh',l:'Scan folder',f:say('Scanning folder…')},{i:'up',l:'Check folder updates',f:say('Checking updates…')},{i:'file',l:'Apply filename template to folder',f:say('Confirm the template, then rename.')},'-',{i:'folderplus',l:'New subfolder',f:say('New subfolder: type a name.')},{i:'pencil',l:'Rename',f:say('Rename in place.')},{i:'trash',l:'Delete folder',danger:1,f:()=>say(`Folder "${TT[i].n}" deleted. Undo is available for 30 seconds.`)()}];
document.addEventListener('contextmenu',e=>{
  const card=e.target.closest('.card'),fold=e.target.closest('.fold');
  if(DET.open||e.target.closest('.mbox,.cmenu,input,textarea'))return;
  if(card){e.preventDefault();const i=+card.dataset.i;
    if(BULK&&SELS.has(i))showMenu(e.clientX,e.clientY,bulkItems(),`${SELS.size} selected`);
    else{sel=i;showMenu(e.clientX,e.clientY,cardItems(LORAS[i]),LORAS[i].name.slice(0,28))}}
  else if(fold){e.preventDefault();showMenu(e.clientX,e.clientY,folderItems(+fold.dataset.i),TT[+fold.dataset.i].n)}
  else if(e.target.closest('#grid')||e.target.closest('.stats')){e.preventDefault();showMenu(e.clientX,e.clientY,globalItems())}
});

/* ---- modals ---- */
function confirmDelete(ids){
  if(!ids.length)return;const l=ids.length===1?LORAS[ids[0]].name:`${ids.length} models`;
  modal({title:'Delete model?',body:`<div class="mbody"><p>${esc(l)} will be moved out of your library. You can undo this for a few seconds afterwards.</p></div>`,foot:'<button class="btn" id="mcancel">Cancel</button><button class="btn primary" id="mok" style="background:#e5484d;border-color:#e5484d;color:#fff">Delete</button>',mount:()=>{$('mcancel').onclick=closeModal;$('mok').onclick=()=>{closeModal();ids.forEach(i=>DELETED.add(i));SELS.clear();render();toast(`Deleted ${l}`,()=>{ids.forEach(i=>DELETED.delete(i));render()})}}});
}
function openRating(what){
  const L=['PG','PG-13','R','X','XXX'];let cur=1;
  modal({title:'Content rating',body:`<div class="mbody"><p style="color:var(--text-2)">Rating for ${esc(what)}. Models at or above your blur threshold are hidden behind a blur.</p><div class="lvls">${L.map((x,k)=>`<button data-k="${k}" aria-pressed="${k===cur}">${x}</button>`).join('')}</div></div>`,foot:'<button class="btn" id="mcancel">Cancel</button><button class="btn primary" id="mok">Save rating</button>',mount:h=>{h.querySelector('.lvls').onclick=e=>{const b=e.target.closest('button');if(!b)return;cur=+b.dataset.k;h.querySelectorAll('.lvls button').forEach(x=>x.setAttribute('aria-pressed',x===b))};$('mcancel').onclick=closeModal;$('mok').onclick=()=>{closeModal();toast(`Rating set to ${L[cur]}`)}}});
}
function openMove(what){
  modal({title:'Move to folder',body:`<div class="mbody"><div class="fld"><label>Moving</label><div>${esc(what)}</div></div><div class="srow"><div>Use default path</div>${tog('x',false)}</div>
   <div class="fld"><label>Model root</label><select><option>G:\\ComfyUI\\models\\loras</option><option>ComfyUI-Shared\\models\\loras</option></select></div>
   <div class="fld"><label>Folder</label><input id="mpath" placeholder="Illustrious/character" value="Illustrious/character"><div class="words" style="margin-top:.3rem">${['Anima/action','Anima/style','Illustrious/concept','archive/2025'].map(p=>`<span class="word" data-p="${p}">${p}</span>`).join('')}</div></div></div>`,
   foot:'<button class="btn" id="mcancel">Cancel</button><button class="btn" id="mnew">New folder</button><button class="btn primary" id="mok">Move here</button>',
   mount:h=>{h.querySelectorAll('[data-p]').forEach(w=>w.onclick=()=>$('mpath').value=w.dataset.p);h.querySelector('.sw2').onclick=e=>e.currentTarget.setAttribute('aria-checked',e.currentTarget.getAttribute('aria-checked')!=='true');$('mcancel').onclick=closeModal;$('mnew').onclick=say('Creates the folder if it does not exist.');$('mok').onclick=()=>{const p=$('mpath').value;closeModal();toast(`Moved ${what} to ${p}`,()=>toast('Move undone'));SELS.clear();render()}}});
}
function bulkTags(){
  modal({title:`Add tags to ${SELS.size} models`,body:`<div class="mbody"><div class="fld"><label>Tags</label><input placeholder="Type a tag, press Enter"></div><div class="words">${['character','style','concept','clothing'].map(t=>`<span class="word">${t}</span>`).join('')}</div><div class="lvls"><button aria-pressed="true">Append</button><button aria-pressed="false">Replace</button></div></div>`,foot:'<button class="btn" id="mcancel">Cancel</button><button class="btn primary" id="mok">Apply</button>',mount:h=>{h.querySelector('.lvls').onclick=e=>{const b=e.target.closest('button');if(!b)return;h.querySelectorAll('.lvls button').forEach(x=>x.setAttribute('aria-pressed',x===b))};$('mcancel').onclick=closeModal;$('mok').onclick=()=>{closeModal();toast('Tags added')}}});
}
function bulkBase(){
  modal({title:`Set base model for ${SELS.size} models`,body:`<div class="mbody"><div class="fld"><label>Base model</label><select>${['Illustrious','Anima','Krea 2','SD 1.5','Qwen','MOSS Image','Other'].map(b=>`<option>${b}</option>`).join('')}</select></div></div>`,foot:'<button class="btn" id="mcancel">Cancel</button><button class="btn primary" id="mok">Apply</button>',mount:()=>{$('mcancel').onclick=closeModal;$('mok').onclick=()=>{closeModal();toast('Base model updated')}}});
}
function openOrganize(){
  modal({title:'Auto-organize',wide:true,body:`<div class="mbody"><p style="color:var(--text-2)">Preview: ${Math.max(SELS.size,6)} files will move to folders based on your path template <span class="mono">{base_model}/{first_tag}</span>.</p>${LORAS.slice(0,5).map(l=>`<div class="issue"><div><b>${esc(l.name.slice(0,40))}</b><small class="mono">${esc(l.folder)} → ${esc(l.base)}/${esc(l.tags[0]||'misc')}</small></div><span class="pill q">Move</span></div>`).join('')}</div>`,foot:'<button class="btn" id="mcancel">Cancel</button><button class="btn primary" id="mok">Organize</button>',mount:()=>{$('mcancel').onclick=closeModal;$('mok').onclick=()=>{closeModal();toast('Moved 6 files',()=>toast('Move undone'))}}});
}
function openLink(src){
  modal({title:`Link to ${src}`,body:`<div class="mbody"><p style="color:var(--text-2)">Paste the model page URL. Metadata, trigger words and updates will come from there.</p><div class="fld"><label>URL</label><input placeholder="https://…"></div></div>`,foot:'<button class="btn" id="mcancel">Cancel</button><button class="btn primary" id="mok">Link model</button>',mount:()=>{$('mcancel').onclick=closeModal;$('mok').onclick=()=>{closeModal();toast('Model linked')}}});
}
function openDownload(){
  let step=0;const names=['Link','Version','Location'];
  const draw=()=>{
    const bodies=[`<div class="fld"><label>Civitai or Hugging Face URLs, one per line</label><textarea style="background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:.5rem .7rem;color:var(--text);font:inherit;min-height:6rem" placeholder="https://civitai.com/models/…"></textarea></div>`,
     `<div class="vrow cur"><div><b>v2.0</b><span class="pill">New</span><small>Anima · 232 MB · 2 weeks ago</small></div><span class="mono">selected</span></div><div class="vrow"><div><b>v1.0</b><span class="pill q">In library</span><small>Anima · 218 MB · 3 months ago</small></div></div><div class="vrow"><div><b>v2.1 early access</b><span class="pill q">Paid</span><small>Not downloadable yet</small></div></div>`,
     `<div class="srow"><div>Use default path<small>Matches rule: Anima / {first_tag}</small></div>${tog('x',true)}</div><div class="fld"><label>Model root</label><select><option>G:\\ComfyUI\\models\\loras</option></select></div><div class="fld"><label>Folder</label><input value="Anima/style"></div>`];
    modal({title:'Download model',body:`<div class="mbody"><div class="steps">${names.map((n,k)=>`<b class="${k<=step?'on':''}">${k+1}</b><span class="${k===step?'on':''}">${n}</span>${k<2?'<span>·</span>':''}`).join(' ')}</div>${bodies[step]}</div>`,foot:`<button class="btn" id="mcancel">${step?'Back':'Cancel'}</button><button class="btn primary" id="mok">${step<2?'Next':'Download'}</button>`,mount:h=>{h.querySelectorAll('.sw2').forEach(s=>s.onclick=()=>s.setAttribute('aria-checked',s.getAttribute('aria-checked')!=='true'));$('mcancel').onclick=()=>{if(step){step--;draw()}else closeModal()};$('mok').onclick=()=>{if(step<2){step++;draw()}else{closeModal();toast('Download started')}}}});
  };draw();
}
function openImport(){
  modal({title:'Import recipe',body:`<div class="mbody"><div class="steps"><b class="on">1</b><span class="on">Source</span><span>·</span><b>2</b><span>Details</span><span>·</span><b>3</b><span>Location</span></div><div class="stage" style="min-height:9rem;border-style:dashed"><span style="color:var(--text-2);padding:2rem;text-align:center">Drop an image here, or choose a file</span></div><div class="fld"><label>Or paste an image URL or path</label><input placeholder="https://… or C:\\…"></div></div>`,foot:'<button class="btn" id="mcancel">Cancel</button><button class="btn primary" id="mok">Fetch</button>',mount:()=>{$('mcancel').onclick=closeModal;$('mok').onclick=()=>{closeModal();toast('Recipe details load here: name, tags and LoRA list')}}});
}
function openDoctor(){
  modal({title:'Doctor',body:`<div class="mbody"><p style="color:var(--text-2)">2 issues found. Repairs only touch LoRA Manager's own files.</p><div class="issue"><div><b>Cache is out of sync</b><small>14 files on disk are missing from the cache.</small></div><button class="btn">Repair</button></div><div class="issue"><div><b>Duplicate filenames</b><small>2 files share a name in different folders.</small></div><button class="btn">Resolve…</button></div></div>`,foot:'<button class="btn" id="mexp">Export diagnostics</button><button class="btn primary" id="mok">Run again</button>',mount:()=>{$('mexp').onclick=say('Diagnostics bundle saved.');$('mok').onclick=say('No new issues found.')}});
}
function tabbed(title,tabs,wide,start){
  let cur=start||tabs[0][0];
  const draw=()=>modal({title,wide,body:`<div class="tabsbar" role="tablist">${tabs.map(([k,l])=>`<button role="tab" data-t="${k}" aria-selected="${k===cur}">${l}</button>`).join('')}</div><div class="mbody">${tabs.find(t=>t[0]===cur)[2]()}</div>`,mount:h=>{h.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{cur=b.dataset.t;draw()})}});
  draw();
}
function openHelp(start){
  const keys=[['Ctrl F','Focus search'],['Esc','Close menu, dialog or panel, clear search'],['R','Refresh'],['D','Download'],['B','Bulk select'],['Ctrl A','Select all (starts bulk select)'],['Shift + click','Select a range'],['Alt + A to Z','Jump to a letter'],['← →','Previous or next model in details'],['Del','Delete the model in details'],['Shift + send','Replace instead of append'],['?','Open this help']];
  tabbed('Help',[['start','Getting started',()=>`<p>Fetch metadata for your library, download new models, then right-click a card to send it to ComfyUI.</p><div class="stage" style="aspect-ratio:16/9"><span style="color:var(--text-2)">Intro video</span></div><button class="btn" id="replay" style="justify-self:start">Replay tutorial</button>`],['updates','Updates',()=>'<p style="color:var(--text-2)">Video playlist with release walkthroughs.</p>'],['docs','Documentation',()=>['Quick start','Recipes','Settings','Troubleshooting'].map(t=>`<div class="issue"><b>${t}</b>${ico('ext',16)}</div>`).join('')],['keys','Shortcuts',()=>`<div class="kbrow">${keys.map(([k,t])=>`<span><kbd>${k}</kbd></span><span>${t}</span>`).join('')}</div>`]],false,start==='keys'?'keys':'start');
}
function openNotif(){
  $('rail').querySelector('.rail-dot')?.remove();
  tabbed('Notifications',[['up','Updates',()=>`<div class="vrow cur"><div><b>Version 1.1.0 is available</b><span class="pill">New</span><small>You have 1.0.0 · release channel</small></div><button class="btn primary" id="un">Update now</button></div><div class="about"><p><b>What's new</b></p><ul style="padding-left:1.2rem;line-height:1.7"><li>Publication-date sorting</li><li>Per-LoRA recipe copy and send</li><li>Safer sidecar writes</li></ul></div><div class="srow"><div>Show update notifications</div>${tog('n',true)}</div>`],['msg','Messages',()=>'<div class="issue"><div><b>Welcome</b><small>Nothing new this week.</small></div></div>']],false);
}
function openSupport(){
  modal({title:'Support LoRA Manager',body:`<div class="mbody"><p style="color:var(--text-2)">LoRA Manager is free. If it saves you time, these help most.</p>${['Report an issue on GitHub','Join the Discord','Ko-fi','Patreon','Follow on Civitai','YouTube channel'].map(t=>`<div class="issue"><b>${t}</b>${ico('ext',16)}</div>`).join('')}</div>`});
}
function openSettings(sec='interface'){
  const S=[['general','General'],['interface','Interface'],['library','Library'],['organization','Organization'],['nodes','ComfyUI Nodes'],['about','About']];
  const body={
   general:()=>`<h4>Language and backup</h4>${srow('Language','',sel2(['English','Nederlands','Deutsch','Français','日本語']))}${srow('Back up settings automatically','Keeps the last 5 copies',tog('x',true))}${srow('Portable settings','Store settings next to the plugin',tog('x',false))}<h4>Accounts</h4>${srow('Civitai API key','Needed for early-access downloads','<input type="text" value="••••••••••••" aria-label="Civitai API key">')}${srow('Hugging Face token','','<input type="text" placeholder="Not set">')}<h4>Downloads</h4>${srow('Download backend','',sel2(['Built-in','aria2c']))}${srow('Concurrent downloads','','<input type="text" value="3" style="min-width:5rem">')}${srow('Use a proxy','',tog('x',false))}<h4>AI provider</h4>${srow('Provider','Used to enrich model links',sel2(['None','OpenAI-compatible','Anthropic']))}`,
   interface:()=>`<h4>Appearance</h4>${srow('Text size, theme and highlight colour','Also in the quick panel on the left',`<button class="btn" id="oap">${ico('moon',15)}Open appearance</button>`)}<h4>Cards</h4>${srow('Blur mature content','Hides previews rated at or above your threshold',tog('blur',ST.blur))}${srow('Show only safe-for-work models','',tog('sfw',ST.sfw))}${srow('Cycle through examples on hover','Crossfades the preview after a short pause',tog('cycle',ST.cycle))}${srow('Play videos on hover','',tog('x',true))}${srow('Show version and quantization on cards','',tog('ver',!!V.show.ver))}${srow('Group by model','Collapses versions into one card',tog('grp',V.group==='base'))}${srow('Display density','',sel2(['Compact','Default','Comfortable'],'Default'))}${srow('Card info','',sel2(['Always visible','On hover'],'Always visible'))}${srow('Model name shown','',sel2(['Model name','File name']))}${srow('Footer action','',sel2(['Open examples folder','Replace preview']))}<h4>Sending to ComfyUI</h4>${srow('LoRA syntax','',sel2(['<lora:name:0.8>','Name only']))}${srow('Include trigger words','',tog('x',true))}${srow('Showcase layout','',sel2(['Vertical list','Grid']))}${srow('Sticky toolbar','',tog('x',true))}`,
   library:()=>`<h4>Model folders</h4>${['G:\\ComfyUI\\models\\loras','…\\ComfyUI\\models\\loras','…\\ComfyUI-Shared\\models\\loras'].map((p,k)=>srow(`<span class="mono">${p}</span>`,k===0?'Default root':'',`<button class="btn">${k===0?'Default':'Make default'}</button>`)).join('')}${srow('Extra folders (LoRA Manager only)','Keeps ComfyUI fast with big libraries','<button class="btn">Add folder</button>')}<h4>Pages</h4>${srow('Other models','',tog('other',ST.other))}${srow('Workflows','',tog('workflows',ST.workflows))}${srow('Wildcards','',tog('wildcards',ST.wildcards))}<h4>Metadata</h4>${srow('Providers, in order','Civitai, CivArchive, OpenModelDB','<button class="btn">Reorder</button>')}${srow('Hide paid and early-access updates','',tog('x',true))}${srow('Example images folder','','<input type="text" value="…\\example_images">')}${srow('Sidecar storage','',sel2(['Next to the model','Centralized folder']))}`,
   organization:()=>`<h4>Templates</h4>${srow('Filename template','',sel2(['{model_name}-{version}','Custom…']))}${srow('Download path template','','<input type="text" value="{base_model}/{first_tag}">')}${srow('Priority tags','Decide which tag names the folder','<input type="text" value="character, style, concept">')}${srow('Skip these base models when downloading','','<button class="btn">Choose</button>')}${srow('Auto-organize exclusions','','<button class="btn">Edit</button>')}`,
   nodes:()=>`<h4>ComfyUI nodes</h4>${srow('Node options live in ComfyUI settings','',`<button class="btn">${ico('ext',15)}Open ComfyUI settings</button>`)}`,
   about:()=>`<h4>Environment</h4>${[['LoRA Manager','1.0.0'],['ComfyUI','0.3.x'],['Python','3.13'],['Platform','Windows 11']].map(([a,b])=>srow(a,'',`<span class="mono">${b}</span>`)).join('')}${srow('','',`<button class="btn" id="cenv">${ico('copy',15)}Copy environment</button>`)}`
  };
  const draw=(s)=>modal({title:'Settings',wide:true,body:`<div class="setwrap"><nav class="setnav"><div style="padding:.2rem .3rem .6rem"><input id="sq" placeholder="Search settings" aria-label="Search settings" style="width:100%;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:.4rem .6rem;color:var(--text);font:inherit"></div>${S.map(([k,l])=>`<button data-s="${k}" ${k===s?'aria-current="page"':''}>${l}</button>`).join('')}</nav><div class="setbody" id="setbody">${body[s]()}</div></div>`,mount:h=>{
    h.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>draw(b.dataset.s));
    $('sq').oninput=e=>{const q=e.target.value.toLowerCase();h.querySelectorAll('.srow').forEach(r=>r.hidden=!!q&&!r.textContent.toLowerCase().includes(q))};
    h.querySelectorAll('.sw2').forEach(sw=>sw.onclick=()=>{const on=sw.getAttribute('aria-checked')!=='true';sw.setAttribute('aria-checked',on);const k=sw.dataset.k;
      if(k==='blur')ST.blur=on;if(k==='sfw')ST.sfw=on;if(k==='cycle')ST.cycle=on;if(k==='ver'){V.show.ver=on?1:0;view()}if(k==='grp'){V.group=on?'base':'none';view()}
      if(k==='other'||k==='workflows'||k==='wildcards'){ST[k]=on;buildRail()}render()});
    const oap=$('oap');if(oap)oap.onclick=()=>{closeModal();$('pop').classList.add('open')};
    const ce=$('cenv');if(ce)ce.onclick=say('Environment copied to clipboard');
  }});
  draw(sec);
}

/* ---- progress panel ---- */
let progT=null;
function startProgress(){
  clearInterval(progT);let n=0,paused=false,min=false;const total=LORAS.length;
  const p=$('prog');p.hidden=false;
  const draw=()=>{const l=LORAS[Math.min(n,total-1)];p.className='prog'+(min?' min':'');p.innerHTML=`<header><b>${n>=total?'Example images ready':'Downloading example images'}</b><button class="mini" data-p="pause" title="${paused?'Resume':'Pause'}">${ico(paused?'play':'pause',15)}</button><button class="mini" data-p="stop" title="Stop">${ico('stop',15)}</button><button class="mini" data-p="min" title="Collapse">${ico(min?'down':'collapse',15)}</button></header><div class="pb"><div class="bar2"><i style="width:${n/total*100}%"></i></div><div class="meta2 mono"><span>${n} / ${total}</span><span>${n>=total?'Done':`~${Math.max(1,Math.round((total-n)*.6))} s left`}</span></div><div style="color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n>=total?'0 failed':esc(l.name)}</div></div>`};
  p.onclick=e=>{const b=e.target.closest('[data-p]');if(!b)return;const k=b.dataset.p;if(k==='pause')paused=!paused;if(k==='min')min=!min;if(k==='stop'){clearInterval(progT);p.hidden=true;toast('Stopped');return}draw()};
  progT=setInterval(()=>{if(paused)return;n++;draw();if(n>=total){clearInterval(progT);setTimeout(()=>{p.hidden=true},3000)}},450);draw();
}

/* ---- pages ---- */
function statsHtml(){
  const bases={};LORAS.forEach(l=>bases[l.base]=(bases[l.base]||0)+1);const mx=Math.max(...Object.values(bases));
  return `<div class="mc"><div><span>Total models</span><b>1,185</b></div><div><span>Storage</span><b>212 GB</b></div><div><span>Generations</span><b>8,420</b></div><div><span>Usage rate</span><b>61%</b></div><div><span>LoRAs</span><b>1,102</b></div><div><span>Checkpoints</span><b>23</b></div><div><span>Embeddings</span><b>41</b></div></div>
  <div class="tabsbar" style="position:static;padding:0">${['Overview','Usage','Collection','Storage','Insights'].map((t,k)=>`<button aria-selected="${k===0}">${t}</button>`).join('')}</div>
  <div><h5 style="color:var(--text-3);font-weight:500;margin-bottom:.6rem">Base model distribution</h5><div class="dist">${Object.entries(bases).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div><span>${k}</span><i style="width:${v/mx*100}%"></i><span class="mono">${v*53}</span></div>`).join('')}</div></div>`;
}
const HIDE_ON={recipes:['a-fetch','a-dl','a-upd-w','b-type'],embeddings:['b-type'],statistics:['b-type']};
function setPage(p){
  PAGE=p;ALPHA=null;buildRail();
  ['a-fetch','a-dl','a-upd-w','b-type'].forEach(id=>$(id).hidden=!!(HIDE_ON[p]||[]).includes(id));
  $('a-import').hidden=$('a-batch').hidden=p!=='recipes';
  const st=p==='statistics';
  ['bar','crumbs','alpha','grid','banners'].forEach(id=>{const e=$(id);if(e)e.hidden=st});
  $('stats').hidden=!st;if(st)$('stats').innerHTML=statsHtml();
  $('q').disabled=st;$('q').placeholder=st?'Search is not available here':'Search name, filename, tags';
  $('plabel').textContent=rootName();$('fhead').textContent='Folders';
  tree();crumbs();render();
}

/* ---- keyboard ---- */
document.addEventListener('keydown',e=>{
  const typing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)||document.activeElement.isContentEditable;
  if(e.key==='Escape'){closeMenu();if($('modalHost').firstChild){closeModal();return}closeFly();$('pop').classList.remove('open');if(BULK&&!DET.open)setBulk(false);return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();$('q').focus();return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&!typing){e.preventDefault();setBulk(true,true);return}
  if(typing||e.ctrlKey||e.metaKey||DET.open||$('modalHost').firstChild)return;
  if(e.altKey){const k=e.key.toUpperCase();const m=/^[A-Z]$/.test(k)?k:k==='0'?'#':k==='2'?'@':k==='C'?'漢':null;if(m){e.preventDefault();ALPHA=ALPHA===m?null:m;render()}return}
  if(e.key==='r')$('a-refresh').click();
  else if(e.key==='d')openDownload();
  else if(e.key==='b')setBulk(!BULK);
  else if(e.key==='?')openHelp('keys');
  else if(e.key==='PageDown')$('grid').scrollBy({top:$('grid').clientHeight*.9});
  else if(e.key==='PageUp')$('grid').scrollBy({top:-$('grid').clientHeight*.9});
});

/* ---- grid ---- */
let DRAGN=0;
function rowsNow(){
  let r=LORAS.filter(l=>!DELETED.has(l.i));
  r=r.filter(l=>ST.excl?EXCL.has(l.i):!EXCL.has(l.i));
  if(ST.sfw)r=r.filter(l=>!NSFW.has(l.i));
  if($('a-fav').getAttribute('aria-pressed')==='true')r=r.filter(l=>FAVS.has(l.i));
  if(ST.onlyUpd)r=r.filter(l=>UPD.has(l.i));
  if(TYPE!=='All types')r=r.filter(l=>typeOf(l)===TYPE);
  if(ALPHA)r=r.filter(l=>letterOf(l.name)===ALPHA);
  if(CUSTOM)r=r.filter(CUSTOM.fn);
  if(QUERY){const q=QUERY.toLowerCase();r=r.filter(l=>(SO.filename&&l.file.toLowerCase().includes(q))||(SO.modelname&&l.name.toLowerCase().includes(q))||(SO.tags&&l.tags.join(' ').toLowerCase().includes(q))||(SO.triggerWords&&l.words.join(' ').toLowerCase().includes(q)))}
  const on=g=>[...document.querySelectorAll(`#${g} .opt.on`)].map(o=>o.dataset.f);
  const bs=on('g-base');if(bs.length)r=r.filter(l=>bs.includes(l.base));
  const tg=on('g-tag');if(tg.length)r=r.filter(l=>TAGLOGIC==='all'?tg.every(t=>l.tags.includes(t)):tg.some(t=>l.tags.includes(t)));
  const ty=on('g-type');if(ty.length)r=r.filter(l=>ty.includes(typeOf(l)));
  const [k,d]=SORT.split(':'),dir=d==='asc'?1:-1;
  const key={name:l=>l.name.toLowerCase(),date:l=>l.i,published:l=>(l.i*5)%22,size:l=>l.size,usage:usedOf,random:l=>Math.sin((l.i+1)*SEED*9301)}[k];
  r=[...r].sort((a,b)=>{const x=key(a),y=key(b);return (typeof x==='string'?x.localeCompare(y):x-y)*(k==='random'?1:dir)});
  return r;
}
function item(l){
  const used=usedOf(l),fav=FAVS.has(l.i),upd=UPD.has(l.i),isN=NSFW.has(l.i)&&ST.blur,blur=isN&&!REVEAL.has(l.i);
  const bs=BULK&&SELS.has(l.i),selected=BULK?bs:l.i===sel;
  const vers=l.i%6===0?3:0,quant=l.i%4===1?'FP8':'',hl=l.i%9===5?'HIGH':l.i%9===6?'LOW':'';
  const meta=PAGE==='recipes'?`<span>${l.i%4+2} LoRAs</span><span>${l.i%5===0?'1 missing':'All ready'}</span>`:`<span>${l.size} MB</span><span>${used}× used</span>`;
  if(V.layout==='list')return `<article class="card row" tabindex="0" draggable="true" data-i="${l.i}" aria-selected="${selected}">
    <img class="th" src="${l.src}" alt="" loading="lazy"><div class="nm"><b>${esc(l.name)}</b><span class="mono">${esc(l.file)}</span></div>
    <span>${l.base}</span><span class="mono">${l.size} MB</span><span class="mono">${used}× used</span>
    ${upd?`<span class="upd">${ico('up',12)}Update</span>`:'<span></span>'}<span class="star ${fav?'on':''}">${ico('star',16)}</span></article>`;
  return `<article class="card ${bs?'bsel':''}" tabindex="0" draggable="true" data-i="${l.i}" aria-selected="${selected}">
    <div class="img ${blur?'blur':''}" ${V.ar==='orig'?`style="aspect-ratio:${l.ar}"`:''}><img src="${l.src}" data-i="${l.i}" alt="" loading="lazy">
      ${blur?`<div class="nsfw-ov"><span>Mature content</span><button data-act="show">Show</button></div>`:''}
      <span class="chk">${ico('tick',14)}</span>
      <div class="tagrow"><span class="tag">${l.base}</span>${fav?`<span class="ib2" title="Favorite">${ico('star',12)}</span>`:''}${SKIPR.has(l.i)?`<span class="ib2" title="Skipped in metadata refresh">${ico('ban',13)}</span>`:''}${EXCL.has(l.i)?`<span class="ib2" title="Excluded">${ico('eyeoff',13)}</span>`:''}${isN?`<button class="ib2" data-act="eye" title="Show or hide" style="border:0;cursor:pointer">${ico(REVEAL.has(l.i)?'eyeoff':'eye',13)}</button>`:''}${upd?`<span class="upd">${ico('up',12)}Update</span>`:''}</div>
      <div class="qa"><button data-act="fav" class="${fav?'on':''}" title="Favorite" aria-label="Favorite">${ico('star',16)}</button><button data-act="civitai" title="View on Civitai" aria-label="View on Civitai">${ico('globe',16)}</button><span class="sp"></span><button data-act="send" title="Send to ComfyUI (Shift replaces)" aria-label="Send to ComfyUI">${ico('send',16)}</button><button data-act="copy" title="Copy LoRA syntax" aria-label="Copy LoRA syntax">${ico('copy',16)}</button></div></div>
    <h3>${esc(l.name)}</h3><div class="meta mono">${meta}</div>
    <div class="verrow mono"><span>v${1+l.i%3}.0</span>${quant?`<span class="vb">${quant}</span>`:''}${hl?`<span class="vb">${hl}</span>`:''}${vers?`<a data-act="versions">${vers} versions</a>`:''}</div></article>`;
}
function gridHtml(rows){
  if(V.group==='none')return rows.map(item).join('');
  const key=l=>V.group==='base'?l.base:l.folder.split('/')[0];
  const m=new Map();rows.forEach(l=>{const k=key(l);if(!m.has(k))m.set(k,[]);m.get(k).push(l)});
  return [...m.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>`<div class="gh">${k}<span class="mono">${v.length}</span></div>`+v.map(item).join('')).join('');
}
$('grid').addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b)return;e.stopPropagation();
  const i=+b.closest('.card').dataset.i,l=LORAS[i];
  ({fav:()=>{FAVS.has(i)?FAVS.delete(i):FAVS.add(i);render()},civitai:say('Opening the Civitai page'),send:()=>toast(e.shiftKey?`Replaced in ComfyUI: ${l.name}`:`Added to ComfyUI: ${l.name}`),copy:()=>toast(`Copied <lora:${l.name.slice(0,20)}:0.8>`),eye:()=>{REVEAL.has(i)?REVEAL.delete(i):REVEAL.add(i);render()},show:()=>{REVEAL.add(i);render()},versions:()=>{CUSTOM={label:`Local versions of ${l.name.slice(0,24)}`,fn:x=>x.base===l.base&&x.tags[0]===l.tags[0]};render()}})[b.dataset.act]();
},true);
$('grid').addEventListener('dragstart',e=>{const c=e.target.closest('.card');if(!c)return;const i=+c.dataset.i;DRAGN=BULK&&SELS.has(i)?SELS.size:1;e.dataTransfer.setData('text/plain','lm');c.classList.add('drag')});
$('grid').addEventListener('dragend',e=>{document.querySelectorAll('.drag').forEach(c=>c.classList.remove('drag'));document.querySelectorAll('.dropt').forEach(c=>c.classList.remove('dropt'))});
let cyT=null,cyI=null;
$('grid').addEventListener('mouseover',e=>{
  const im=e.target.closest('.img img');if(!im||!ST.cycle||im.dataset.cy||im.closest('.blur'))return;
  clearTimeout(cyT);const i=+im.dataset.i;
  cyT=setTimeout(()=>{im.dataset.cy='1';let k=0;const set=[LORAS[i],LORAS[(i+3)%LORAS.length],LORAS[(i+7)%LORAS.length]];cyI=setInterval(()=>{k=(k+1)%3;im.style.transition='opacity .25s';im.src=set[k].src},900)},800);
});
$('grid').addEventListener('mouseout',e=>{const im=e.target.closest('.img img');if(!im)return;clearTimeout(cyT);clearInterval(cyI);if(im.dataset.cy){im.src=LORAS[+im.dataset.i].src;delete im.dataset.cy}});

function banners(){
  let h='';
  if(ST.excl)h+=`<div class="banner">${ico('eyeoff',16)}<b>Excluded models</b><span style="color:var(--text-2)">These are hidden from the library.</span><span class="sp"></span><button class="btn" id="bk1">${ico('left',15)}Back</button></div>`;
  if(ST.dup)h+=`<div class="banner">${ico('copy',16)}<b>4 duplicate groups</b><span style="color:var(--text-2)">Same file content in different folders.</span><span class="sp"></span><button class="btn" id="bk2">Keep newest</button><button class="btn" id="bk3" style="color:#ff6b6b">Delete selected</button><button class="btn" id="bk4">Exit</button></div>`;
  $('banners').innerHTML=h;
  if($('bk1'))$('bk1').onclick=()=>{ST.excl=false;render()};
  if($('bk2'))$('bk2').onclick=say('Kept the newest file in each group');
  if($('bk3'))$('bk3').onclick=say('Select files first');
  if($('bk4'))$('bk4').onclick=()=>{ST.dup=false;$('a-dup').setAttribute('aria-pressed','false');render()};
}
function chipsAll(){
  const on=[...document.querySelectorAll('#fly .opt.on')].map(o=>o.dataset.f);
  $('chips').innerHTML=on.map(f=>`<span class="chip" data-f="${esc(f)}">${esc(f)}${ico('x',12)}</span>`).join('')+(CUSTOM?`<span class="chip" data-custom="1">${esc(CUSTOM.label)}${ico('x',12)}</span>`:'');
}
$('chips').onclick=e=>{const c=e.target.closest('.chip');if(!c||!e.target.closest('svg'))return;if(c.dataset.custom){CUSTOM=null;render()}else{document.querySelector(`#fly .opt[data-f="${c.dataset.f}"]`).classList.remove('on');filters()}};

function render(){
  const rows=rowsNow();$('shown').textContent=rows.length;lastRows=rows;
  $('selc').textContent=BULK?SELS.size:(rows.some(l=>l.i===sel)?1:0);
  const g=$('grid');g.classList.toggle('bulk',BULK);
  g.innerHTML=gridHtml(rows)||`<div class="empty" style="grid-column:1/-1"><b style="color:var(--text)">No ${rootName()} match</b><span>Try a different search, or clear the active filters.</span><button class="btn" id="clr2">Clear filters</button></div>`;
  const c2=$('clr2');if(c2)c2.onclick=()=>{QUERY='';$('q').value='';ALPHA=null;CUSTOM=null;$('a-fav').setAttribute('aria-pressed','false');ST.onlyUpd=false;$('a-upd').setAttribute('aria-pressed','false');TYPE='All types';B('b-type','down','All types');document.querySelectorAll('#fly .opt.on').forEach(o=>o.classList.remove('on'));filters()};
  g.querySelectorAll('.card').forEach(c=>{
    const i=+c.dataset.i;
    c.onclick=e=>{
      if(BULK){if(e.shiftKey&&anchor!==null){const a=lastRows.findIndex(x=>x.i===anchor),b=lastRows.findIndex(x=>x.i===i);lastRows.slice(Math.min(a,b),Math.max(a,b)+1).forEach(x=>SELS.add(x.i))}else{SELS.has(i)?SELS.delete(i):SELS.add(i);anchor=i}}
      else sel=i;
      render();
    };
    c.ondblclick=()=>{if(!BULK)openDetail(i)};
    c.onkeydown=e=>{if(e.key==='Enter')BULK?c.click():openDetail(i)};
  });
  const l=LORAS[sel];
  if(l){
    const words=[...new Set(l.words.flatMap(w=>w.split(',')).map(w=>w.trim()).filter(Boolean))].slice(0,6);
    $('insp').innerHTML=`<div class="pv"><img src="${l.src}" alt=""></div><div class="in">
      <div><h2>${esc(l.name)}</h2><div class="fn mono">${esc(l.file)}</div></div>
      <div class="row"><button class="btn primary" id="isend">${ico('send',16)}Send to workflow</button><button class="btn" title="Copy trigger words" id="icopy">${ico('copy',16)}</button><button class="btn" title="Open full details" id="opendet">${ico('ext',16)}</button></div>
      <dl class="kv"><dt>Base model</dt><dd>${l.base}</dd><dt>Folder</dt><dd>${l.folder}</dd><dt>Size</dt><dd class="mono">${l.size} MB</dd>
        <dt>Used</dt><dd class="mono">${usedOf(l)} times</dd><dt>Version</dt><dd>${UPD.has(l.i)?'Update available':'Latest'}</dd></dl>
      <div><div class="label">Trigger words</div>${words.length?`<div class="words">${words.map(w=>`<span class="word">${esc(w)}${ico('copy',13)}</span>`).join('')}</div>`:'<span class="none">None. This LoRA needs no trigger.</span>'}</div>
      <div><div class="label">Tags</div><div class="words">${l.tags.map(t=>`<span class="word">${esc(t)}</span>`).join('')}</div></div>
      <button class="btn" id="opendet2" style="justify-content:center">Open full details</button></div>`;
    $('opendet').onclick=$('opendet2').onclick=()=>openDetail(sel);
    $('isend').onclick=e=>toast(e.shiftKey?`Replaced in ComfyUI: ${l.name}`:`Added to ComfyUI: ${l.name}`);
    $('icopy').onclick=say('Trigger words copied');
  }else $('insp').innerHTML='<div class="in"><span class="none">Select a model to see its details.</span></div>';
  chipsAll();alpha();bulkBar();banners();
  const hasF=document.querySelectorAll('#fly .opt.on').length+(CUSTOM?1:0);
}

/* ---- init ---- */
buildRail();applyTheme(false);tree();
window.__ready=true;
