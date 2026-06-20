# Xcorner

Fenetre flottante multi-fenetres pour Mac, Windows et Linux. Affiche en aleatoire
des medias locaux (images, videos, documents) et embarque des sources web :
TikTok, YouTube, site libre, capture d'une fenetre native.

Cree par **Jon Arbuckle**.

## Telecharger

Voir les [Releases](../../releases) pour les installeurs Mac (DMG), Windows
(NSIS .exe) et Linux (AppImage).

## Lancer en dev

```bash
npm install
npm start
```

## Builder localement

```bash
npm run dist:mac      # DMG arm64 + x64
npm run dist:win      # NSIS x64 (necessite Wine sur Mac)
npm run dist:linux    # AppImage x64
```

Le script `fetch-ytdlp.js` est appele automatiquement et telecharge le binaire
standalone yt-dlp dans `build/bin/<os>/`, embarque dans l'app via
`extraResources`.

## Release

Pour publier une nouvelle version sur GitHub Releases :

```bash
# Bump version dans package.json
git tag v1.0.1
git push --tags
```

Le workflow `.github/workflows/release.yml` build les 3 plateformes en parallele
et publie la Release.

## Notes

- L'app prefere une install Homebrew de yt-dlp (qui peut inclure `curl_cffi`
  pour passer les anti-bot TikTok) ; sinon elle utilise le binaire embarque.
- L'anti-capture d'ecran fonctionne sur Mac et Windows uniquement (limite
  Electron sous Linux).
