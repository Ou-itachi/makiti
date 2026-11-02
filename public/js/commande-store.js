// Commande en cours (étapes 1 et 2) et coordonnées mémorisées.
// • sessionStorage « bokki-commande » : { source: "panier" | "direct",
//   articles: [...] (achat direct seulement), tel } — propre à l'onglet ;
// • localStorage « bokki-coordonnees » : { tel, nom, region, quartier, repere }
//   (tel : numéro complet « +224… » ou « +33… », l'indicatif choisi en fait
//   partie ; region : la VILLE tapée par le client, nom de clé historique)
//   pour préremplir la commande suivante sur cet appareil (en attendant les
//   comptes, puis en plus des comptes).
const CLE_COMMANDE = "bokki-commande";
const CLE_COORDS = "bokki-coordonnees";

function lire(stockage, cle) {
  try {
    const v = JSON.parse(stockage.getItem(cle) || "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}
function ecrire(stockage, cle, valeur) {
  try {
    stockage.setItem(cle, JSON.stringify(valeur));
  } catch {
    /* stockage indisponible (navigation privée) : on continue sans mémoriser */
  }
}

// articles (achat direct) : [{ produitId, varianteId, varianteLibelle, quantite, nom, image, prixUnitaire }]
export function demarrerCommande(source, articles = null) {
  const ancienne = lireCommande();
  ecrire(sessionStorage, CLE_COMMANDE, { source, articles: source === "direct" ? articles : null, tel: ancienne?.tel || null });
}
export function lireCommande() {
  const c = lire(sessionStorage, CLE_COMMANDE);
  if (!c || !["panier", "direct"].includes(c.source)) return null;
  if (c.source === "direct" && !Array.isArray(c.articles)) return null;
  return c;
}
export function majCommande(champs) {
  const c = lireCommande();
  if (c) ecrire(sessionStorage, CLE_COMMANDE, { ...c, ...champs });
}
export function terminerCommande() {
  try { sessionStorage.removeItem(CLE_COMMANDE); } catch { /* rien */ }
}

export function lireCoordonnees() {
  return lire(localStorage, CLE_COORDS) || {};
}
export function memoriserCoordonnees(coords) {
  ecrire(localStorage, CLE_COORDS, { ...lireCoordonnees(), ...coords });
}

// Indicatifs proposés dans la petite liste devant le numéro (Guinée par
// défaut, en premier). `local` : numéro national attendu APRÈS l'indicatif
// (sans le 0 initial des numéros européens) ; `exemple` : placeholder.
// Garder aligné avec le <select class="indicatif"> des pages (même ordre).
export const INDICATIFS = [
  { code: "224", pays: "Guinée", drapeau: "🇬🇳", local: /^6\d{8}$/, exemple: "6XX XX XX XX" },
  { code: "221", pays: "Sénégal", drapeau: "🇸🇳", local: /^[37]\d{8}$/, exemple: "Numéro de téléphone" },
  { code: "33", pays: "France", drapeau: "🇫🇷", local: /^[1-9]\d{8}$/, exemple: "Numéro de téléphone" },
  { code: "32", pays: "Belgique", drapeau: "🇧🇪", local: /^[1-9]\d{7,8}$/, exemple: "Numéro de téléphone" },
  { code: "49", pays: "Allemagne", drapeau: "🇩🇪", local: /^[1-9]\d{6,13}$/, exemple: "Numéro de téléphone" },
  { code: "1", pays: "Canada", drapeau: "🇨🇦", local: /^[2-9]\d{9}$/, exemple: "Numéro de téléphone" },
];
const indicatifInfo = (code) => INDICATIFS.find((i) => i.code === String(code)) || INDICATIFS[0];

// Téléphone → format international « +<indicatif><numéro> » ou null.
// • Guinée (indicatif par défaut) : 9 chiffres (6XX XX XX XX), +224 implicite
//   — résultat « +224XXXXXXXXX », EXACTEMENT comme avant (comptes tel_224…,
//   clientTel des commandes) ;
// • autre indicatif choisi dans la liste : numéro national (le 0 initial
//   français/belge/allemand est retiré) → « +33612345678 » ;
// • saisie commençant par « + » : numéro international complet, quel que
//   soit l'indicatif choisi (8 à 15 chiffres, comme le serveur).
export function normaliserTelephone(saisie, indicatif = "224") {
  const brut = String(saisie || "").trim();
  if (brut.startsWith("+")) {
    const chiffres = brut.slice(1).replace(/[\s().-]/g, "");
    return /^\d{8,15}$/.test(chiffres) ? `+${chiffres}` : null;
  }
  let chiffres = brut.replace(/[\s().-]/g, "");
  const info = indicatifInfo(indicatif);
  if (info.code === "224") {
    if (chiffres.startsWith("00224")) chiffres = chiffres.slice(5);
    else if (chiffres.startsWith("224") && chiffres.length === 12) chiffres = chiffres.slice(3);
    return /^6\d{8}$/.test(chiffres) ? `+224${chiffres}` : null;
  }
  if (!/^\d+$/.test(chiffres)) return null;
  // Numéro tapé avec son indicatif (« 0033… », « 33 6… ») : indicatif retiré.
  if (chiffres.startsWith("00" + info.code)) chiffres = chiffres.slice(2 + info.code.length);
  else if (chiffres.startsWith(info.code) && !info.local.test(chiffres.replace(/^0/, "")) && info.local.test(chiffres.slice(info.code.length))) chiffres = chiffres.slice(info.code.length);
  if (info.code !== "1") chiffres = chiffres.replace(/^0/, ""); // 06 12… → 6 12…
  return info.local.test(chiffres) ? `+${info.code}${chiffres}` : null;
}

// « +224622123456 » → { indicatif: "224", local: "622 12 34 56" } ;
// « +33612345678 » → { indicatif: "33", local: "6 12 34 56 78" }. Numéro
// d'un autre pays : indicatif guinéen par défaut et numéro complet « +… ».
export function decomposerTelephone(tel) {
  const t = String(tel || "").trim();
  if (!t) return { indicatif: "224", local: "" };
  if (!t.startsWith("+")) return { indicatif: "224", local: t };
  if (t.startsWith("+224")) return { indicatif: "224", local: telephoneLocal(t) };
  // Plus long indicatif d'abord (« 1 » en dernier).
  const info = [...INDICATIFS].sort((a, b) => b.code.length - a.code.length)
    .find((i) => t.startsWith("+" + i.code) && i.local.test(t.slice(1 + i.code.length)));
  if (!info) return { indicatif: "224", local: t };
  return { indicatif: info.code, local: t.slice(1 + info.code.length).replace(/(\d{1,2})(?=(\d{2})+$)/g, "$1 ").trim() };
}
export function telephoneLocal(tel) {
  return String(tel || "").startsWith("+224") ? tel.slice(4).replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4") : tel || "";
}
// Affichage complet avec l'indicatif : « +224 622 12 34 56 », « +33 6 12 34 56 78 ».
export function telephoneAffiche(tel) {
  const t = String(tel || "");
  if (!t) return "";
  const d = decomposerTelephone(t);
  return d.local.startsWith("+") || !t.startsWith("+") ? t : `+${d.indicatif} ${d.local}`;
}

// Petite liste d'indicatifs devant le champ téléphone (<div class="prefix">
// avec <label class="indicatif"><select>…</select><span>…</span></label>) :
// le <select> natif, transparent, couvre l'étiquette visible (drapeau +
// indicatif + chevron) que l'on met à jour ici. Placeholder adapté au pays.
// Renvoie { indicatif(), definir(tel), valeur(), actualiser() }.
export function brancherIndicatif(input) {
  const select = input?.closest(".prefix")?.querySelector("select.indicatif-select");
  const etiquette = select?.parentElement.querySelector(".indicatif-txt");
  const actualiser = () => {
    if (!select) return;
    const info = indicatifInfo(select.value);
    if (etiquette) etiquette.textContent = `${info.drapeau} +${info.code}`;
    input.placeholder = info.exemple;
  };
  select?.addEventListener("change", () => { actualiser(); input.removeAttribute("aria-invalid"); });
  actualiser();
  const indicatif = () => select?.value || "224";
  return {
    indicatif,
    actualiser,
    // Numéro complet « +… » ou null.
    valeur: () => normaliserTelephone(input.value, indicatif()),
    // Préremplissage depuis un numéro complet mémorisé.
    definir(tel) {
      const d = decomposerTelephone(tel);
      if (select) select.value = d.indicatif;
      input.value = d.local;
      actualiser();
    },
  };
}
