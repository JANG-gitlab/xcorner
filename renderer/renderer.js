'use strict';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const els = {
  barTitle: document.getElementById('bar-title'),
  btnNew: document.getElementById('btn-new'),
  btnSources: document.getElementById('btn-sources'),
  btnMode: document.getElementById('btn-mode'),
  btnClose: document.getElementById('btn-close'),

  setup: document.getElementById('setup'),
  setupTitle: document.getElementById('setup-title'),
  setupStatus: document.getElementById('setup-status'),
  addFolderBtn: document.getElementById('add-folder'),
  addFileBtn: document.getElementById('add-file'),
  openTiktok: document.getElementById('open-tiktok'),
  openYoutube: document.getElementById('open-youtube'),
  openSite: document.getElementById('open-site'),
  openWindow: document.getElementById('open-window'),
  siteRow: document.getElementById('site-row'),
  siteInput: document.getElementById('site-input'),
  siteOk: document.getElementById('site-ok'),
  picker: document.getElementById('picker'),
  pickerBack: document.getElementById('picker-back'),
  pickerRefresh: document.getElementById('picker-refresh'),
  pickerMsg: document.getElementById('picker-msg'),
  pickerGrid: document.getElementById('picker-grid'),
  clearBtn: document.getElementById('clear-sources'),
  startBtn: document.getElementById('start-btn'),
  hint: document.getElementById('setup-hint'),

  nsfwToggle: document.getElementById('nsfw-toggle'),
  nsfwZone: document.getElementById('nsfw-zone'),
  catPublic: document.getElementById('cat-public'),
  catNsfw: document.getElementById('cat-nsfw'),
  ttToggle: document.getElementById('tt-toggle'),
  ttReset: document.getElementById('tt-reset'),
  ttRow: document.getElementById('tt-row'),
  ttCat: document.getElementById('tt-cat'),
  ttInput: document.getElementById('tt-input'),
  ttOk: document.getElementById('tt-ok'),
  ttList: document.getElementById('tt-list'),
  ttStatus: document.getElementById('tt-status'),

  viewer: document.getElementById('viewer'),
  stage: document.getElementById('stage'),
  feed: document.getElementById('feed'),
  slots: [document.getElementById('slotA'), document.getElementById('slotB')],
  btnPrev: document.getElementById('btn-prev'),
  btnPlay: document.getElementById('btn-play'),
  btnNext: document.getElementById('btn-next'),
  btnMute: document.getElementById('btn-mute')
};

const state = {
  mode: 'primary',
  list: [],
  index: -1,
  activeSlot: 0,
  playing: true,
  muted: true,
  imageDurationMs: 6000,
  textDurationMs: 12000,
  webDurationMs: 30000,
  feedScrollMs: 9000,
  imageTimer: null,
  currentItem: null,
  currentVideo: null,
  bgVideo: null,
  preload: null,
  renderSeq: 0,
  // fil (webview : TikTok / YouTube / goon / femboy)
  feed: false
};

// --- Utilitaires ------------------------------------------------------------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clearImageTimer() {
  if (state.imageTimer) { clearTimeout(state.imageTimer); state.imageTimer = null; }
}

function durationFor(item) {
  if (!item) return state.imageDurationMs;
  if (item.type === 'web') return state.webDurationMs;
  if (item.type === 'image') return state.imageDurationMs;
  return state.textDurationMs;
}

function sanitize(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, link, meta, style').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
  });
  return doc.body.innerHTML;
}

