'use strict';

// Reglages par defaut de Xcorner. Les sources (dossier, fichiers, liens) ne
// sont pas ici : elles sont choisies depuis l'app et memorisees dans
// settings.json (userData).
module.exports = {
  title: 'Xcorner',
  imageDurationMs: 6000,    // duree d'affichage d'une image
  textDurationMs: 12000,    // duree d'affichage d'un document (texte, PDF, Word, tableur)
  webDurationMs: 30000,     // duree d'affichage d'un lien web (YouTube, TikTok, Instagram)
  feedScrollMs: 9000,       // intervalle de scroll auto dans le fil TikTok (ms)
  shuffle: true
};
