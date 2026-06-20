'use strict';

const { app, BrowserWindow, ipcMain, protocol, net, dialog, desktopCapturer, systemPreferences, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const conf = require('../config/app');
const nsfwDefaults = require('../config/nsfw');

// --- Types de fichiers ------------------------------------------------------

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.tiff', '.tif', '.svg', '.avif', '.ico']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.ogv']);
const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.text', '.log', '.csv', '.json', '.xml']);
const PDF_EXT = new Set(['.pdf']);
const DOC_EXT = new Set(['.docx']);                    // Word -> mammoth
const SHEET_EXT = new Set(['.xlsx', '.xls', '.ods']);  // tableurs -> SheetJS

function typeOf(ext) {
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (TEXT_EXT.has(ext)) return 'text';
  if (PDF_EXT.has(ext)) return 'pdf';
  if (DOC_EXT.has(ext)) return 'doc';
  if (SHEET_EXT.has(ext)) return 'sheet';
  return null;
}

// --- Scheme prive -----------------------------------------------------------

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'xmedia',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
]);

let winCount = 0; // pour decaler les nouvelles fenetres en cascade

// --- Reglages (sources) -----------------------------------------------------

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {}
  // migration depuis l'ancien format { mediaDir }
  if (s.mediaDir && !s.folder) s.folder = s.mediaDir;
  const tt = (s.tiktok && typeof s.tiktok === 'object') ? s.tiktok : {};
  const tiktok = {};
  for (const cat of Object.keys(nsfwDefaults)) {
    tiktok[cat] = (Array.isArray(tt[cat]) ? tt[cat] : [])
      .map(normalizeAccount).filter(Boolean);
  }
  return {
    folder: s.folder || null,
    files: Array.isArray(s.files) ? s.files : [],
    urls: Array.isArray(s.urls) ? s.urls : [],
    tiktok
  };
}

// Normalise un compte (string ou objet) vers { url, mode }.
function normalizeAccount(a) {
  if (typeof a === 'string') {
    const url = a.trim();
    return url ? { url, mode: 'posts' } : null;
  }
  if (a && typeof a === 'object' && a.url) {
    return { url: String(a.url).trim(), mode: a.mode === 'reposts' ? 'reposts' : 'posts' };
  }
  return null;
}

function writeSettings(s) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({ folder: s.folder, files: s.files, urls: s.urls, tiktok: s.tiktok }), { mode: 0o600 });
  } catch {}
}

// Liste des categories (clef -> meta : label, nsfw)
function categoriesMeta() {
  const out = {};
  for (const [key, def] of Object.entries(nsfwDefaults)) {
    out[key] = { label: def.label || key, nsfw: !!def.nsfw };
  }
  return out;
}

// Au tout premier lancement, copie les comptes "en dur" (config/nsfw.js) dans
// les reglages. Toute categorie vide est (re)remplie -> les boutons marchent
// sans avoir a cliquer "Defaut".
function seedDefaults() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch {}
  if (!raw.tiktok || typeof raw.tiktok !== 'object') raw.tiktok = {};
  let changed = false;
  for (const [cat, def] of Object.entries(nsfwDefaults)) {
    if (!Array.isArray(raw.tiktok[cat]) || raw.tiktok[cat].length === 0) {
      const accs = (def.accounts || []).map(normalizeAccount).filter(Boolean);
      if (accs.length) { raw.tiktok[cat] = accs; changed = true; }
      else if (!Array.isArray(raw.tiktok[cat])) { raw.tiktok[cat] = []; changed = true; }
    } else {
      // La categorie a deja des comptes (settings existant). On met a jour le
      // mode des comptes presents dans les defauts (utile quand on change le
      // mode d'un compte dans config/nsfw.js apres un 1er lancement).
      const defByUrl = new Map();
      for (const a of (def.accounts || [])) {
        const n = normalizeAccount(a);
        if (n) defByUrl.set(n.url, n);
      }
      raw.tiktok[cat] = raw.tiktok[cat]
        .map((a) => {
          const n = normalizeAccount(a);
          if (!n) return null;
          const d = defByUrl.get(n.url);
          if (d && d.mode !== n.mode) { n.mode = d.mode; changed = true; }
          return n;
        })
        .filter(Boolean);
      // Ajoute les comptes par defaut absents de la liste existante.
      for (const [url, d] of defByUrl) {
        if (!raw.tiktok[cat].some((a) => a.url === url)) {
          raw.tiktok[cat].push(d);
          changed = true;
        }
      }
    }
  }
  if (changed) { try { fs.writeFileSync(settingsFile(), JSON.stringify(raw), { mode: 0o600 }); } catch {} }
}