function prettyAccount(url) {
  const m = String(url).match(/@[^/?#]+/);
  return m ? m[0] : url;
}

// --- Panneau des sources ----------------------------------------------------

function setStatus(sum) {
  els.setupStatus.textContent = [
    sum.folder ? 'Dossier : 1' : 'Dossier : aucun',
    'Fichiers : ' + sum.files
  ].join('   ·   ');
  els.startBtn.disabled = !(sum.folder || sum.files);
}

function showSetup() {
  clearImageTimer();
  stopCurrentVideo();
  exitFeed();
  hidePicker();
  els.viewer.hidden = true;
  els.setup.hidden = false;
  els.hint.textContent = '';
  window.xc.settingsGet().then(setStatus);
  refreshTiktok();
}

// --- Bouton "Site web" : URL libre dans le mode fil (webview interactive) ---
function submitSite() {
  let v = els.siteInput.value.trim();
  if (!v) return;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  els.siteRow.hidden = true;
  els.siteInput.value = '';
  enterFeed(v);
}

// --- Bouton "Fenetre" : capture d'une vraie app native --------------------
async function showPicker() {
  els.setup.hidden = true;
  els.viewer.hidden = true;
  els.picker.hidden = false;
  els.pickerGrid.innerHTML = '';
  els.pickerMsg.hidden = true;
  els.pickerMsg.textContent = '';
  const perm = await window.xc.capturePermission();
  if (perm.status === 'denied' || perm.status === 'restricted') {
    showPickerMsg('Autorise "Enregistrement d\'ecran" pour Xcorner dans Reglages > Confidentialite, puis relance l\'app.', true);
    return;
  }
  const sources = await window.xc.captureList();
  if (!sources.length) {
    showPickerMsg('Aucune fenetre detectee. Si tu n\'as jamais autorise Xcorner, ouvre Reglages.', true);
    return;
  }
  // Si pas de miniature, c'est probablement un probleme de permission.
  const hasThumbs = sources.some((s) => s.thumb);
  if (!hasThumbs) showPickerMsg('Miniatures indisponibles (autorisation manquante ?).', true);
  for (const s of sources) {
    const card = document.createElement('button');
    card.className = 'pick-item';
    const img = document.createElement('img');
    img.className = 'pick-thumb';
    if (s.thumb) img.src = s.thumb;
    const name = document.createElement('div');
    name.className = 'pick-name';
    name.textContent = s.name;
    card.appendChild(img);
    card.appendChild(name);
    card.addEventListener('click', () => pickWindow(s.id, s.name));
    els.pickerGrid.appendChild(card);
  }
}

function hidePicker() { els.picker.hidden = true; }

function showPickerMsg(txt, withOpenSettings) {
  els.pickerMsg.hidden = false;
  els.pickerMsg.textContent = txt;
  if (withOpenSettings) {
    const btn = document.createElement('button');
    btn.textContent = ' Ouvrir Reglages';
    btn.className = 'ghost';
    btn.style.marginLeft = '6px';
    btn.addEventListener('click', () => window.xc.captureOpenSettings());
    els.pickerMsg.appendChild(btn);
  }
}

function pickWindow(sourceId, name) {
  hidePicker();
  startViewer([{ kind: 'capture', sourceId, name }], true);
}

async function loadMedia() {
  const list = await window.xc.mediaList();
  if (!list.length) { showSetup(); els.hint.textContent = 'Aucun media trouve dans les sources'; return; }
  startViewer(list);
}

function startViewer(list, noShuffle) {
  exitFeed();
  els.setup.hidden = true;
  els.viewer.hidden = false;
  els.stage.style.display = '';
  els.slots.forEach((s) => { s.classList.remove('active'); s.innerHTML = ''; });
  state.list = list;
  if (!noShuffle) shuffle(state.list);
  state.index = -1;
  state.activeSlot = 0;
  state.playing = true;
  updatePlayButton();
  advance(1);
}

// --- Categories TikTok ------------------------------------------------------

let CATEGORIES = {}; // { key: { label, nsfw, mode } }

function makeCatButton(key, meta) {
  const b = document.createElement('button');
  b.className = 'cat';
  b.dataset.cat = key;
  b.textContent = meta.label || key;
  b.addEventListener('click', () => launchCategory(key));
  return b;
}

function buildCategoryUi() {
  els.catPublic.innerHTML = '';
  els.catNsfw.innerHTML = '';
  els.ttCat.innerHTML = '';
  let hasPublic = false;
  for (const [key, meta] of Object.entries(CATEGORIES)) {
    (meta.nsfw ? els.catNsfw : els.catPublic).appendChild(makeCatButton(key, meta));
    if (!meta.nsfw) hasPublic = true;
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = meta.label || key;
    els.ttCat.appendChild(opt);
  }
  const section = document.getElementById('cat-public-section');
  if (section) section.hidden = !hasPublic;
}

function renderTtList(lists) {
  els.ttList.innerHTML = '';
  for (const cat of Object.keys(CATEGORIES)) {
    for (const acc of (lists[cat] || [])) {
      const url = acc.url;
      const mode = acc.mode || 'posts';
      const row = document.createElement('div');
      row.className = 'tt-item';
      const left = document.createElement('span');
      const tag = document.createElement('span');
      tag.className = 'cat-tag';
      tag.textContent = CATEGORIES[cat].label || cat;
      const name = document.createElement('span');
      name.textContent = ' ' + prettyAccount(url);
      left.appendChild(tag); left.appendChild(name);
      if (mode === 'reposts') {
        const badge = document.createElement('span');
        badge.className = 'mode-badge';
        badge.textContent = 'reposts';
        left.appendChild(badge);
      }
      const rm = document.createElement('button');
      rm.textContent = '×';
      rm.title = 'Retirer';
      rm.addEventListener('click', async () => { await window.xc.tiktokRemove(cat, url); refreshTiktok(); });
      row.appendChild(left); row.appendChild(rm);
      els.ttList.appendChild(row);
    }
  }
}

function setCategoryButtonsEnabled(enabled) {
  for (const b of document.querySelectorAll('button.cat')) b.disabled = !enabled;
}

async function refreshTiktok() {
  if (!Object.keys(CATEGORIES).length) {
    CATEGORIES = await window.xc.tiktokCategories();
    buildCategoryUi();
  }
  const avail = await window.xc.tiktokAvailable();
  const lists = await window.xc.tiktokGet();
  renderTtList(lists);
  if (!avail.available) {
    els.ttStatus.textContent = 'yt-dlp introuvable (fil desactive)';
    setCategoryButtonsEnabled(false);
    return;
  }
  const parts = Object.entries(CATEGORIES).map(([k, m]) => (m.label || k) + ' : ' + ((lists[k] || []).length));
  els.ttStatus.textContent = parts.join('   ·   ');
  setCategoryButtonsEnabled(true);
}

async function submitTiktok() {
  const v = els.ttInput.value.trim();
  if (!v) return;
  const res = await window.xc.tiktokAdd(els.ttCat.value, v);
  if (res.ok) { els.ttInput.value = ''; refreshTiktok(); }
  else els.ttStatus.textContent = 'Lien TikTok non reconnu';
}

async function launchCategory(cat) {
  els.hint.textContent = 'Chargement des videos ' + cat + '...';
  const pool = await window.xc.tiktokPool(cat);
  if (!pool.length) { els.hint.textContent = 'Aucune video trouvee pour ' + cat; return; }
  els.hint.textContent = '';
  startViewer(pool, true); // pool deja melange + premieres prechargees cote main
}

// --- Mode fil (webview : TikTok / YouTube / goon / femboy) -------------------

function enterFeed(url) {
  els.setup.hidden = true;
  els.viewer.hidden = false;
  els.stage.style.display = 'none';
  els.feed.hidden = false;
  document.body.classList.add('feed-mode');
  state.feed = true;
  try { els.feed.src = url || 'https://www.tiktok.com/foryou'; } catch {}
}

function exitFeed() {
  document.body.classList.remove('feed-mode');
  if (!state.feed) return;
  state.feed = false;
  els.feed.hidden = true;
  els.stage.style.display = '';
  try { els.feed.src = 'about:blank'; } catch {}
}

// Scroll manuel optionnel (TikTok defile deja tout seul)
function feedScroll(dir) {
  const key = dir > 0 ? 'Down' : 'Up';
  try {
    els.feed.sendInputEvent({ type: 'keyDown', keyCode: key });
    els.feed.sendInputEvent({ type: 'keyUp', keyCode: key });
  } catch {}
}

function feedMute() {
  state.muted = !state.muted;
  try { els.feed.setAudioMuted(state.muted); } catch {}
}

// --- Lecteur (slideshow) ----------------------------------------------------

function stopCurrentVideo() {
  for (const v of [state.currentVideo, state.bgVideo]) if (v) { try { v.pause(); } catch {} }
  // Coupe d'eventuels flux de capture encore actifs dans les slots
  for (const slot of els.slots) {
    slot.querySelectorAll('video').forEach((vv) => {
      if (vv._stream) { try { vv._stream.getTracks().forEach((t) => t.stop()); } catch {} vv._stream = null; }
    });
  }
  state.currentVideo = null;
  state.bgVideo = null;
}

function makeBlurMedia(slot, url, isVideo) {
  if (isVideo) {
    const bg = document.createElement('video');
    bg.className = 'bg'; bg.src = url; bg.autoplay = true; bg.muted = true; bg.playsInline = true;
    const fg = document.createElement('video');
    fg.className = 'fg'; fg.src = url; fg.autoplay = true; fg.muted = state.muted; fg.playsInline = true;
    fg.addEventListener('ended', () => advance(1));
    fg.addEventListener('error', () => advance(1));
    // Slideshow photo TikTok / piste video illisible : videoWidth reste a 0
    // -> on saute au lieu d'afficher un ecran noir avec juste le son.
    fg.addEventListener('loadedmetadata', () => {
      if (fg.videoWidth === 0 || fg.videoHeight === 0) advance(1);
    });
    slot.appendChild(bg); slot.appendChild(fg);
    state.currentVideo = fg; state.bgVideo = bg;
    for (const v of [bg, fg]) { const p = v.play(); if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => {}); }); }
  } else {
    const bg = document.createElement('img'); bg.className = 'bg'; bg.src = url;
    const fg = document.createElement('img'); fg.className = 'fg'; fg.src = url;
    fg.addEventListener('error', () => advance(1));
    slot.appendChild(bg); slot.appendChild(fg);
  }
}

