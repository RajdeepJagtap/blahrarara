/* =====================================================================
   files-view.js — makes Subjects/Decks look and behave like the iPad Files app.
   Round 1: icon grid, top bar (back/forward, title, Recents|Browse, "..."),
            sidebar (Recents, Favourites, On My iPad, Tags), tags, long-press menu.
   Load AFTER the main <script> block in index.html.
   It replaces renderHome() and renderSubject(); the deck page, quiz, editor,
   import, settings etc. are unchanged. New optional fields on subjects/decks:
   tags:[...], favorite:true  (old saved data stays valid).
   ===================================================================== */
(function(){
'use strict';

const TAGS = [
  { n:'Red', c:'#ff453a' }, { n:'Orange', c:'#ff9f0a' }, { n:'Yellow', c:'#ffd60a' }, { n:'Green', c:'#30d158' },
  { n:'Blue', c:'#0a84ff' }, { n:'Purple', c:'#bf5af2' }, { n:'Grey', c:'#aeaeb2' },
  { n:'Work' }, { n:'Home' }, { n:'Important' }
];
const FV = { special:null, back:[], fwd:[], lastBrowse:null, open:{ fav:true, loc:true, tags:true }, tagTarget:null, suppress:false };
const esc = s => escapeHtml(s);

/* ---------- styles ---------- */
const st = document.createElement('style');
st.textContent = `
:root{--fv-blue:#0a84ff;--fv-glass:rgba(255,255,255,.72);}
:root[data-theme="dark"]{--fv-blue:#64d2ff;--fv-glass:rgba(44,46,50,.82);}
.app:has(.fv){max-width:100%;}
.fv{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Public Sans',sans-serif;display:flex;flex-direction:column;min-height:calc(100vh - 110px);-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;}
.fv-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:22px;}
.fv-pill{display:flex;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:3px;}
.fv-pill button{height:36px;min-width:40px;padding:0 14px;border-radius:18px;font-size:15px;font-weight:600;color:var(--ink);}
.fv-pill button.on{background:rgba(120,130,150,.28);color:var(--fv-blue);}
.fv-pill button:disabled{opacity:.3;}
.fv-nb{font-size:26px!important;line-height:1;padding:0 12px!important;}
.fv-title{font-size:19px;font-weight:700;color:var(--ink);padding:6px 4px;}
.fv-chev{color:var(--ink-soft);font-size:14px;}
.fv-spacer{flex:1;}
.fv-circle{width:42px;height:42px;border-radius:50%;background:var(--card);border:1px solid var(--line);font-size:15px;font-weight:700;color:var(--ink);letter-spacing:1px;}
.fv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:26px 12px;align-items:start;}
.fv-item{display:flex;flex-direction:column;align-items:center;text-align:center;padding:6px 4px;border-radius:12px;cursor:pointer;outline:none;}
.fv-item:active,.fv-item:focus-visible{background:rgba(120,130,150,.22);}
.fv-folder{width:96px;height:74px;margin:6px 0 8px;}
.fv-page{width:72px;height:92px;margin:2px 0 8px;background:var(--card);border:1px solid var(--line);border-radius:5px;box-shadow:var(--shadow);padding:7px 6px;overflow:hidden;text-align:left;}
.fv-page span{display:block;font-size:6.5px;line-height:1.35;color:var(--ink-soft);word-break:break-word;}
.fv-name{font-size:13px;font-weight:600;line-height:1.25;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;max-width:100%;}
.fv-sub{font-size:11px;line-height:1.35;color:var(--ink-soft);margin-top:2px;}
.fv-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-left:4px;vertical-align:middle;}
.fv-dot.hollow{border:1.5px solid var(--ink-soft);}
.fv-count{margin-top:auto;padding-top:34px;text-align:center;font-size:13px;font-weight:700;color:var(--ink-soft);}
#fvLayer{position:relative;z-index:80;}
.fv-backdrop{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.18);}
.fv-menu{position:fixed;z-index:81;min-width:210px;background:var(--fv-glass);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);border:1px solid var(--line);border-radius:16px;padding:6px;box-shadow:0 14px 40px rgba(0,0,0,.35);}
.fv-mi{display:block;width:100%;text-align:left;padding:11px 14px;border-radius:10px;font-size:15px;color:var(--ink);}
.fv-mi:active{background:rgba(120,130,150,.25);}
.fv-mi.danger{color:var(--coral);}
.fv-sep{height:1px;background:var(--line);margin:5px 8px;}
.fv-side{position:fixed;z-index:81;left:12px;top:12px;bottom:12px;width:min(300px,86vw);overflow-y:auto;background:var(--fv-glass);-webkit-backdrop-filter:blur(26px);backdrop-filter:blur(26px);border:1px solid var(--line);border-radius:24px;padding:14px 10px;box-shadow:0 18px 50px rgba(0,0,0,.4);}
.fv-srow{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:11px 12px;border-radius:12px;font-size:16px;font-weight:500;color:var(--ink);}
.fv-srow.on{background:rgba(120,130,150,.3);color:var(--fv-blue);}
.fv-srow svg{width:22px;height:22px;flex-shrink:0;}
.fv-srow .fv-dot{width:14px;height:14px;margin:0 4px;flex-shrink:0;}
.fv-sechd{display:flex;justify-content:space-between;width:100%;padding:16px 12px 6px;font-size:16px;font-weight:700;color:var(--ink);}
.fv-sechd span{color:var(--ink-soft);}
.fv-tagrow{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--line);font-size:15px;cursor:pointer;}
.fv-tagrow .fv-dot{width:14px;height:14px;margin:0;}
.fv-check{margin-left:auto;color:var(--fv-blue);font-weight:700;}`;
document.head.appendChild(st);

/* ---------- icons ---------- */
const FOLDER_SVG = '<svg class="fv-folder" viewBox="0 0 120 92"><defs><linearGradient id="fvg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ADCF7"/><stop offset="1" stop-color="#68C0EC"/></linearGradient></defs><path d="M6 16a9 9 0 0 1 9-9h27l11 11h52a9 9 0 0 1 9 9v10H6z" fill="#52B2E4"/><rect x="3" y="24" width="114" height="62" rx="10" fill="url(#fvg)"/></svg>';
const I_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const I_PAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2.5" width="14" height="19" rx="3"/><path d="M10 18.5h4"/></svg>';
const I_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const I_DECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></svg>';
const I_SIDE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>';
const dotHtml = t => '<span class="fv-dot'+(t.c ? '' : ' hollow')+'"'+(t.c ? ' style="background:'+t.c+'"' : '')+'></span>';
const dots = o => (o.tags || []).map(n=>TAGS.find(t=>t.n === n)).filter(Boolean).map(dotHtml).join('');

/* ---------- navigation (history + current location) ---------- */
function curLoc(){
  if(VIEW.screen === 'subject') return { t:'sub', id: VIEW.subjectId };
  return FV.special ? Object.assign({}, FV.special) : { t:'root' };
}
function applyLoc(l){
  FV.special = null;
  if(l.t === 'sub' && STATE.subjects[l.id]) VIEW = { screen:'subject', subjectId:l.id };
  else if(l.t === 'recents' || l.t === 'tag'){ VIEW = { screen:'home' }; FV.special = l; }
  else VIEW = { screen:'home' };
}
function go(l, noPush){
  closeLayer();
  if(!noPush){
    if(JSON.stringify(l) === JSON.stringify(curLoc())) return;
    FV.back.push(curLoc()); FV.fwd = [];
  }
  applyLoc(l); render();
}
function goBack(){
  if(FV.back.length){ const p = FV.back.pop(); FV.fwd.push(curLoc()); applyLoc(p); render(); return; }
  const l = curLoc();
  if(l.t === 'sub'){ const par = STATE.subjects[l.id].parentId; go(par ? { t:'sub', id:par } : { t:'root' }); }
}
function goFwd(){ if(FV.fwd.length){ const n = FV.fwd.pop(); FV.back.push(curLoc()); applyLoc(n); render(); } }
function openDeck(id){ FV.special = null; VIEW = { screen:'deck', deckId:id }; render(); }

/* ---------- formatting ---------- */
function fmtWhen(ts){
  if(!ts) return '';
  return new Date(ts).toLocaleString('en-GB', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'numeric', minute:'2-digit', hour12:true })
    .replace(/\b(am|pm)\b/, m=>m.toUpperCase());
}
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity:'base' });
const plural = (n, w) => n+' '+w+(n === 1 ? '' : 's');

