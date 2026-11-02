#!/bin/bash
# Scores Lighthouse mobile (2 passages par page) — mise à jour n°2, point 6.
#   tools/lighthouse.sh                       mesure https://bokki.shop
#   tools/lighthouse.sh http://localhost:5000 mesure un autre site (aperçu, local)
# Chrome : celui de Playwright (npx playwright install chromium) ou CHROME_PATH.
# Résultats JSON dans ${LH_DOSSIER:-/tmp/lighthouse-bokki}.
set -e
BASE=${1:-https://bokki.shop}
DOSSIER=${LH_DOSSIER:-/tmp/lighthouse-bokki}; mkdir -p "$DOSSIER"
if [ -z "$CHROME_PATH" ]; then
  CHROME_PATH=$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium-*/chrome-mac*/"Google Chrome for Testing.app"/Contents/MacOS/"Google Chrome for Testing" 2>/dev/null | tail -1)
  export CHROME_PATH
fi
PRODUIT=$(curl -s "$BASE/sitemap.xml" | grep -o "<loc>[^<]*/produit/[^<]*</loc>" | head -1 | sed 's|<loc>[^<]*/produit/|/produit/|; s|</loc>||')
for chemin in / ${PRODUIT:-/catalogue} /categorie/ordinateurs /livraison /faq; do
  nom=$(echo "$chemin" | sed 's|/|_|g'); [ "$nom" = "_" ] && nom=_accueil
  for i in 1 2; do
    npx -y lighthouse@12.8.2 "$BASE$chemin" --quiet --chrome-flags="--headless=new" \
      --only-categories=performance,seo,accessibility,best-practices --output=json --output-path="$DOSSIER/$nom-$i.json" >/dev/null 2>&1
  done
  node -e '
    const fs = require("fs"); const [d, n, c] = process.argv.slice(1);
    const r = [1, 2].map((i) => JSON.parse(fs.readFileSync(`${d}/${n}-${i}.json`)));
    const s = (k) => r.map((x) => Math.round(x.categories[k].score * 100)).join("/");
    console.log(`${c.padEnd(40)} perf ${s("performance")}  seo ${s("seo")}  a11y ${s("accessibility")}  bp ${s("best-practices")}  LCP ${r.map((x) => (x.audits["largest-contentful-paint"].numericValue / 1000).toFixed(1)).join("/")} s`);
  ' "$DOSSIER" "$nom" "$chemin"
done