// --- Liens web ---------------------------------------------------------------

function parseUrl(raw) {
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  const yt = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`;

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const v = u.searchParams.get('v');
    if (v) return { provider: 'youtube', embedUrl: yt(v) };
    const m = u.pathname.match(/\/(shorts|embed|live)\/([^/?]+)/);
    if (m) return { provider: 'youtube', embedUrl: yt(m[2]) };
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1);
    if (id) return { provider: 'youtube', embedUrl: yt(id) };
  }
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    const m = u.pathname.match(/\/video\/(\d+)/);
    if (m) return { provider: 'tiktok', embedUrl: `https://www.tiktok.com/embed/v2/${m[1]}` };
  }
  if (host === 'instagram.com') {
    const m = u.pathname.match(/\/(reel|reels|p|tv)\/([^/?]+)/);
    if (m) {
      const kind = (m[1] === 'p' || m[1] === 'tv') ? 'p' : 'reel';
      return { provider: 'instagram', embedUrl: `https://www.instagram.com/${kind}/${m[2]}/embed/` };
    }
  }
  // inconnu : on tente l'URL telle quelle dans une iframe (peut etre bloquee)
  return { provider: 'web', embedUrl: raw.trim() };
}

// --- Construction de la liste ------------------------------------------------

// Map globale id -> { abs, type }. Ids uniques jamais reutilises : plusieurs
// fenetres peuvent coexister sans s'ecraser mutuellement.
const LOCALMAP = new Map();
let _idSeq = 0;

function buildList() {
  const s = readSettings();
  const out = [];
  const addLocal = (abs, type, ext) => {
    const id = 'm' + (_idSeq++);
    LOCALMAP.set(id, { abs, type });
    const item = { kind: 'local', id, type };
    if (type === 'unsupported') item.ext = ext;
    out.push(item);
  };

  if (s.folder) {
    const walk = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        const type = typeOf(path.extname(e.name).toLowerCase());
        if (type) addLocal(full, type); // dossier : seulement les types reconnus
      }
    };
    walk(s.folder);
  }

  for (const f of s.files) {
    if (!fs.existsSync(f)) continue;
    const ext = path.extname(f).toLowerCase();
    const type = typeOf(ext) || 'unsupported'; // fichier choisi : on l'affiche meme si inconnu
    addLocal(f, type, ext);
  }

  for (const link of s.urls) {
    out.push({ kind: 'web', type: 'web', provider: link.provider, embedUrl: link.embedUrl });
  }

  return out;
}

// --- TikTok (yt-dlp) --------------------------------------------------------

let _ytPath = null;
function ytdlpPath() {
  if (_ytPath !== null) return _ytPath;
  const winExt = process.platform === 'win32' ? '.exe' : '';
  // 1) Prefere une install systeme (Homebrew, etc.) pour beneficier de
  //    curl_cffi si l'utilisateur l'a installe (debloque les 403 TikTok).
  const sys = process.platform === 'win32'
    ? []
    : ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp', '/opt/local/bin/yt-dlp'];
  for (const c of sys) {
    try { if (fs.existsSync(c)) { _ytPath = c; return _ytPath; } } catch {}
  }
  // 2) Sinon binaire embarque dans l'app (resources/bin/yt-dlp)
  const bundled = [
    path.join(process.resourcesPath || '', 'bin', 'yt-dlp' + winExt),
    path.join(__dirname, '..', 'build', 'bin', process.platform, 'yt-dlp' + winExt) // dev
  ];
  for (const c of bundled) {
    try { if (fs.existsSync(c)) { _ytPath = c; return _ytPath; } } catch {}
  }
  // 3) Dernier recours : depend du PATH
  _ytPath = 'yt-dlp' + winExt;
  return _ytPath;
}