/* ---------- screen pieces ---------- */
function folderItem(s){
  const n = (s.subjectIds || []).length + (s.deckIds || []).length;
  return '<div class="fv-item" tabindex="0" data-fv-item="s:'+s.id+'" data-fv-action="open-sub" data-fv-id="'+s.id+'">'+FOLDER_SVG
    + '<div class="fv-name">'+esc(s.name)+dots(s)+'</div><div class="fv-sub">'+plural(n, 'item')+'</div></div>';
}
function deckItem(d){
  const first = d.cards[0], snip = first && first.q && first.q.text ? first.q.text.slice(0, 80) : '';
  return '<div class="fv-item" tabindex="0" data-fv-item="d:'+d.id+'" data-fv-action="open-deck" data-fv-id="'+d.id+'">'
    + '<div class="fv-page"><span>'+esc(snip)+'</span></div>'
    + '<div class="fv-name">'+esc(d.name)+dots(d)+'</div>'
    + '<div class="fv-sub">'+esc(fmtWhen(d.lastStudyDate || d.createdAt))+'<br>'+plural(d.cards.length, 'card')+'</div></div>';
}
function gridHtml(items, emptyMsg){
  return items.length ? '<div class="fv-grid">'+items.join('')+'</div>' : '<div class="empty-state"><h3>'+emptyMsg+'</h3></div>';
}
function dashHtml(){
  const t = Stats.sumLastNDays(STATE.activity, 1), w = Stats.sumLastNDays(STATE.activity, 7), m = Stats.sumLastNDays(STATE.activity, 30), s = Stats.streak(STATE.activity);
  return '<div class="dash-grid"><div class="dash-box"><div class="n">'+t+'</div><div class="l">Today</div></div><div class="dash-box"><div class="n">'+w+'</div><div class="l">Last 7 days</div></div>'
    + '<div class="dash-box"><div class="n">'+m+'</div><div class="l">Last 30 days</div></div><div class="dash-box streak"><div class="n">'+s+'🔥</div><div class="l">Day streak</div></div></div>'+renderHeatmap(STATE.activity);
}
function barHtml(loc, title){
  const canBack = FV.back.length > 0 || loc.t === 'sub', canFwd = FV.fwd.length > 0;
  const inRec = loc.t === 'recents', inBrowse = loc.t === 'root' || loc.t === 'sub';
  return '<div class="fv-bar"><div class="fv-pill">'
    + '<button type="button" class="fv-nb" data-fv-action="back" aria-label="Back"'+(canBack ? '' : ' disabled')+'>‹</button>'
    + '<button type="button" class="fv-nb" data-fv-action="fwd" aria-label="Forward"'+(canFwd ? '' : ' disabled')+'>›</button></div>'
    + '<button type="button" class="fv-title" data-fv-action="path">'+esc(title)+(loc.t === 'sub' ? ' <span class="fv-chev">⌄</span>' : '')+'</button>'
    + '<div class="fv-spacer"></div><div class="fv-pill">'
    + '<button type="button" data-fv-action="sidebar" aria-label="Sidebar">'+I_SIDE+'</button>'
    + '<button type="button" class="'+(inRec ? 'on' : '')+'" data-fv-action="go-recents">Recents</button>'
    + '<button type="button" class="'+(inBrowse ? 'on' : '')+'" data-fv-action="go-browse">Browse</button></div>'
    + '<button type="button" class="fv-circle" data-fv-action="more" aria-label="More">•••</button></div>';
}
function shell(){
  const loc = curLoc();
  let title, body, n;
  if(loc.t === 'recents'){
    title = 'Recents';
    const decks = Object.values(STATE.decks).sort((a, b)=>(b.lastStudyDate || b.createdAt || 0) - (a.lastStudyDate || a.createdAt || 0)).slice(0, 30);
    body = dashHtml()+gridHtml(decks.map(deckItem), 'No decks yet'); n = decks.length;
  } else if(loc.t === 'tag'){
    title = loc.tag;
    const subs = Object.values(STATE.subjects).filter(s=>(s.tags || []).includes(loc.tag)).sort(byName);
    const decks = Object.values(STATE.decks).filter(d=>(d.tags || []).includes(loc.tag)).sort(byName);
    body = gridHtml(subs.map(folderItem).concat(decks.map(deckItem)), 'Nothing is tagged “'+esc(loc.tag)+'” yet'); n = subs.length + decks.length;
  } else {
    FV.lastBrowse = loc;
    const sub = loc.t === 'sub' ? STATE.subjects[loc.id] : null;
    title = sub ? sub.name : 'On My iPad';
    const subs = (sub ? childSubjectList(sub.id) : subjectList()).slice().sort(byName);
    const decks = sub ? subjectDeckList(sub.id).slice().sort(byName) : [];
    body = gridHtml(subs.map(folderItem).concat(decks.map(deckItem)), sub ? 'This folder is empty' : 'No folders yet — tap ••• to add one');
    n = subs.length + decks.length;
  }
  return '<div class="fv">'+barHtml(loc, title)+body+'<div class="fv-count">'+plural(n, 'item')+'</div></div>';
}
window.renderHome = function(){ return shell(); };
window.renderSubject = function(){
  if(!STATE.subjects[VIEW.subjectId]) VIEW = { screen:'home' };
  return shell();
};

