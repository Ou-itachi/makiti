// Comparaison de texte pour la recherche : sans accents ni majuscules, et
// tolérante aux petites fautes (« telephone » trouve « Téléphone »,
// « telefone » aussi). Partagé par le catalogue et les suggestions.
export function normaliser(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Nombre de lettres à ajouter, retirer ou changer pour passer de a à b.
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let ligne = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const suivante = [i];
    for (let j = 1; j <= b.length; j++) {
      suivante[j] = Math.min(ligne[j] + 1, suivante[j - 1] + 1, ligne[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    ligne = suivante;
  }
  return ligne[b.length];
}

// Fautes permises : aucune sur un mot court (sinon « sac » trouverait « lac »).
const fautesPermises = (mot) => (mot.length >= 8 ? 2 : mot.length >= 5 ? 1 : 0);

// « ph » s'écrit souvent « f » : « telefone » trouve « téléphone ».
const sonore = (mot) => mot.replace(/ph/g, "f");

function motTrouve(mot, mots, texte) {
  if (texte.includes(mot)) return true;
  const max = fautesPermises(mot);
  if (!max) return false;
  const cherche = sonore(mot);
  return mots.map(sonore).some((m) => distance(cherche, m, max) <= max || distance(cherche, m.slice(0, cherche.length), max) <= max);
}

// Tous les mots de la recherche sont présents dans le texte.
export function correspondRecherche(recherche, texte) {
  const t = normaliser(texte);
  const mots = t.split(/[^a-z0-9]+/).filter(Boolean);
  return normaliser(recherche).split(/\s+/).filter(Boolean).every((m) => motTrouve(m, mots, t));
}