function ytdlpAvailable() {
  const yt = ytdlpPath();
  return yt.includes('/') ? fs.existsSync(yt) : true;
}

function cacheDir() { return path.join(app.getPath('userData'), 'tiktok-cache'); }

function findCacheFile(id) {
  try {
    const f = fs.readdirSync(cacheDir()).find((n) => n.startsWith(id + '.'));
    return f ? path.join(cacheDir(), f) : null;
  } catch { return null; }
}

function registerCache(id) {
  const abs = findCacheFile(id);
  if (!abs) return null;
  const fileId = 'tt_' + id;
  LOCALMAP.set(fileId, { abs, type: 'video' });
  return fileId;
}

// Supprime les plus vieux fichiers du cache au-dela d'une taille limite.
function cleanupCache(maxBytes) {
  try {
    const dir = cacheDir();
    const files = fs.readdirSync(dir).map((n) => {
      const p = path.join(dir, n);
      const st = fs.statSync(p);
      return { p, size: st.size, mtime: st.mtimeMs };
    });
    let total = files.reduce((a, f) => a + f.size, 0);
    if (total <= maxBytes) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (total <= maxBytes) break;
      try { fs.rmSync(f.p, { force: true }); total -= f.size; } catch {}
    }
  } catch {}
}

// Taille mini d'une video valide. En dessous on considere le fichier casse
// (age-restricted, slideshow photo, vidéo retiree, etc.) et on le supprime.
const MIN_VIDEO_BYTES = 50 * 1024;

const _inflight = new Map();
function cookiesFile() { return path.join(app.getPath('userData'), 'tiktok-cookies.txt'); }

function downloadVideo(id, url) {
  if (findCacheFile(id)) {
    const abs = findCacheFile(id);
    try { if (fs.statSync(abs).size < MIN_VIDEO_BYTES) fs.rmSync(abs, { force: true }); }
    catch {}
  }
  if (findCacheFile(id)) return Promise.resolve(registerCache(id));
  if (_inflight.has(id)) return _inflight.get(id);
  const yt = ytdlpPath();
  fs.mkdirSync(cacheDir(), { recursive: true });
  const out = path.join(cacheDir(), id + '.%(ext)s');
  // STRICT h264 (Chromium ne lit pas HEVC en HTML5). Si pas de h264 dispo
  // -> on prefere echouer plutot que telecharger un fichier illisible (noir).
  // --impersonate chrome utilise le TLS fingerprint Chrome (via curl_cffi)
  // pour eviter les 403 anti-bot TikTok. Silencieusement ignore si curl_cffi
  // n'est pas installe.
  const args = [
    '-f', 'b[vcodec*=h264]/bv*[vcodec*=h264]+ba/b[vcodec*=avc]',
    '--impersonate', 'chrome',
    '--no-playlist', '--no-part', '-o', out, url
  ];
  // Utilise les cookies TikTok si presents ET non vides (debloque les 18+).
  try {
    if (fs.existsSync(cookiesFile()) && fs.statSync(cookiesFile()).size > 100) {
      args.unshift('--cookies', cookiesFile());
    }
  } catch {}

  const prom = new Promise((resolve, reject) => {
    execFile(yt, args, { timeout: 120000, maxBuffer: 1024 * 1024 * 16 }, (err, _stdout, stderr) => {
      _inflight.delete(id);
      // Verifie la taille : un fichier minuscule = age-restricted / slideshow / casse.
      const abs = findCacheFile(id);
      if (abs) {
        try {
          if (fs.statSync(abs).size < MIN_VIDEO_BYTES) {
            fs.rmSync(abs, { force: true });
          }
        } catch {}
      }
      const fileId = registerCache(id);
      if (!fileId) {
        if (stderr) console.error('[yt-dlp]', id, String(stderr).split('\n').slice(0, 3).join(' | '));
        reject(err || new Error('echec telechargement'));
        return;
      }
      cleanupCache(1500 * 1024 * 1024);
      resolve(fileId);
    });
  });
  _inflight.set(id, prom);
  return prom;
}

