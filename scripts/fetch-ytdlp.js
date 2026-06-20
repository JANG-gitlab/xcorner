'use strict';

// Telecharge le binaire standalone yt-dlp depuis GitHub Releases dans
// build/bin/<os>/ pour qu'electron-builder l'embarque via extraResources.
//
// Usage : node scripts/fetch-ytdlp.js [darwin|win32|linux|all]
// Sans argument : telecharge les 3 plateformes (utile pour CI multi-OS).
//
// Limitations : ces binaires standalone n'incluent pas curl_cffi -> certaines
// videos TikTok age-gated peuvent renvoyer 403 sur ces machines. L'utilisateur
// peut compenser en installant yt-dlp via brew/pip avec curl_cffi.

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

// platform key (electron-builder ${os}) -> { url file, dest file, +x }
const TARGETS = {
  darwin: { remote: 'yt-dlp_macos', local: 'yt-dlp', exec: true },
  win32:  { remote: 'yt-dlp.exe',   local: 'yt-dlp.exe', exec: false },
  linux:  { remote: 'yt-dlp_linux', local: 'yt-dlp', exec: true }
};

const ROOT = path.join(__dirname, '..');
const OUT_BASE = path.join(ROOT, 'build', 'bin');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close(); try { fs.unlinkSync(dest); } catch {}
        return reject(new Error(`HTTP ${res.statusCode} on ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });
  });
}

async function fetchFor(platform) {
  const def = TARGETS[platform];
  if (!def) throw new Error(`Plateforme inconnue: ${platform}`);
  const outDir = path.join(OUT_BASE, platform);
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, def.local);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024 * 1024) {
    console.log(`[fetch-ytdlp] ${platform}: deja present (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} Mo)`);
    return;
  }
  const url = `${RELEASE_BASE}/${def.remote}`;
  console.log(`[fetch-ytdlp] ${platform}: telechargement ${url}`);
  await download(url, dest);
  if (def.exec) fs.chmodSync(dest, 0o755);
  console.log(`[fetch-ytdlp] ${platform}: OK -> ${dest} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} Mo)`);
}

(async () => {
  const arg = process.argv[2];
  const platforms = (!arg || arg === 'all') ? Object.keys(TARGETS) : [arg];
  for (const p of platforms) {
    try { await fetchFor(p); }
    catch (e) { console.error(`[fetch-ytdlp] ECHEC ${p}:`, e.message); process.exitCode = 1; }
  }
})();