/* ---------- floating layer: menus + sidebar ---------- */
function layer(){
  let l = document.getElementById('fvLayer');
  if(!l){ l = document.createElement('div'); l.id = 'fvLayer'; document.body.appendChild(l); }
  return l;
}
function closeLayer(){ const l = document.getElementById('fvLayer'); if(l) l.innerHTML = ''; }
function showMenu(items, x, y){
  layer().innerHTML = '<div class="fv-backdrop" data-fv-action="close"></div><div class="fv-menu" id="fvMenu">'
    + items.map(i=>i.sep ? '<div class="fv-sep"></div>'
      : '<button type="button" class="fv-mi'+(i.danger ? ' danger' : '')+'" data-fv-action="'+i.a+'"'+(i.t ? ' data-fv-target="'+i.t+'"' : '')+(i.id ? ' data-fv-id="'+i.id+'"' : '')+'>'+i.l+'</button>').join('')
    + '</div>';
  const m = document.getElementById('fvMenu'), r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8))+'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8))+'px';
}
function itemMenu(t){
  const [k, id] = t.split(':'), o = k === 's' ? STATE.subjects[id] : STATE.decks[id];
  if(!o) return [];
  const it = [{ l: k === 's' ? 'Open' : 'Study', a:'m-open', t }, { l:'Rename', a:'m-rename', t }];
  if(k === 'd') it.push({ l:'Duplicate', a:'m-dup', t }, { l:'Export to Anki', a:'m-export', t });
  it.push({ l: o.favorite ? 'Remove from Favourites' : 'Add to Favourites', a:'m-fav', t }, { l:'Tags…', a:'m-tags', t }, { sep:1 }, { l:'Delete', a:'m-delete', t, danger:1 });
  return it;
}
function sideHtml(){
  const loc = curLoc();
  const favs = Object.values(STATE.subjects).filter(s=>s.favorite).sort(byName).map(s=>({ k:'s', o:s }))
    .concat(Object.values(STATE.decks).filter(d=>d.favorite).sort(byName).map(d=>({ k:'d', o:d })));
  const sec = (title, key, inner) => '<div><button type="button" class="fv-sechd" data-fv-action="toggle-sec" data-fv-sec="'+key+'">'+title+'<span>'+(FV.open[key] ? '⌄' : '›')+'</span></button>'+(FV.open[key] ? inner : '')+'</div>';
  const row = (icon, label, a, on, extra) => '<button type="button" class="fv-srow'+(on ? ' on' : '')+'" data-fv-action="'+a+'" '+(extra || '')+'>'+icon+'<span>'+label+'</span></button>';
  return '<div class="fv-backdrop" data-fv-action="close"></div><aside class="fv-side">'
    + row(I_CLOCK, 'Recents', 'go-recents', loc.t === 'recents')
    + sec('Favourites', 'fav', favs.map(f=>row(f.k === 's' ? I_FOLDER : I_DECK, esc(f.o.name), 'fav-open', false, 'data-fv-target="'+f.k+':'+f.o.id+'"')).join(''))
    + sec('Locations', 'loc', row(I_PAD, 'On My iPad', 'go-root', loc.t === 'root' || loc.t === 'sub'))
    + sec('Tags', 'tags', TAGS.map(t=>row(dotHtml(t), t.n, 'go-tag', loc.t === 'tag' && loc.tag === t.n, 'data-fv-tag="'+t.n+'"')).join(''))
    + '</aside>';
}
function openTagsModal(t){
  FV.tagTarget = t;
  const [k, id] = t.split(':'), o = k === 's' ? STATE.subjects[id] : STATE.decks[id];
  openModal({
    title: 'Tags — '+esc(o.name),
    body: TAGS.map(g=>'<div class="fv-tagrow" data-fv-tag-toggle="'+g.n+'">'+dotHtml(g)+'<span>'+g.n+'</span><span class="fv-check">'+((o.tags || []).includes(g.n) ? '✓' : '')+'</span></div>').join(''),
    actions: [{ label:'Done', className:'btn-primary', onClick: closeModal }]
  });
}
function toggleTag(el){
  const [k, id] = FV.tagTarget.split(':'), o = k === 's' ? STATE.subjects[id] : STATE.decks[id];
  if(!o) return;
  o.tags = o.tags || [];
  const n = el.dataset.fvTagToggle, i = o.tags.indexOf(n);
  if(i < 0) o.tags.push(n); else o.tags.splice(i, 1);
  persist(); el.querySelector('.fv-check').textContent = i < 0 ? '✓' : '';
  render();
}