function fallbackCard(slot, label) {
  const card = document.createElement('div');
  card.className = 'fallback';
  card.textContent = label;
  slot.appendChild(card);
}

function renderInto(slot, item) {
  slot.innerHTML = '';
  state.currentVideo = null;
  state.bgVideo = null;
  state.currentItem = item;
  const seq = state.renderSeq;

  if (item.kind === 'web') {
    const wv = document.createElement('webview');
    wv.className = 'webframe';
    wv.setAttribute('partition', 'persist:web');
    wv.setAttribute('useragent', UA);
    wv.src = item.embedUrl;
    slot.appendChild(wv);
    return;
  }

  // Capture d'une fenetre macOS (lecture seule, audio non capturable sur macOS)
  if (item.kind === 'capture') {
    const v = document.createElement('video');
    v.className = 'capture';
    v.autoplay = true;
    v.muted = true; // pas de son, le son de l'app native sort deja par les hp
    v.playsInline = true;
    slot.appendChild(v);
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: item.sourceId,
          maxFrameRate: 30
        }
      }
    }).then((stream) => {
      if (seq !== state.renderSeq) { try { stream.getTracks().forEach((t) => t.stop()); } catch {} return; }
      v.srcObject = stream;
      v._stream = stream;
      v.play().catch(() => {});
    }).catch(() => {
      slot.innerHTML = '';
      fallbackCard(slot, 'Capture impossible. Autorise Enregistrement d\'ecran pour Xcorner puis relance.');
    });
    return;
  }

  // Video TikTok (goon/femboy) : telecharge en cache puis lit le fichier local
  if (item.kind === 'tiktok') {
    const card = document.createElement('div');
    card.className = 'fallback';
    card.textContent = 'Chargement...';
    slot.appendChild(card);
    const nx = state.list[(state.index + 1) % state.list.length];
    if (nx && nx.kind === 'tiktok') window.xc.tiktokPrefetch(nx.id, nx.url);
    window.xc.tiktokFetch(item.id, item.url).then((res) => {
      if (seq !== state.renderSeq) return;
      if (!res || !res.ok || !res.fileId) { advance(1); return; }
      slot.innerHTML = '';
      makeBlurMedia(slot, window.xc.mediaUrl(res.fileId), true);
    }).catch(() => { if (seq === state.renderSeq) advance(1); });
    return;
  }

  const url = window.xc.mediaUrl(item.id);

  if (item.type === 'image' || item.type === 'video') {
    makeBlurMedia(slot, url, item.type === 'video');
    return;
  }

  if (item.type === 'pdf') {
    const frame = document.createElement('iframe');
    frame.className = 'docframe';
    frame.src = url;
    slot.appendChild(frame);
    return;
  }

  if (item.type === 'text') {
    const card = document.createElement('div');
    card.className = 'textcard';
    slot.appendChild(card);
    fetch(url).then((r) => r.text()).then((txt) => { if (seq === state.renderSeq) card.textContent = txt; }).catch(() => advance(1));
    return;
  }

  if (item.type === 'doc') {
    const card = document.createElement('div');
    card.className = 'doccard';
    slot.appendChild(card);
    fetch(url).then((r) => r.arrayBuffer()).then((ab) => {
      if (seq !== state.renderSeq) return;
      return window.mammoth.convertToHtml({ arrayBuffer: ab }).then((res) => {
        if (seq === state.renderSeq) card.innerHTML = sanitize(res.value || '');
      });
    }).catch(() => { if (seq === state.renderSeq) { card.remove(); fallbackCard(slot, 'Document Word illisible'); } });
    return;
  }

  if (item.type === 'sheet') {
    const card = document.createElement('div');
    card.className = 'sheetcard';
    slot.appendChild(card);
    fetch(url).then((r) => r.arrayBuffer()).then((ab) => {
      if (seq !== state.renderSeq) return;
      const wb = window.XLSX.read(new Uint8Array(ab), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      card.innerHTML = sanitize(window.XLSX.utils.sheet_to_html(ws));
    }).catch(() => { if (seq === state.renderSeq) { card.remove(); fallbackCard(slot, 'Tableur illisible'); } });
    return;
  }

  fallbackCard(slot, 'Apercu non disponible' + (item.ext ? ' (' + item.ext + ')' : ''));
}