// Liste les videos recentes d'un compte TikTok (sans les telecharger).
function resolveAccount(url) {
  return new Promise((resolve) => {
    const yt = ytdlpPath();
    const args = ['--flat-playlist', '-J', '--playlist-end', '30', '--impersonate', 'chrome', url];
    execFile(yt, args, { timeout: 90000, maxBuffer: 1024 * 1024 * 128 }, (err, stdout) => {
      if (err || !stdout) { resolve([]); return; }
      try {
        const data = JSON.parse(stdout);
        const entries = Array.isArray(data.entries) ? data.entries : [];
        resolve(entries
          .filter((e) => e && e.id)
          .map((e) => ({ id: String(e.id), url: e.url || ('https://www.tiktok.com/@_/video/' + e.id) })));
      } catch { resolve([]); }
    });
  });
}

// yt-dlp ne sait pas extraire l'onglet "Reposts" d'un compte TikTok. On charge
// donc /reposts dans une BrowserWindow cachee qui herite des cookies de la
// session "persist:tiktok" (= la webview du fil) : l'utilisateur connecte y
// voit ses reposts, on scrape les IDs, on les passe a yt-dlp.
// Sans connexion, TikTok redirige vers /foryou : on detecte et on rend vide.
function scrapeReposts(accountUrl, timeoutMs = 18000) {
  return new Promise((resolve) => {
    const url = String(accountUrl).replace(/\/$/, '') + '/reposts';
    let done = false;
    let win = null;
    const finish = (items) => {
      if (done) return;
      done = true;
      try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
      resolve(items || []);
    };
    const safety = setTimeout(() => finish([]), timeoutMs + 5000);

    try {
      win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 1024,
        webPreferences: {
          session: session.fromPartition('persist:tiktok'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      });
    } catch { clearTimeout(safety); finish([]); return; }

    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    win.webContents.setUserAgent(UA);
    win.webContents.on('did-fail-load', () => finish([]));

    win.loadURL(url, { userAgent: UA }).catch(() => finish([]));
    win.webContents.once('did-finish-load', async () => {
      try {
        const finalUrl = win.webContents.getURL();
        console.log('[xcorner][scrape] arrived at', finalUrl);
        if (/foryou|login/i.test(finalUrl)) {
          console.log('[xcorner][scrape] redirected to foryou/login -> 0 (login TikTok requis)');
          finish([]); return;
        }

        // Scroll plus genereux pour charger les items lazy
        await new Promise((r) => setTimeout(r, 1500));
        for (let i = 0; i < 8 && !done; i++) {
          await win.webContents.executeJavaScript('window.scrollBy(0, window.innerHeight * 2); true;').catch(() => {});
          await new Promise((r) => setTimeout(r, 1200));
        }
        if (done) return;

        const data = await win.webContents.executeJavaScript(`(() => {
          const set = new Set();
          // selecteur 1 : ancres classiques
          for (const a of document.querySelectorAll('a[href*="/video/"]')) {
            const m = (a.href || '').match(/\\/video\\/(\\d{6,})/);
            if (m) set.add(m[1]);
          }
          // selecteur 2 : data-e2e-...
          for (const el of document.querySelectorAll('[data-e2e*="reposts"] a, [data-e2e*="repost"] a')) {
            const m = (el.href || '').match(/\\/video\\/(\\d{6,})/);
            if (m) set.add(m[1]);
          }
          return {
            ids: Array.from(set),
            title: document.title,
            bodyChars: (document.body.innerText || '').length,
            sampleHtml: (document.body.innerHTML || '').slice(0, 200)
          };
        })()`).catch(() => ({ ids: [], title: '?', bodyChars: 0, sampleHtml: '(err)' }));

        console.log('[xcorner][scrape]', url, 'title="' + data.title + '" body=' + data.bodyChars + 'c ids=' + data.ids.length);
        const items = (data.ids || []).map((id) => ({ id: String(id), url: 'https://www.tiktok.com/@_/video/' + id }));
        clearTimeout(safety);
        finish(items);
      } catch (e) { console.log('[xcorner][scrape] error', String(e)); finish([]); }
    });
  });
}

async function resolveAccountWithMode(url, mode) {
  if (mode === 'reposts') {
    // STRICT : si pas de reposts scrapes (login manquant ou compte n'expose
    // rien), on ramene rien. Pas de fallback sur les posts du compte pour ne
    // pas polluer la categorie avec du contenu non-repost.
    const items = await scrapeReposts(url);
    console.log('[xcorner] reposts', url, '->', items.length, 'videos');
    return items;
  }
  const items = await resolveAccount(url);
  console.log('[xcorner] posts', url, '->', items.length, 'videos');
  return items;
}