/* ---------- actions ---------- */
function act(a, el){
  const loc = curLoc(), t = el.dataset.fvTarget;
  const obj = t ? (t[0] === 's' ? STATE.subjects[t.slice(2)] : STATE.decks[t.slice(2)]) : null;
  const rect = el.getBoundingClientRect();
  switch(a){
    case 'close': closeLayer(); break;
    case 'open-sub': go({ t:'sub', id: el.dataset.fvId }); break;
    case 'open-deck': openDeck(el.dataset.fvId); break;
    case 'back': goBack(); break;
    case 'fwd': goFwd(); break;
    case 'go-recents': go({ t:'recents' }); break;
    case 'go-browse': go(FV.lastBrowse || { t:'root' }); break;
    case 'go-root': go({ t:'root' }); break;
    case 'go-sub': go({ t:'sub', id: el.dataset.fvId }); break;
    case 'go-tag': go({ t:'tag', tag: el.dataset.fvTag }); break;
    case 'fav-open': closeLayer(); if(t[0] === 's') go({ t:'sub', id:t.slice(2) }); else openDeck(t.slice(2)); break;
    case 'sidebar': layer().innerHTML = sideHtml(); break;
    case 'toggle-sec': FV.open[el.dataset.fvSec] = !FV.open[el.dataset.fvSec]; layer().innerHTML = sideHtml(); break;
    case 'path': {
      if(loc.t !== 'sub') break;
      const chain = []; let c = STATE.subjects[loc.id];
      while(c){ chain.unshift(c); c = c.parentId ? STATE.subjects[c.parentId] : null; }
      showMenu([{ l:'On My iPad', a:'go-root' }].concat(chain.slice(0, -1).map(s=>({ l:esc(s.name), a:'go-sub', id:s.id }))), rect.left, rect.bottom + 6);
      break;
    }
    case 'more': {
      const items = [{ l:'New Folder', a:'m-newfolder' }];
      if(loc.t === 'sub') items.push({ l:'New Deck', a:'m-newdeck' });
      items.push({ sep:1 }, { l:'Settings', a:'m-settings' }, { l:'Theme: '+Theme.icon(), a:'m-theme' });
      showMenu(items, rect.right - 210, rect.bottom + 6);
      break;
    }
    case 'm-newfolder': closeLayer(); newSubjectModal(loc.t === 'sub' ? loc.id : undefined); break;
    case 'm-newdeck': closeLayer(); pendingParse = { cards:[], errors:[], warnings:[], raw:'' }; VIEW = { screen:'new-deck', subjectId: loc.id }; render(); break;
    case 'm-settings': closeLayer(); VIEW = { screen:'settings' }; render(); break;
    case 'm-theme': Theme.cycle(); render(); break;
    case 'm-open': closeLayer(); if(t[0] === 's') go({ t:'sub', id:t.slice(2) }); else openDeck(t.slice(2)); break;
    case 'm-rename': closeLayer(); if(t[0] === 's') renameSubjectModal(t.slice(2)); else renameDeckModal(t.slice(2)); break;
    case 'm-dup': closeLayer(); Decks.duplicate(t.slice(2)); showToast('Deck duplicated'); render(); break;
    case 'm-export': closeLayer(); Decks.exportToAnki(t.slice(2)); break;
    case 'm-fav': if(obj){ obj.favorite = !obj.favorite; persist(); } closeLayer(); render(); break;
    case 'm-tags': closeLayer(); openTagsModal(t); break;
    case 'm-delete': closeLayer(); if(t[0] === 's') confirmSubjectDelete(t.slice(2)); else confirmDeckDelete(t.slice(2)); break;
  }
}
document.addEventListener('click', e=>{
  if(FV.suppress){ e.preventDefault(); e.stopPropagation(); return; }       // the tap that ends a long-press
  const tg = e.target.closest && e.target.closest('[data-fv-tag-toggle]');
  if(tg){ toggleTag(tg); return; }
  const el = e.target.closest && e.target.closest('[data-fv-action]');
  if(el) act(el.dataset.fvAction, el);
});
document.addEventListener('keydown', e=>{
  if(e.key === 'Enter' && e.target.matches && e.target.matches('[data-fv-item]')) e.target.click();
});

