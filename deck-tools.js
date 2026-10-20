/* =====================================================================
   deck-tools.js — (1) tick cards in a deck and copy them into a NEW deck
                   (2) combine two or more decks into a NEW deck
   Load AFTER the main <script> block in index.html (order vs. anki-import.js
   does not matter). Originals are never changed or deleted — cards are copied.
   ===================================================================== */
(function(){
'use strict';

/* ---------- styles ---------- */
const st = document.createElement('style');
st.textContent = `.sel-bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--paper);padding:10px 0;margin-bottom:12px;border-bottom:1px solid var(--line);}
.sel-bar .sel-all{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;}
.sel-bar .sel-actions{margin-left:auto;display:flex;gap:6px;align-items:center;}
.sel-bar .btn-primary:disabled{opacity:.4;cursor:not-allowed;transform:none;}
.sel-cb{width:22px;height:22px;accent-color:var(--teal);flex-shrink:0;margin-top:2px;}
.card-list-row.sel{border-color:var(--teal);background:rgba(47,111,104,0.08);}
.card-list-body{cursor:pointer;}
.mk-lbl{display:block;font-size:12.5px;font-weight:600;color:var(--ink-soft);margin-bottom:6px;}
.mk-sel{width:100%;border:1.5px solid var(--line);border-radius:8px;padding:10px 12px;font-size:14px;margin-bottom:16px;background:var(--paper);color:var(--ink);font-family:'Public Sans',sans-serif;}
.mk-chk{display:flex;align-items:center;gap:10px;font-size:13.5px;margin-bottom:12px;}
.cmb-list{max-height:34vh;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:2px 12px 6px;margin-bottom:6px;}
.cmb-row{display:flex;align-items:flex-start;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px;}
.cmb-row:last-child{border-bottom:none;}
.cmb-n{color:var(--ink-soft);font-family:'IBM Plex Mono',monospace;font-size:11.5px;}`;
document.head.appendChild(st);

/* ---------- helpers ---------- */
const subjPath = id => {
  const parts = []; let c = STATE.subjects[id];
  while(c){ parts.unshift(c.name); c = c.parentId ? STATE.subjects[c.parentId] : null; }
  return parts.join(' › ');
};
const allSubjects = () => Object.values(STATE.subjects).map(s=>({ id:s.id, path:subjPath(s.id) })).sort((a, b)=>a.path.localeCompare(b.path));
const sortedCards = d => d.cards.slice().sort((a, b)=>a.num - b.num);
function cloneCards(cards, keep){
  return cards.map(c=>{
    const n = JSON.parse(JSON.stringify(c));                       // deep copy (text, images, audio refs)
    n.id = uid();
    if(!keep){ n.correctCount = 0; n.incorrectCount = 0; n.lastResult = null; n.lastStudied = null; n.starred = false; }
    return n;
  });
}
const finalize = cards => { cards.forEach((c, i)=>{ c.num = i + 1; }); return cards; };

/* ---------- shared "make a new deck" dialog ---------- */
function openMakeDeckModal(o){
  const subs = allSubjects();
  const body = (o.intro ? '<p>'+o.intro+'</p>' : '') + (o.extraHtml || '')
    + '<label class="mk-lbl">New deck name</label><input type="text" id="mkName" value="'+escapeHtml(o.defaultName)+'">'
    + '<label class="mk-lbl">Save in subject</label><select class="mk-sel" id="mkSubject">'
    + subs.map(s=>'<option value="'+s.id+'"'+(s.id === o.defaultSubjectId ? ' selected' : '')+'>'+escapeHtml(s.path)+'</option>').join('') + '</select>'
    + '<label class="mk-chk"><input type="checkbox" class="sel-cb" id="mkKeep"> Keep stars and right/wrong history</label>'
    + (o.showDedupe ? '<label class="mk-chk"><input type="checkbox" class="sel-cb" id="mkDedupe"> Skip duplicate cards (same question and answer)</label>' : '');
  openModal({
    title: o.title, body,
    actions: [
      { label:'Cancel', className:'btn-secondary', onClick: closeModal },
      { label:'Create deck', className:'btn-primary', onClick:()=>{
          const name = document.getElementById('mkName').value.trim();
          if(!name){ showToast('Give the new deck a name'); return; }
          const dd = document.getElementById('mkDedupe');
          const res = o.onCreate({ name, subjectId: document.getElementById('mkSubject').value, keep: document.getElementById('mkKeep').checked, dedupe: !!(dd && dd.checked) });
          if(res !== false) closeModal();
        }}
    ]
  });
  if(o.onWire) o.onWire();
}

/* ---------- 1) SELECT CARDS (on the "Edit cards" screen) ---------- */
const selected = new Set();
let selDeck = null;

function injectSelection(){
  const deck = STATE.decks[VIEW.deckId];
  const add = document.getElementById('addCardBtn');
  if(!deck || !add || document.getElementById('selBar')) return;
  if(selDeck !== VIEW.deckId){ selected.clear(); selDeck = VIEW.deckId; }
  const have = new Set(deck.cards.map(c=>c.id));
  Array.from(selected).forEach(i=>{ if(!have.has(i)) selected.delete(i); });

  const bar = document.createElement('div');
  bar.id = 'selBar'; bar.className = 'sel-bar';
  bar.innerHTML = '<label class="sel-all"><input type="checkbox" class="sel-cb" id="selAll"> Select all</label>'
    + '<span class="eyebrow" id="selCount">0 selected</span>'
    + '<span class="sel-actions"><button type="button" class="btn-ghost" id="selClear">Clear</button>'
    + '<button type="button" class="btn-primary" id="selCreate" disabled>New deck from selection</button></span>';
  add.insertAdjacentElement('afterend', bar);

  const rows = [];
  document.querySelectorAll('.card-list-row').forEach(row=>{
    const b = row.querySelector('[data-edit-card]'); if(!b) return;
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'sel-cb'; cb.setAttribute('aria-label', 'Select card'); cb.checked = selected.has(b.dataset.editCard);
    row.insertBefore(cb, row.firstChild);
    rows.push({ row, cb, id: b.dataset.editCard });
  });
  const all = document.getElementById('selAll'), count = document.getElementById('selCount'), create = document.getElementById('selCreate');
  const sync = ()=>{
    const n = rows.filter(r=>r.cb.checked).length;
    rows.forEach(r=>r.row.classList.toggle('sel', r.cb.checked));
    count.textContent = n+' of '+rows.length+' selected';
    create.disabled = n === 0;
    all.checked = n > 0 && n === rows.length;
    all.indeterminate = n > 0 && n < rows.length;
  };
  rows.forEach(r=>{
    r.cb.addEventListener('change', ()=>{ if(r.cb.checked) selected.add(r.id); else selected.delete(r.id); sync(); });
    const body = r.row.querySelector('.card-list-body');
    if(body) body.addEventListener('click', ()=>{ r.cb.checked = !r.cb.checked; r.cb.dispatchEvent(new Event('change')); });
  });
  all.addEventListener('change', ()=>{ rows.forEach(r=>{ r.cb.checked = all.checked; if(all.checked) selected.add(r.id); else selected.delete(r.id); }); sync(); });
  document.getElementById('selClear').addEventListener('click', ()=>{ rows.forEach(r=>{ r.cb.checked = false; }); selected.clear(); sync(); });
  create.addEventListener('click', ()=>{
    const picked = sortedCards(deck).filter(c=>selected.has(c.id));
    if(!picked.length) return;
    openMakeDeckModal({
      title: 'New deck from selected cards',
      intro: picked.length+' card'+(picked.length === 1 ? '' : 's')+' from "'+escapeHtml(deck.name)+'" will be copied. The original deck is not changed.',
      defaultName: deck.name+' — selection', defaultSubjectId: deck.subjectId,
      onCreate: o=>{
        const cards = finalize(cloneCards(picked, o.keep));
        Decks.create(o.subjectId, o.name, cards);
        selected.clear();
        showToast('Created "'+o.name+'" · '+cards.length+' cards · '+subjPath(o.subjectId));
        render();
      }
    });
  });
  sync();
}

/* ---------- 2) COMBINE DECKS (on a subject screen) ---------- */
function openCombine(){
  const cur = VIEW.subjectId;
  const subs = allSubjects().sort((a, b)=>(b.id === cur) - (a.id === cur));      // current subject first
  const groups = subs.map(s=>({ s, decks: (STATE.subjects[s.id].deckIds || []).map(id=>STATE.decks[id]).filter(Boolean) })).filter(g=>g.decks.length);
  if(groups.reduce((n, g)=>n + g.decks.length, 0) < 2){ showToast('You need at least 2 decks to combine'); return; }
  const list = groups.map(g=>'<div class="eyebrow" style="margin:10px 0 2px;">'+escapeHtml(g.s.path)+'</div>'
    + g.decks.map(d=>'<label class="cmb-row"><input type="checkbox" class="sel-cb" data-cmb="'+d.id+'"><span>'+escapeHtml(d.name)+' <span class="cmb-n">· '+d.cards.length+' cards</span></span></label>').join('')).join('');
  const ticked = () => Array.from(document.querySelectorAll('[data-cmb]')).filter(x=>x.checked).map(x=>STATE.decks[x.dataset.cmb]);
  openMakeDeckModal({
    title: 'Combine decks',
    intro: 'Tick two or more decks. Their cards are copied into a new deck; the original decks are not changed.',
    extraHtml: '<div class="cmb-list">'+list+'</div><div class="eyebrow" id="cmbTotal" style="margin:8px 0 16px;">0 decks · 0 cards</div>',
    defaultName: 'Combined deck', defaultSubjectId: cur, showDedupe: true,
    onWire: ()=>{
      const upd = ()=>{ const t = ticked(); document.getElementById('cmbTotal').textContent = t.length+' deck'+(t.length === 1 ? '' : 's')+' · '+t.reduce((a, d)=>a + d.cards.length, 0)+' cards'; };
      document.querySelectorAll('[data-cmb]').forEach(x=>x.addEventListener('change', upd));
    },
    onCreate: o=>{
      const picked = ticked();
      if(picked.length < 2){ showToast('Tick at least 2 decks'); return false; }
      let cards = []; picked.forEach(d=>{ cards = cards.concat(sortedCards(d)); });
      const before = cards.length;
      if(o.dedupe){
        const seen = new Set();
        cards = cards.filter(c=>{
          const q = (c.q.text || '').trim(); if(!q) return true;           // image-only cards are never treated as duplicates
          const k = q+'\u0001'+(c.a.text || '').trim();
          if(seen.has(k)) return false; seen.add(k); return true;
        });
      }
      cards = finalize(cloneCards(cards, o.keep));
      Decks.create(o.subjectId, o.name, cards);
      showToast('Created "'+o.name+'" · '+cards.length+' cards'+(before > cards.length ? ' ('+(before - cards.length)+' duplicates skipped)' : '')+' · '+subjPath(o.subjectId));
      render();
    }
  });
}
function injectCombineBtn(){
  const anchor = document.getElementById('newSubjectFromSubjectBtn');
  if(!anchor || document.getElementById('combineBtn')) return;
  const b = document.createElement('button');
  b.className = 'btn-secondary'; b.id = 'combineBtn'; b.textContent = 'Combine decks';
  b.addEventListener('click', openCombine);
  anchor.parentElement.style.flexWrap = 'wrap';
  anchor.parentElement.insertBefore(b, anchor);
}

/* ---------- hook into the app ---------- */
const prevRender = window.render;
window.render = function(){
  prevRender();
  if(VIEW.screen === 'deck-edit') injectSelection();
  else { selected.clear(); selDeck = null; if(VIEW.screen === 'subject') injectCombineBtn(); }
};

})();