// Exporte les cookies de la session "persist:tiktok" (= la session de la
// webview) au format Netscape pour yt-dlp. Si l'utilisateur s'est connecte
// a TikTok via le bouton TikTok du panneau, ce fichier debloque les videos
// age-restricted lors du prochain telechargement.
async function exportTiktokCookies() {
  try {
    const ses = session.fromPartition('persist:tiktok');
    const cookies = await ses.cookies.get({ domain: 'tiktok.com' });
    if (!cookies.length) {
      try { fs.rmSync(cookiesFile(), { force: true }); } catch {}
      return false;
    }
    const lines = [
      '# Netscape HTTP Cookie File',
      '# Exported by Xcorner',
      ''
    ];
    for (const c of cookies) {
      const domain = c.domain.startsWith('.') ? c.domain : '.' + c.domain;
      const flag = 'TRUE';
      const path = c.path || '/';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expires = Math.floor(c.expirationDate || (Date.now() / 1000 + 86400 * 30));
      lines.push([domain, flag, path, secure, expires, c.name, c.value].join('\t'));
    }
    fs.writeFileSync(cookiesFile(), lines.join('\n'), { mode: 0o600 });
    return true;
  } catch { return false; }
}

// --- Pool TikTok prepare au lancement (prewarm) -----------------------------

const _poolCache = {};
const _prewarming = {};

async function resolvePool(cat) {
  if (!categoriesMeta()[cat]) return [];
  const accounts = readSettings().tiktok[cat] || [];
  let pool = [];
  for (const acc of accounts) {
    pool = pool.concat(await resolveAccountWithMode(acc.url, acc.mode));
  }
  const seen = new Set();
  pool = pool.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 80).map((it) => ({ kind: 'tiktok', type: 'video', id: it.id, url: it.url }));
}

async function prewarmCat(cat) {
  if (_prewarming[cat]) return;
  _prewarming[cat] = true;
  try {
    const pool = await resolvePool(cat);
    if (pool.length) {
      _poolCache[cat] = pool;
      // pre-telecharge les premieres pour un demarrage instantane
      for (const it of pool.slice(0, 3)) downloadVideo(it.id, it.url).catch(() => {});
    }
  } catch {}
  _prewarming[cat] = false;
}

async function debugTiktokSession() {
  try {
    const ses = session.fromPartition('persist:tiktok');
    const cookies = await ses.cookies.get({ domain: 'tiktok.com' });
    const sessionKeys = ['sessionid', 'sessionid_ss', 'sid_tt', 'tt_csrf_token', 'tt-target-idc'];
    const present = cookies.map((c) => c.name);
    const hasAuth = sessionKeys.some((k) => present.includes(k));
    console.log('[xcorner][session] partition=persist:tiktok cookies=' + cookies.length + ' hasAuth=' + hasAuth + ' keys=[' + present.slice(0, 20).join(', ') + ']');
    return hasAuth;
  } catch (e) {
    console.log('[xcorner][session] error', String(e));
    return false;
  }
}

function prewarmAll() {
  debugTiktokSession().then(() => exportTiktokCookies()).then(() => {
    for (const cat of Object.keys(categoriesMeta())) prewarmCat(cat);
  });
}
function invalidatePool(cat) { _poolCache[cat] = null; prewarmCat(cat); }

// --- Protocole xmedia:// ----------------------------------------------------

function setupProtocol() {
  protocol.handle('xmedia', (request) => {
    try {
      const url = new URL(request.url);
      const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const entry = LOCALMAP.get(id);
      if (!entry) return new Response('Not found', { status: 404 });
      if (entry.type === 'pdf') {
        const buf = fs.readFileSync(entry.abs);
        return new Response(buf, { headers: { 'content-type': 'application/pdf' } });
      }
      return net.fetch(pathToFileURL(entry.abs).toString());
    } catch {
      return new Response('Error', { status: 500 });
    }
  });
}

// --- Fenetre ----------------------------------------------------------------

