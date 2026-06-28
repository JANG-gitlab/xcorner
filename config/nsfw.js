'use strict';

// Categories de Xcorner. Chaque categorie regroupe des comptes TikTok et
// devient un bouton dans l'app. `nsfw: true` => bouton cache derriere "NSFW".
// `mode: 'reposts'` => on lit les republications du compte au lieu de ses posts
// (fallback sur les posts si reposts vide ou inaccessible).
//
// Les comptes ici sont les valeurs "par defaut" copiees dans les reglages au
// 1er lancement. Modifiables ensuite depuis l'app (+ comptes), ou rechargeables
// via le bouton "Defaut".

// Un compte peut etre une simple URL (mode 'posts' par defaut) ou un objet
// { url, mode } pour preciser. mode='reposts' = scraping uniquement de l'onglet
// reposts (login TikTok requis cote app, sinon le compte ramene 0). mode='posts'
// = posts du compte via yt-dlp.

module.exports = {
  goon: {
    label: 'Goon',
    nsfw: true,
    accounts: [
      'https://www.tiktok.com/@iamalatinalover',
      'https://www.tiktok.com/@alexismoonroe',
      'https://www.tiktok.com/@tiktokhatesme_ravy',
      'https://www.tiktok.com/@sophieraiin',
      'https://www.tiktok.com/@aishah'
    ]
  },
  femboy: {
    label: 'Femboy',
    nsfw: true,
    accounts: [
      'https://www.tiktok.com/@binguscat_qwq',
      'https://www.tiktok.com/@ace.onlyonline',
      'https://www.tiktok.com/@mooimimo',
      'https://www.tiktok.com/@strawbabyboy',
      'https://www.tiktok.com/@haltsmanu'
    ]
  },
  family: {
    label: 'Family Guy',
    nsfw: false,
    accounts: [
      'https://www.tiktok.com/@foxfamilyguy'
    ]
  }
};