/* ---------- long-press (touch) / right-click (mouse) menu ---------- */
let lp = null;
document.addEventListener('touchstart', e=>{
  const it = e.target.closest && e.target.closest('[data-fv-item]');
  if(!it || e.touches.length !== 1) return;
  const x = e.touches[0].clientX, y = e.touches[0].clientY, target = it.dataset.fvItem;
  lp = { x, y, timer: setTimeout(()=>{
    lp = null; FV.suppress = true; setTimeout(()=>{ FV.suppress = false; }, 700);
    showMenu(itemMenu(target), x, y);
  }, 450) };
}, { passive:true });
document.addEventListener('touchmove', e=>{
  if(!lp) return;
  const t = e.touches[0];
  if(Math.abs(t.clientX - lp.x) > 10 || Math.abs(t.clientY - lp.y) > 10){ clearTimeout(lp.timer); lp = null; }
}, { passive:true });
['touchend', 'touchcancel'].forEach(ev=>document.addEventListener(ev, ()=>{ if(lp){ clearTimeout(lp.timer); lp = null; } }));
document.addEventListener('contextmenu', e=>{
  const it = e.target.closest && e.target.closest('[data-fv-item]');
  if(it){ e.preventDefault(); showMenu(itemMenu(it.dataset.fvItem), e.clientX, e.clientY); }
});

/* ---------- hook into render ---------- */
const prevRender = window.render;
window.render = function(){ closeLayer(); prevRender(); };

})();