// Cree une nouvelle fenetre Xcorner independante. `fresh` = ouvrir sur le
// panneau de choix (pour piocher une source differente par fenetre).
function createWindow(fresh) {
  const offset = (winCount++ % 8) * 32;
  const w = new BrowserWindow({
    width: 420,
    height: 640,
    minWidth: 280,
    minHeight: 360,
    x: 80 + offset,
    y: 80 + offset,
    show: false,
    frame: false,
    backgroundColor: '#000000',
    alwaysOnTop: true,
    fullscreenable: false,
    title: conf.title,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      plugins: true, // active le lecteur PDF integre de Chromium
      webviewTag: true, // pour le fil TikTok et les liens web (vraie origine)
      allowRunningInsecureContent: true // pour HTTPS auto-signe / mixed content
    }
  });

  w._mode = 'primary';
  w.setContentProtection(true);
  applyMode(w, 'primary');

  w.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), fresh ? { query: { fresh: '1' } } : undefined);
  w.once('ready-to-show', () => {
    w.show();
    reassertAll();
    setTimeout(reassertAll, 500);
  });
  return w;
}

function applyMode(w, mode) {
  if (!w || w.isDestroyed()) return;
  w._mode = mode === 'secondary' ? 'secondary' : 'primary';
  // skipTransformProcessType: l'app est deja accessoire (app.dock.hide), donc on
  // evite la bascule du type de process qui casserait le suivi multi-fenetres.
  if (w._mode === 'secondary') {
    w.setAlwaysOnTop(false);
    w.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true });
    w.blur();
  } else {
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  }
}

// Re-applique le mode a toutes les fenetres (sinon les nouvelles ne suivent pas
// les bureaux et l'ouverture d'une fenetre peut perturber les autres).
function reassertAll() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w._mode) applyMode(w, w._mode);
  }
}