function preloadNext() {
  if (!state.list.length) return;
  const next = state.list[(state.index + 1) % state.list.length];
  if (next && next.type === 'image') { state.preload = new Image(); state.preload.src = window.xc.mediaUrl(next.id); }
}

function advance(direction) {
  if (!state.list.length) return;
  clearImageTimer();
  stopCurrentVideo();

  const n = state.list.length;
  if (direction === 1 && state.index + 1 >= n && n > 1) { shuffle(state.list); state.index = -1; }
  state.index = ((state.index + direction) % n + n) % n;
  const item = state.list[state.index];

  const nextSlotIndex = (state.activeSlot + 1) % 2;
  const nextSlot = els.slots[nextSlotIndex];
  const prevSlot = els.slots[state.activeSlot];

  state.renderSeq++;
  renderInto(nextSlot, item);
  nextSlot.classList.add('active');
  prevSlot.classList.remove('active');
  state.activeSlot = nextSlotIndex;

  setTimeout(() => { if (state.activeSlot !== els.slots.indexOf(prevSlot)) prevSlot.innerHTML = ''; }, 650);

  // Auto-avance pour images/docs ; les videos avancent sur 'ended' ; pas
  // d'avance pour une capture (item unique et perpetuel).
  if (state.playing && item.type !== 'video' && item.kind !== 'capture') {
    state.imageTimer = setTimeout(() => advance(1), durationFor(item));
  }
  preloadNext();
}

