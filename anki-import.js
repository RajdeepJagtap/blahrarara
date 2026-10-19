/* =====================================================================
   anki-import.js — adds Anki .apkg import (text + images + AUDIO) to Card Index.
   Load it AFTER the main <script> block in index.html. The .docx and paste
   paths are untouched: this file only wraps/overrides a few functions.
   ===================================================================== */
(function(){
'use strict';

/* ---------- styles for audio buttons ---------- */
const st = document.createElement('style');
st.textContent = `.audio-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;}
.audio-btn{font-family:'IBM Plex Mono',monospace;font-size:12px;padding:7px 12px;border-radius:20px;border:1.5px solid var(--teal);color:var(--teal);background:transparent;}
.audio-btn:hover,.audio-btn.playing{background:var(--teal);color:#fdfdf9;}`;
document.head.appendChild(st);

/* ---------- lazy library loading (JSZip + sql.js from cdnjs) ---------- */
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
const loadScript = src => new Promise((res, rej)=>{
  const s = document.createElement('script');
  s.src = src; s.onload = res; s.onerror = ()=>rej(new Error('Could not load '+src));
  document.head.appendChild(s);
});
let libsP = null;
function loadLibs(){
  if(!libsP) libsP = (async()=>{
    if(!window.JSZip) await loadScript(CDN+'jszip/3.10.1/jszip.min.js');
    if(!window.initSqlJs) await loadScript(CDN+'sql.js/1.8.0/sql-wasm.js');
    return window.initSqlJs({ locateFile: f => CDN+'sql.js/1.8.0/'+f });
  })().catch(e=>{ libsP = null; throw e; });
  return libsP;
}

/* ---------- MEDIA STORE: audio lives in its own IndexedDB, not in the big state JSON ---------- */
const MediaStore = (function(){
  let dbP = null;
  const open = () => dbP || (dbP = new Promise((res, rej)=>{
    const r = indexedDB.open('qa-anki-media', 1);
    r.onupgradeneeded = ()=>r.result.createObjectStore('blobs');
    r.onsuccess = ()=>res(r.result);
    r.onerror = ()=>rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej)=>{
      const t = db.transaction('blobs', mode);
      const q = fn(t.objectStore('blobs'));
      t.oncomplete = ()=>res(q && q.result);
      t.onerror = ()=>rej(t.error);
    });
  };
  return {
    put: (id, buf, type) => tx('readwrite', s=>s.put({ buf, type }, id)),
    get: id => tx('readonly', s=>s.get(id)),
    del: id => tx('readwrite', s=>s.delete(id)),
    keys: () => tx('readonly', s=>s.getAllKeys())
  };
})();

/* ---------- AUDIO PLAYBACK ---------- */
const player = new Audio();
const urls = new Map();            // media id -> object URL (cached so play() runs inside the tap gesture on iOS)
let playingId = null, playingBtn = null;
function stopAudio(){
  player.pause();
  if(playingBtn) playingBtn.classList.remove('playing');
  playingId = null; playingBtn = null;
}
player.addEventListener('ended', stopAudio);
async function ensureUrl(id){
  let u = urls.get(id);
  if(u) return u;
  const rec = await MediaStore.get(id);
  if(!rec) return null;
  u = URL.createObjectURL(new Blob([rec.buf], { type: rec.type }));
  urls.set(id, u);
  return u;
}
function startAudio(id, btn, url){
  stopAudio();
  playingId = id; playingBtn = btn; btn.classList.add('playing');
  player.src = url;
  player.play().catch(()=>{ stopAudio(); showToast('Could not play audio'); });
}
document.addEventListener('click', e=>{
  const b = e.target.closest && e.target.closest('.audio-btn');
  if(!b) return;
  e.stopPropagation();
  const id = b.dataset.audio;
  if(playingId === id){ stopAudio(); return; }
  const u = urls.get(id);
  if(u) startAudio(id, b, u);
  else ensureUrl(id).then(x => x ? startAudio(id, b, x) : showToast('Audio file missing'));
});
function preloadAudio(){ document.querySelectorAll('.audio-btn').forEach(b=>ensureUrl(b.dataset.audio)); }

/* ---------- Don't let taps on audio buttons flip / drag the card ---------- */
['onTouchStart', 'onDown'].forEach(k=>{
  const orig = Gestures[k];
  Gestures[k] = function(e){
    if(e.target.closest && e.target.closest('.audio-btn')) return;
    return orig.call(this, e);
  };
});

/* ---------- REPLACED: card side renderer (adds bold markers + audio buttons) ---------- */
window.cardSideHtml = function(side){
  const txt = escapeHtml(side.text || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const imgs = (side.images || []).map(src=>`<img class="card-img" src="${src}">`).join('');
  const aud = (side.audio || []).length
    ? `<div class="audio-row">${side.audio.map(a=>`<button type="button" class="audio-btn" data-audio="${a.id}">▶ ${escapeHtml(a.label || 'Audio')}</button>`).join('')}</div>`
    : '';
  return `<div>${txt}</div>${imgs}${aud}`;
};

/* ---------- Keep audio when an imported card is edited ---------- */
const origUpdateCard = Decks.updateCard;
Decks.updateCard = function(deckId, cardId, q, a){
  const c = STATE.decks[deckId].cards.find(x=>x.id===cardId);
  if(c){ q.audio = (c.q && c.q.audio) || []; a.audio = (c.a && c.a.audio) || []; }
  return origUpdateCard.call(Decks, deckId, cardId, q, a);
};

/* ---------- Clean up audio blobs nobody references any more ---------- */
let importing = false;
async function gcMedia(){
  if(importing) return;
  const used = new Set();
  const scan = cs => cs.forEach(c=>[c.q, c.a].forEach(s=>((s && s.audio) || []).forEach(x=>used.add(x.id))));
  Object.values(STATE.decks).forEach(d=>scan(d.cards));
  scan(pendingParse.cards || []);
  for(const k of await MediaStore.keys()){
    if(!used.has(k)){
      await MediaStore.del(k);
      const u = urls.get(k); if(u){ URL.revokeObjectURL(u); urls.delete(k); }
    }
  }
}
['remove', 'removeCard'].forEach(fn=>{
  const o = Decks[fn];
  Decks[fn] = function(){ const r = o.apply(Decks, arguments); gcMedia().catch(()=>{}); return r; };
});
const origSubjRemove = Subjects.remove;
Subjects.remove = function(id){ const r = origSubjRemove.call(Subjects, id); gcMedia().catch(()=>{}); return r; };

/* ---------- Helpers: mime sniffing, HTML -> text, template parsing, cloze ---------- */
const dec = s => { s = s.replace(/&amp;/g, '&'); try{ return decodeURIComponent(s); }catch(e){ return s; } };
function sniff(u8, name){
  const ext = ((name.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
  const m = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml',
    mp3:'audio/mpeg', m4a:'audio/mp4', mp4:'audio/mp4', ogg:'audio/ogg', oga:'audio/ogg', opus:'audio/ogg', wav:'audio/wav', flac:'audio/flac', aac:'audio/aac', webm:'audio/webm' };
  if(m[ext]) return m[ext];
  const s = (a, b) => String.fromCharCode.apply(null, Array.from(u8.slice(a, b)));
  if(u8[0] === 0xFF && u8[1] === 0xD8) return 'image/jpeg';
  if(s(1, 4) === 'PNG') return 'image/png';
  if(s(0, 3) === 'GIF') return 'image/gif';
  if(s(0, 4) === 'RIFF') return s(8, 12) === 'WEBP' ? 'image/webp' : 'audio/wav';
  if(s(4, 8) === 'ftyp') return 'audio/mp4';
  if(s(0, 4) === 'OggS') return 'audio/ogg';
  if(s(0, 4) === 'fLaC') return 'audio/flac';
  if(s(0, 3) === 'ID3' || (u8[0] === 0xFF && (u8[1] & 0xE0) === 0xE0)) return 'audio/mpeg';
  return null;
}
function htmlToText(html){
  const h = html
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(t|b|strong)(\s[^>]*)?>/gi, '**')           // Migaku <t> target word + bold -> **bold**
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ');
  const t = new DOMParser().parseFromString(h, 'text/html').body.textContent || '';
  return t.replace(/`([^`\n]+)`/g, '**$1**').replace(/\*\*\s*\*\*/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function tmplFields(fmt, names){
  const out = [];
  for(const m of fmt.matchAll(/\{\{([^}]+)\}\}/g)){
    let t = m[1].trim();
    if(/^[#^\/]/.test(t)) continue;
    t = t.split(':').pop().trim();
    if(names.includes(t) && !out.includes(t)) out.push(t);
  }
  return out;
}
const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
const clozeText = (txt, n, reveal) => txt.replace(CLOZE_RE, (m, k, ans, hint)=> +k === n ? (reveal ? '**'+ans+'**' : '['+(hint || '...')+']') : ans);
const audioLabel = f => f.replace(/\s*audio\s*$/i, '').trim();

/* ---------- THE IMPORTER ---------- */
async function importApkg(file, preZip){
  importing = true;
  const base = file.name.replace(/\.(zip|colpkg)$/i, '').replace(/\.apkg$/i, '');
  const fail = msg => { pendingParse = { cards:[], errors:[msg], warnings:[], raw: pendingParse.raw }; render(); };
  try{
    showToast('Reading Anki package…');
    const SQL = await loadLibs();
    const zip = preZip || await JSZip.loadAsync(file);
    const dbFile = zip.file('collection.anki21') || zip.file('collection.anki2');
    if(!dbFile) return fail(zip.file('collection.anki21b')
      ? 'This package uses Anki\'s newest format. Re-export it from Anki with "Support older Anki versions" ticked, then try again.'
      : 'No Anki collection was found inside this file.');
    const db = new SQL.Database(await dbFile.async('uint8array'));
    const colRow = db.exec('select models, decks from col')[0].values[0];
    const models = JSON.parse(colRow[0]), ankiDecks = JSON.parse(colRow[1]);
    const notes = {};
    ((db.exec('select id, mid, flds from notes')[0] || { values:[] }).values).forEach(r=>{ notes[r[0]] = r; });
    const cardRows = (db.exec('select nid, did, ord from cards order by id')[0] || { values:[] }).values;
    db.close();
    if(!Object.keys(models).length) return fail('Could not read note types from this package. Try re-exporting with "Support older Anki versions" ticked.');

    let mediaMap = {};
    try{ mediaMap = JSON.parse(await zip.file('media').async('string')); }catch(e){}
    const byName = {}; Object.entries(mediaMap).forEach(([k, n])=>{ byName[n] = k; });
    const getBytes = async name => {
      const key = byName[name] !== undefined ? byName[name] : byName[dec(name)];
      const f = key !== undefined && zip.file(key);
      return f ? f.async('uint8array') : null;
    };
    const imgCache = Object.create(null), audCache = Object.create(null);
    let nImg = 0, nAud = 0, missing = 0, skipped = 0;
    const getImage = async name => {
      if(name in imgCache) return imgCache[name];
      let out = null;
      const u8 = await getBytes(name);
      if(u8){
        const type = sniff(u8, name) || 'image/jpeg';
        const blob = new Blob([u8], { type });
        try{ out = await compressImageFile(new File([blob], 'i', { type }), 900, 0.8); }
        catch(e){ out = await new Promise(r=>{ const fr = new FileReader(); fr.onload = ()=>r(fr.result); fr.readAsDataURL(blob); }); }
        nImg++;
      } else missing++;
      return (imgCache[name] = out);
    };
    const getAudio = async name => {
      if(name in audCache) return audCache[name];
      let id = null;
      const u8 = await getBytes(name);
      if(u8){
        id = uid();
        await MediaStore.put(id, u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), sniff(u8, name) || 'audio/mpeg');
        nAud++;
      } else missing++;
      return (audCache[name] = id);
    };
    const mkSide = async parts => {
      const texts = [], images = [], audio = [];
      for(const [label, html] of parts){
        const t = htmlToText(html); if(t) texts.push(t);
        for(const m of html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/gi)){
          if(/^(https?:|data:)/i.test(m[1])) continue;
          const d = await getImage(m[1]); if(d && !images.includes(d)) images.push(d);
        }
        for(const m of html.matchAll(/\[sound:([^\]]+)\]/g)){
          const id = await getAudio(m[1]); if(id && !audio.some(a=>a.id === id)) audio.push({ id, label: audioLabel(label) });
        }
      }
      return { text: texts.join('\n\n'), images: images.slice(0, MAX_IMAGES_PER_SIDE), audio };
    };

    const groups = new Map();
    for(const [nid, did, ord] of cardRows){
      const note = notes[nid]; if(!note) continue;
      const model = models[note[1]]; if(!model) continue;
      const names = model.flds.map(f=>f.name);
      const vals = note[2].split('\x1f');
      const fh = {}; names.forEach((n, i)=>{ fh[n] = vals[i] || ''; });
      let frontParts, backParts;
      if(model.type === 1){                                   // cloze note type
        const n = ord + 1, main = names[0];
        frontParts = [[main, clozeText(fh[main], n, false)]];
        backParts = [[main, clozeText(fh[main], n, true)]].concat(names.slice(1).map(k=>[k, fh[k]]));
      } else {
        const tm = model.tmpls[ord] || model.tmpls[0];
        let fn = tmplFields(tm.qfmt, names); if(!fn.length) fn = [names[0]];
        let bn = tmplFields(tm.afmt, names).filter(n=>!fn.includes(n));
        if(!bn.length) bn = names.filter(n=>!fn.includes(n));
        frontParts = fn.map(n=>[n, fh[n]]); backParts = bn.map(n=>[n, fh[n]]);
      }
      const q = await mkSide(frontParts), a = await mkSide(backParts);
      if((!q.text && !q.images.length) || (!a.text && !a.images.length && !a.audio.length)){ skipped++; continue; }
      if(!groups.has(did)) groups.set(did, []);
      groups.get(did).push({ id: uid(), num: 0, q, a, starred:false, correctCount:0, incorrectCount:0, lastResult:null, lastStudied:null });
    }

    let counter = 0;
    const glist = [...groups.entries()].map(([did, cs])=>{
      cs.forEach(c=>{ c.num = ++counter; });
      let nm = (ankiDecks[did] && ankiDecks[did].name) || 'Imported';
      if(nm === 'Default') nm = base;
      return { name: nm.replace(/::/g, ' › '), cards: cs };
    });
    if(!glist.length) return fail('No usable cards were found in this package.');
    const all = []; glist.forEach(g=>g.cards.forEach(c=>all.push(c)));
    pendingParse = {
      cards: all, errors: [], raw: pendingParse.raw, groups: glist,
      warnings: skipped ? [skipped+' empty card'+(skipped === 1 ? '' : 's')+' skipped.'] : [],
      importInfo: 'Anki import: '+glist.length+' deck'+(glist.length === 1 ? '' : 's')+' · '+all.length+' cards · '+nImg+' images · '+nAud+' audio clips'+(missing ? ' · '+missing+' missing media reference(s)' : '')
    };
    const nameInput = document.getElementById('deckNameInput');
    if(nameInput && !nameInput.value) VIEW.suggestedName = glist.length === 1 ? glist[0].name : base;
    showToast('Found '+all.length+' cards');
    render();
  }catch(err){
    console.error(err);
    fail('Could not read that Anki file: '+(err && err.message ? err.message : err));
  }finally{
    importing = false;
  }
}

/* ---------- Create button for imports (supports several Anki decks at once) ---------- */
function createFromGroups(){
  const g = pendingParse.groups;
  if(!g || !pendingParse.cards.length) return;
  const typed = document.getElementById('deckNameInput').value.trim();
  let lastId = null;
  g.forEach(gr=>{
    gr.cards.forEach((c, i)=>{ c.num = i + 1; });
    const nm = g.length === 1 ? (typed || gr.name) : (typed ? typed+' — '+gr.name : gr.name);
    lastId = Decks.create(VIEW.subjectId, nm, gr.cards);
  });
  pendingParse = { cards:[], errors:[], warnings:[], raw:'' };
  VIEW = g.length === 1 ? { screen:'deck', deckId:lastId } : { screen:'subject', subjectId:VIEW.subjectId };
  showToast(g.length === 1 ? 'Deck created' : g.length+' decks created');
  render();
}

/* ---------- Hook into the app: file dispatcher + post-render patching ---------- */
const origDocx = window.handleDocxFile;
window.handleDocxFile = async function(file){
  if(!file) return;
  if(/\.docx$/i.test(file.name)) return origDocx(file);          // normal .docx: exactly the old code
  if(/\.apkg$/i.test(file.name)) return importApkg(file);
  // Unknown or renamed file (iOS can hide/change extensions): look inside it.
  try{
    await loadLibs();
    const z = await JSZip.loadAsync(file);
    if(z.file(/^collection\.anki/).length) return importApkg(file, z);
    const inner = z.file(/\.(apkg|colpkg)$/i)[0];                  // a .zip that CONTAINS the .apkg
    if(inner){
      const iz = await JSZip.loadAsync(await inner.async('uint8array'));
      if(iz.file(/^collection\.anki/).length) return importApkg({ name: inner.name.split('/').pop() }, iz);
    }
    if(z.file('word/document.xml')) return origDocx(new File([file], file.name+'.docx'));
  }catch(e){ console.error(e); }
  showToast('Not a .docx or Anki .apkg file: '+file.name);
};


/* ---------- FLASHCARD TEXT SIZE (Word-style: number box in pt, presets list, A- / A+) ---------- */
const FS_DEFAULT = 12, FS_MIN = 6, FS_MAX = 120;               // 12 pt = 16 px = the app's original size
const FS_PRESETS = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];   // Word's size list
const fsStyle = document.createElement('style');
document.head.appendChild(fsStyle);
const fsStyle2 = document.createElement('style');
fsStyle2.textContent = `.fs-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;}
.fs-name{flex:1 1 100%;font-weight:600;font-size:13px;color:var(--ink-soft);}
.fs-step{width:42px;height:42px;border:1.5px solid var(--line);border-radius:8px;font-weight:700;font-size:14px;color:var(--ink);}
.fs-step:hover{border-color:var(--teal);color:var(--teal);}
.fs-num{width:84px;height:42px;padding:0 8px;border:1.5px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);font-family:'IBM Plex Mono',monospace;font-size:16px;text-align:center;}
.fs-unit{font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--ink-soft);}
.fs-sel{height:42px;border:1.5px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);font-size:14px;padding:0 8px;}
.fs-preview{border:1.5px dashed var(--line);border-radius:10px;padding:14px 16px;margin-top:6px;}
.fs-pq{font-family:'Fraunces',serif;font-weight:500;line-height:1.45;margin-bottom:8px;}
.fs-pa{font-family:'Public Sans',sans-serif;line-height:1.55;}`;
document.head.appendChild(fsStyle2);

const fsGet = side => {
  const v = parseFloat(((STATE && STATE.settings) || {})[side+'FontPt']);
  return isFinite(v) ? Math.min(FS_MAX, Math.max(FS_MIN, v)) : FS_DEFAULT;
};
function applyFontSizes(){ fsStyle.textContent = '.q-text{font-size:'+fsGet('q')+'pt;}.a-text{font-size:'+fsGet('a')+'pt;}'; }
function fsSet(side, v){ STATE.settings[side+'FontPt'] = Math.round(v * 2) / 2; persist(); applyFontSizes(); }
function fsNext(v, dir){
  if(dir > 0){ const n = FS_PRESETS.find(p=>p > v + 1e-9); return n === undefined ? Math.min(FS_MAX, v + 4) : n; }
  const lower = FS_PRESETS.filter(p=>p < v - 1e-9);
  return lower.length ? lower[lower.length - 1] : Math.max(FS_MIN, v - 1);
}
function fsRowHtml(side, title){
  return '<div class="fs-row"><label class="fs-name">'+title+'</label>'
    + '<button type="button" class="fs-step" data-fs-step="'+side+':-1" aria-label="Smaller">A−</button>'
    + '<input class="fs-num" type="number" inputmode="decimal" min="'+FS_MIN+'" max="'+FS_MAX+'" step="0.5" value="'+fsGet(side)+'" data-fs-num="'+side+'">'
    + '<span class="fs-unit">pt</span>'
    + '<button type="button" class="fs-step" data-fs-step="'+side+':1" aria-label="Bigger">A+</button>'
    + '<select class="fs-sel" data-fs-sel="'+side+'"><option value="">Presets…</option>'+FS_PRESETS.map(p=>'<option value="'+p+'">'+p+' pt</option>').join('')+'</select></div>';
}
function fsRefresh(syncInputs){
  const pq = document.getElementById('fsPrevQ'), pa = document.getElementById('fsPrevA');
  if(pq) pq.style.fontSize = fsGet('q')+'pt';
  if(pa) pa.style.fontSize = fsGet('a')+'pt';
  if(syncInputs) document.querySelectorAll('[data-fs-num]').forEach(i=>{ i.value = fsGet(i.dataset.fsNum); });
}
function injectFontPanel(){
  const app = document.getElementById('app');
  if(!app || document.getElementById('fontPanel')) return;
  const wrap = document.createElement('div');
  wrap.className = 'panel'; wrap.id = 'fontPanel'; wrap.style.marginTop = '16px';
  wrap.innerHTML = '<div class="section-label" style="margin-top:0;">Flashcard text size</div>'
    + '<p style="color:var(--ink-soft);font-size:13.5px;margin-bottom:14px;">Set the size of the text on the flashcards, in points like in Word ('+FS_MIN+'–'+FS_MAX+' pt, default '+FS_DEFAULT+'). The question and answer sides are set separately.</p>'
    + fsRowHtml('q', 'Question side (front)') + fsRowHtml('a', 'Answer side (back)')
    + '<div class="fs-preview"><div id="fsPrevQ" class="fs-pq">皆さん</div><div id="fsPrevA" class="fs-pa">Everyone — a polite way to address a group of people.</div></div>'
    + '<button type="button" class="btn-secondary" id="fsReset" style="margin-top:14px;">Reset both to '+FS_DEFAULT+' pt</button>';
  app.appendChild(wrap);
  wrap.addEventListener('click', e=>{
    const b = e.target.closest('[data-fs-step]');
    if(b){ const [side, dir] = b.dataset.fsStep.split(':'); fsSet(side, fsNext(fsGet(side), +dir)); fsRefresh(true); return; }
    if(e.target.id === 'fsReset'){ fsSet('q', FS_DEFAULT); fsSet('a', FS_DEFAULT); fsRefresh(true); }
  });
  wrap.addEventListener('input', e=>{                           // live while typing, only for valid values
    const side = e.target.dataset.fsNum; if(!side) return;
    const v = parseFloat(e.target.value);
    if(isFinite(v) && v >= FS_MIN && v <= FS_MAX){ fsSet(side, v); fsRefresh(false); }
  });
  wrap.addEventListener('change', e=>{                          // on finish: clamp bad values
    const side = e.target.dataset.fsNum;
    if(side){ const v = parseFloat(e.target.value); fsSet(side, isFinite(v) ? Math.min(FS_MAX, Math.max(FS_MIN, v)) : fsGet(side)); fsRefresh(true); return; }
    const sel = e.target.dataset.fsSel;
    if(sel && e.target.value){ fsSet(sel, parseFloat(e.target.value)); e.target.value = ''; fsRefresh(true); }
  });
  fsRefresh(false);
}

function patchDom(){
  if(VIEW.screen === 'new-deck'){
    const fi = document.getElementById('fileInput');
    if(fi) fi.removeAttribute('accept');       // iOS greys out unknown extensions otherwise
    const dz = document.getElementById('dropzone');
    if(dz && dz.firstChild && dz.firstChild.nodeType === 3) dz.firstChild.nodeValue = 'Drop a .docx or an Anki .apkg file here, or ';
    const va = document.getElementById('validationArea');
    if(va && pendingParse.importInfo) va.insertAdjacentHTML('afterbegin', '<div class="validation ok">'+escapeHtml(pendingParse.importInfo)+'</div>');
    const btn = document.getElementById('createDeckBtn');
    if(btn && pendingParse.groups && pendingParse.cards.length){
      const nb = btn.cloneNode(true);
      btn.replaceWith(nb);
      nb.addEventListener('click', createFromGroups);
    }
  } else if(VIEW.screen === 'quiz'){
    preloadAudio();
  } else if(VIEW.screen === 'settings'){
    injectFontPanel();
  }
}
const origRender = window.render;
window.render = function(){ stopAudio(); applyFontSizes(); origRender(); patchDom(); };


/* ---------- visible proof that this file loaded (safe to delete these 2 lines later) ---------- */
window.ANKI_ADDON_VERSION = 'v5';
setTimeout(()=>showToast('Add-on v5 active (Anki import + text size)'), 700);

})();