function senderWin(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

// --- IPC --------------------------------------------------------------------

function summary() {
  const s = readSettings();
  return { folder: s.folder, files: s.files.length, urls: s.urls.length };
}

ipcMain.handle('corner:info', () => ({
  title: conf.title,
  imageDurationMs: conf.imageDurationMs,
  textDurationMs: conf.textDurationMs,
  webDurationMs: conf.webDurationMs,
  feedScrollMs: conf.feedScrollMs
}));

ipcMain.handle('settings:get', () => summary());

ipcMain.handle('source:addFolder', async (event) => {
  const w = senderWin(event);
  if (w) w.focus();
  const res = await dialog.showOpenDialog(w, { title: 'Choisir un dossier', properties: ['openDirectory'] });
  if (!res.canceled && res.filePaths.length) {
    const s = readSettings();
    s.folder = res.filePaths[0];
    writeSettings(s);
  }
  return summary();
});

ipcMain.handle('source:addFile', async (event) => {
  const w = senderWin(event);
  if (w) w.focus();
  const res = await dialog.showOpenDialog(w, { title: 'Choisir un ou plusieurs fichiers', properties: ['openFile', 'multiSelections'] });
  if (!res.canceled && res.filePaths.length) {
    const s = readSettings();
    for (const f of res.filePaths) if (!s.files.includes(f)) s.files.push(f);
    writeSettings(s);
  }
  return summary();
});

ipcMain.handle('source:addUrl', (_event, raw) => {
  const parsed = parseUrl(String(raw || ''));
  if (!parsed) return { ok: false, summary: summary() };
  const s = readSettings();
  s.urls.push({ raw: String(raw).trim(), provider: parsed.provider, embedUrl: parsed.embedUrl });
  writeSettings(s);
  return { ok: true, summary: summary() };
});

ipcMain.handle('source:clear', () => {
  writeSettings({ folder: null, files: [], urls: [] });
  return summary();
});

ipcMain.handle('media:list', () => buildList());

ipcMain.handle('tiktok:available', () => ({ available: ytdlpAvailable() }));

ipcMain.handle('tiktok:categories', () => categoriesMeta());

function getAllLists() {
  const s = readSettings();
  const out = {};
  for (const cat of Object.keys(categoriesMeta())) out[cat] = s.tiktok[cat] || [];
  return out;
}

ipcMain.handle('tiktok:get', () => getAllLists());

ipcMain.handle('tiktok:add', (_event, category, url, mode) => {
  if (!categoriesMeta()[category]) return { ok: false, lists: getAllLists() };
  let ok = false;
  try { ok = new URL(String(url)).hostname.includes('tiktok.com'); } catch {}
  if (!ok) return { ok: false, lists: getAllLists() };
  const acc = { url: String(url).trim(), mode: mode === 'reposts' ? 'reposts' : 'posts' };
  const s = readSettings();
  if (!s.tiktok[category].some((a) => a.url === acc.url)) s.tiktok[category].push(acc);
  writeSettings(s);
  invalidatePool(category);
  return { ok: true, lists: getAllLists() };
});

ipcMain.handle('tiktok:remove', (_event, category, url) => {
  if (!categoriesMeta()[category]) return getAllLists();
  const s = readSettings();
  s.tiktok[category] = s.tiktok[category].filter((a) => a.url !== url);
  writeSettings(s);
  invalidatePool(category);
  return getAllLists();
});

ipcMain.handle('tiktok:reset', () => {
  const s = readSettings();
  s.tiktok = {};
  for (const [cat, def] of Object.entries(nsfwDefaults)) {
    s.tiktok[cat] = (def.accounts || []).map(normalizeAccount).filter(Boolean);
  }
  writeSettings(s);
  for (const cat of Object.keys(nsfwDefaults)) invalidatePool(cat);
  return getAllLists();
});

// Pool d'une categorie : renvoie le cache prepare au lancement (instantane) et
// rafraichit en fond ; sinon resout a la demande.
ipcMain.handle('tiktok:pool', async (_event, category) => {
  const cat = categoriesMeta()[category] ? category : null;
  if (!cat) return [];
  if (_poolCache[cat] && _poolCache[cat].length) {
    prewarmCat(cat);
    return _poolCache[cat];
  }
  const pool = await resolvePool(cat);
  _poolCache[cat] = pool;
  for (const it of pool.slice(0, 3)) downloadVideo(it.id, it.url).catch(() => {});
  return pool;
});

ipcMain.handle('tiktok:fetch', async (_event, id, url) => {
  try { return { ok: true, fileId: await downloadVideo(String(id), String(url)) }; }
  catch { return { ok: false }; }
});

ipcMain.handle('tiktok:prefetch', (_event, id, url) => {
  downloadVideo(String(id), String(url)).catch(() => {});
  return true;
});

ipcMain.handle('window:mode', (event, mode) => {
  applyMode(senderWin(event), mode === 'secondary' ? 'secondary' : 'primary');
  return mode;
});
ipcMain.handle('window:close', (event) => { const w = senderWin(event); if (w) w.close(); });
ipcMain.handle('window:new', () => { createWindow(true); return true; });
ipcMain.handle('app:quit', () => app.quit());

// --- Capture de fenetre -----------------------------------------------------

// Liste les fenetres ouvertes du systeme avec une miniature. Sur macOS, ne
// renvoie de vraies miniatures que si la permission "Enregistrement d'ecran"
// est accordee a Xcorner.
ipcMain.handle('capture:list', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 240, height: 160 }
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null,
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
    }));
  } catch { return []; }
});

// Etat d'autorisation (macOS) : 'granted', 'denied', 'restricted', 'not-determined', 'unknown'
ipcMain.handle('capture:permission', () => {
  if (process.platform !== 'darwin') return { status: 'granted' };
  try { return { status: systemPreferences.getMediaAccessStatus('screen') }; }
  catch { return { status: 'unknown' }; }
});

// Ouvre directement le panneau Confidentialite > Enregistrement d'ecran
ipcMain.handle('capture:openSettings', () => {
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
  return true;
});

// --- Cycle de vie -----------------------------------------------------------

// Auto-accepte les certificats invalides (HTTPS auto-signe, Tailscale 100.x,
// .local, etc.). Necessaire pour ouvrir des services prives via Site web.
app.on('certificate-error', (event, _wc, _url, _err, _cert, callback) => {
  event.preventDefault();
  callback(true);
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  seedDefaults();
  setupProtocol();
  createWindow(false);
  prewarmAll(); // prepare les fils goon/femboy en fond des le lancement
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(false);
  });
});

app.on('window-all-closed', () => app.quit());