function togglePlay() {
  if (state.feed) return;
  state.playing = !state.playing;
  if (state.playing) {
    if (state.currentVideo) { for (const v of [state.currentVideo, state.bgVideo]) if (v) v.play().catch(() => {}); }
    else state.imageTimer = setTimeout(() => advance(1), durationFor(state.currentItem));
  } else {
    clearImageTimer();
    for (const v of [state.currentVideo, state.bgVideo]) if (v) { try { v.pause(); } catch {} }
  }
  updatePlayButton();
}

function updatePlayButton() {
  els.btnPlay.dataset.state = state.playing ? 'playing' : 'paused';
}

function updateMuteButton() {
  els.btnMute.dataset.state = state.muted ? 'muted' : 'unmuted';
}

function toggleMute() {
  if (state.feed) { feedMute(); updateMuteButton(); return; }
  state.muted = !state.muted;
  updateMuteButton();
  if (state.currentVideo) state.currentVideo.muted = state.muted;
}

async function toggleMode() {
  state.mode = state.mode === 'primary' ? 'secondary' : 'primary';
  await window.xc.setMode(state.mode);
  els.btnMode.textContent = state.mode === 'primary' ? 'Detacher' : 'Epingler';
}

function goPrev() { if (state.feed) feedScroll(-1); else advance(-1); }
function goNext() { if (state.feed) feedScroll(1); else advance(1); }

// --- Init + evenements ------------------------------------------------------

async function init() {
  const info = await window.xc.cornerInfo();
  state.imageDurationMs = info.imageDurationMs || 6000;
  state.textDurationMs = info.textDurationMs || 12000;
  state.webDurationMs = info.webDurationMs || 30000;
  state.feedScrollMs = info.feedScrollMs || 9000;
  els.barTitle.textContent = info.title;
  els.setupTitle.textContent = info.title;
  document.title = info.title;

  const sum = await window.xc.settingsGet();
  setStatus(sum);
  refreshTiktok();
  // Les nouvelles fenetres (bouton +) s'ouvrent toujours sur le choix de source.
  const fresh = new URLSearchParams(location.search).has('fresh');
  const proceed = () => { if (!fresh && (sum.folder || sum.files)) loadMedia(); else showSetup(); };
  if (fresh) { proceed(); return; }
  // Splash au lancement : laisse le temps au prewarm goon/femboy en fond.
  showSplash();
  setTimeout(() => { proceed(); hideSplash(); }, 2200);
}

function showSplash() {
  const el = document.getElementById('splash');
  el.classList.remove('hide');
  el.hidden = false;
}

function hideSplash() {
  const el = document.getElementById('splash');
  el.classList.add('hide');
  setTimeout(() => { el.hidden = true; }, 550);
}

els.addFolderBtn.addEventListener('click', async () => setStatus(await window.xc.addFolder()));
els.addFileBtn.addEventListener('click', async () => setStatus(await window.xc.addFile()));
els.openTiktok.addEventListener('click', () => enterFeed('https://www.tiktok.com/foryou'));
els.openYoutube.addEventListener('click', () => enterFeed('https://www.youtube.com'));
els.openSite.addEventListener('click', () => { els.siteRow.hidden = !els.siteRow.hidden; if (!els.siteRow.hidden) els.siteInput.focus(); });
els.siteOk.addEventListener('click', submitSite);
els.siteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitSite(); });
els.openWindow.addEventListener('click', showPicker);
els.pickerBack.addEventListener('click', showSetup);
els.pickerRefresh.addEventListener('click', showPicker);
els.clearBtn.addEventListener('click', async () => setStatus(await window.xc.clearSources()));
els.startBtn.addEventListener('click', () => loadMedia());
els.btnSources.addEventListener('click', showSetup);

els.nsfwToggle.addEventListener('click', () => {
  els.nsfwZone.hidden = !els.nsfwZone.hidden;
  els.nsfwToggle.setAttribute('aria-expanded', String(!els.nsfwZone.hidden));
  if (!els.nsfwZone.hidden) refreshTiktok();
});
els.ttToggle.addEventListener('click', () => { els.ttRow.hidden = !els.ttRow.hidden; if (!els.ttRow.hidden) els.ttInput.focus(); });
els.ttReset.addEventListener('click', async () => { await window.xc.tiktokReset(); refreshTiktok(); });
els.ttOk.addEventListener('click', submitTiktok);
els.ttInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitTiktok(); });

els.btnPrev.addEventListener('click', goPrev);
els.btnNext.addEventListener('click', goNext);
els.btnPlay.addEventListener('click', togglePlay);
els.btnMute.addEventListener('click', toggleMute);
els.btnNew.addEventListener('click', () => window.xc.newWindow());
els.btnMode.addEventListener('click', toggleMode);
els.btnClose.addEventListener('click', () => window.xc.close());

window.addEventListener('keydown', (e) => {
  if (els.viewer.hidden) return;
  switch (e.key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'ArrowRight': case 'ArrowDown': goNext(); break;
    case 'ArrowLeft': case 'ArrowUp': goPrev(); break;
    case 'd': case 'D': toggleMode(); break;
    case 'm': case 'M': toggleMute(); break;
  }
});

init();
