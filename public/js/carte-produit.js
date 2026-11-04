// Carte produit commune (accueil, catalogue, catégories, « similaires » de la
// fiche, favoris). Mise à jour n°4 : carte « pro » (.pc).
// Accessibilité : la carte n'est pas un lien qui contient des boutons. Le lien
// vers la fiche est porté par la photo et le nom ; « Ajouter au panier » et
// « Commander » sont de vrais <button> (rien d'interactif imbriqué).
import { ajouterArticle } from "./panier-store.js";
import { moneyHTML, formatCurrencyFromGNF, onCurrencyChange } from "./currency-display.js";
import { reseauRapide } from "./reseau.js";
import { coeurHTML, brancherCoeurs } from "./favoris.js";
import { prechargerProduit } from "./donnees.js";
import { urlProduit } from "./slug.js";
import { prixCarte } from "./promo.js";
import { signalerAjoutPanier } from "./toast.js";

export const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='500'%3E%3Crect width='500' height='500' fill='%23F3F5FA'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='22' fill='%235B6475' text-anchor='middle' dominant-baseline='middle'%3EBokki%3C/text%3E%3C/svg%3E";

// slug (URL /categorie/<slug>) -> libellé Firestore (infosGenerales.categorie).
// Doit rester aligné avec PRODUIT_CATEGORIES (produit-categories.js) et
// CATEGORIES (tools/partials.cjs).
export const CATEGORY_LABEL = {
  telephones: "Téléphones",
  ordinateurs: "Ordinateurs",
  tablettes: "Tablettes",
  televisions: "Télévisions",
  electronique: "Électronique",
  energie: "Énergie",
  vetements: "Vêtements",
  chaussures: "Chaussures",
  voitures: "Voitures",
};
export const CATEGORY_SLUG = Object.fromEntries(Object.entries(CATEGORY_LABEL).map(([s, l]) => [l, s]));

export function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Accesseurs compatibles ancien schéma plat (nom/categorie/prixVente) et
// nouveau schéma (infosGenerales/caracteristiques).
export function nomProduit(p) {
  return p.infosGenerales?.nom ?? p.nom ?? "";
}
export function categorieProduit(p) {
  return p.infosGenerales?.categorie ?? p.categorie ?? "";
}
// Prix actuel, promotion comprise (tri et filtre du catalogue compris).
export function prixProduit(p) {
  return prixCarte(p).prix;
}
export function aDesVariantes(p) {
  return p.caracteristiques?.prixMin != null;
}
export function dateProduit(p) {
  const d = p.dateCreation;
  if (!d) return 0;
  if (typeof d.toMillis === "function") return d.toMillis();
  if (typeof d.seconds === "number") return d.seconds * 1000;
  return Number(new Date(d)) || 0;
}

const ICONE = (id) => `<svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=2#${id}"/></svg>`;

// Prix sur une ligne : montant en gros, devise en petit juste après.
// Attribut propre (data-pc-gnf) : refreshCurrencyPrices n'y touche pas.
function prixCarteTexte(gnf) {
  const t = formatCurrencyFromGNF(gnf);
  const m = t.match(/^([\d\s.,]*\d)\s*(\D.*)$/);
  return m ? `${escapeHTML(m[1])}<small>${escapeHTML(m[2])}</small>` : escapeHTML(t);
}
// Changement de devise : les prix des cartes sont réécrits ici, et une fois au
// chargement pour les cartes pré-rendues en GNF. (Pas de readyState dans
// l'environnement factice du pré-rendu : rien à faire là-bas.)
if (globalThis.document?.readyState) {
  const majPrixCartes = () => document.querySelectorAll("[data-pc-gnf]").forEach((n) => { n.innerHTML = prixCarteTexte(n.dataset.pcGnf); });
  onCurrencyChange(() => queueMicrotask(majPrixCartes));
  majPrixCartes();
}

// Reflet du badge promo et flamme : animés seulement quand ils sont à l'écran.
if (globalThis.document?.readyState && "IntersectionObserver" in globalThis) {
  const io = new IntersectionObserver((entrees) => entrees.forEach((e) => e.target.classList.toggle("anim-on", e.isIntersecting)));
  const suivis = new WeakSet();
  const suivre = () => document.querySelectorAll(".pc-promo, .bk-flame").forEach((n) => {
    if (suivis.has(n)) return;
    suivis.add(n);
    io.observe(n);
  });
  let prevu = false;
  new MutationObserver(() => {
    if (prevu) return;
    prevu = true;
    requestAnimationFrame(() => { prevu = false; suivre(); });
  }).observe(document.body, { childList: true, subtree: true });
  suivre();
}

const ECLAIR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>';

// Note en étoiles et nombre d'avis, avant le prix. Sans avis : étoiles grises
// et « 0 avis », jamais de note inventée.
function noteHTML(p) {
  const nb = Number(p.nbAvis) || 0;
  const note = Number(p.noteMoyenne) || 0;
  if (!nb || !note) return '<span class="pc-rate" role="img" aria-label="0 avis"><span class="pc-etoiles"></span><span>0 avis</span></span>';
  const texte = note.toFixed(1).replace(".", ",");
  const remplissage = Math.round((Math.min(note, 5) / 5) * 100);
  return `<span class="pc-rate" role="img" aria-label="Note ${texte} sur 5, ${nb} avis"><span class="pc-etoiles"><span style="width:${remplissage}%"></span></span><b>${texte}</b><span>(${nb}<span class="pc-rate-mot"> avis</span>)</span></span>`;
}

// Carte d'un produit. options.eager : première rangée visible (pas de lazy).
export function carteProduitHTML(p, { eager = false } = {}) {
  const img = (p.images && p.images[0]) || PLACEHOLDER_IMG;
  // Miniature 480 px seulement si elle garde la photo entière
  // (miniaturesEntieres) : les anciennes étaient recadrées en carré.
  const vignette = (p.miniaturesEntieres && p.imagesSmall && p.imagesSmall[0]) || img;
  const largeur = Number(p.imageWidths?.[0]);
  // Hors réseau rapide, la vignette 480 px suffit pour une carte.
  const srcset =
    reseauRapide() && vignette !== img && largeur > 480
      ? ` srcset="${escapeHTML(vignette)} 480w, ${escapeHTML(img)} ${largeur}w" sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 22vw"`
      : "";
  const nom = nomProduit(p);
  const variantes = aDesVariantes(p);
  const { prix, normal } = prixCarte(p);
  const enPromo = normal > prix;
  const url = urlProduit(p.id, nom);
  const attrs = `data-id="${escapeHTML(p.id)}"${variantes ? ' data-variantes="1"' : ""}`;
  const detail = variantes ? `choisir les options de ${nom}` : nom;
  // Si les deux s'appliquent, la promotion est prioritaire.
  const badge = enPromo
    ? '<span class="pc-badge pc-promo">Promotion</span>'
    : p.meilleureVente === true ? '<span class="pc-badge pc-best">Meilleure vente</span>' : "";
  return `
    <article class="pc" data-id="${escapeHTML(p.id)}">
      <div class="pc-media">
        ${badge}
        ${coeurHTML(p.id, nom)}
        <a class="pc-photo" href="${url}" tabindex="-1" aria-hidden="true"><img src="${escapeHTML(vignette)}"${srcset} alt="${escapeHTML(nom)}" width="480" height="480" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"/></a>
      </div>
      <h3 class="pc-name"><a class="pc-lien" href="${url}">${escapeHTML(nom)}</a></h3>
      ${noteHTML(p)}
      <div class="pc-prices">
        <span class="pc-price${enPromo ? " is-promo" : ""}"><span data-pc-gnf="${prix}">${prixCarteTexte(prix)}</span></span>
        ${enPromo ? `<s class="pc-old">${moneyHTML(normal)}</s>` : ""}
      </div>
      <button type="button" class="pc-btn pc-add" ${attrs}>${ICONE("i-cart")}Ajouter au panier<span class="sr-only"> : ${escapeHTML(detail)}</span></button>
      <button type="button" class="pc-btn pc-buy" ${attrs}>${ECLAIR}Commander<span class="sr-only"> : ${escapeHTML(detail)}</span></button>
    </article>`;
}

export function carteSqueletteHTML() {
  return `<div class="pc pc-skel" aria-hidden="true"><div class="pc-media"></div><span class="skel-l"></span><span class="skel-l"></span><span class="skel-s"></span><span class="skel-b"></span><span class="skel-b"></span></div>`;
}

// Préchargement de la fiche : dès que le doigt touche une carte (ou après
// un court survol à la souris), ses données sont demandées — la fiche
// s'affiche alors aussitôt. Option « visibles » : aussi pour chaque carte
// qui apparaît à l'écran (produits similaires). Désactivé en réseau très
// lent ou économie de données (voir prechargementPermis).
function brancherPrechargement(conteneur, visibles) {
  const idDe = (e) => e.target.closest?.(".pc[data-id]")?.dataset.id;
  conteneur.addEventListener("pointerdown", (e) => prechargerProduit(idDe(e)), { passive: true });
  conteneur.addEventListener("focusin", (e) => prechargerProduit(idDe(e)));
  let survol = null;
  conteneur.addEventListener("mouseover", (e) => {
    const id = idDe(e);
    clearTimeout(survol);
    if (id) survol = setTimeout(() => prechargerProduit(id), 80);
  });
  conteneur.addEventListener("mouseout", () => clearTimeout(survol));
  if (visibles && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entrees) => {
      for (const en of entrees) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        prechargerProduit(en.target.dataset.id);
      }
    }, { rootMargin: "100px" });
    const observer = () => conteneur.querySelectorAll(".pc[data-id]").forEach((c) => io.observe(c));
    new MutationObserver(observer).observe(conteneur, { childList: true });
    observer();
  }
}

// Article de panier ou de commande directe, pour un produit sans variante.
// prixUnitaire indicatif : creerCommande recalcule toujours côté serveur.
function articleCarte(p) {
  return {
    produitId: p.id,
    varianteId: null,
    varianteLibelle: null,
    nom: nomProduit(p),
    image: (p.images && p.images[0]) || PLACEHOLDER_IMG,
    prixUnitaire: prixProduit(p),
    quantite: 1,
  };
}

// Branche les boutons d'un conteneur (délégation : un seul écouteur, valable
// aussi pour les cartes ajoutées ensuite par « Voir plus »). Produit à
// variantes : les deux boutons mènent à la fiche, le choix de la variante est
// obligatoire (creerCommande refuse une commande sans variante).
export function brancherCartes(conteneur, trouverProduit, { prechargerVisibles = false } = {}) {
  if (!conteneur || conteneur.dataset.cartesBranchees) return;
  conteneur.dataset.cartesBranchees = "1";
  brancherCoeurs(conteneur);
  brancherPrechargement(conteneur, prechargerVisibles);
  conteneur.addEventListener("click", async (e) => {
    const btn = e.target.closest(".pc-add, .pc-buy");
    if (!btn || !conteneur.contains(btn)) return;
    const id = btn.dataset.id;
    const p = trouverProduit(id);
    if (btn.dataset.variantes) {
      location.href = urlProduit(id, p ? nomProduit(p) : "");
      return;
    }
    if (!p) return;
    if (btn.classList.contains("pc-buy")) {
      const [{ demarrerCommande }, { lienEtapeCommande }] = await Promise.all([import("./commande-store.js"), import("./commande-acces.js")]);
      demarrerCommande("direct", [articleCarte(p)]);
      location.href = await lienEtapeCommande();
      return;
    }
    ajouterArticle(articleCarte(p));
    const icone = btn.querySelector("svg");
    if (!btn._icone) btn._icone = icone.outerHTML;
    btn.classList.add("ok");
    icone.outerHTML = ICONE("i-check");
    clearTimeout(btn._t);
    signalerAjoutPanier();
    btn._t = setTimeout(() => {
      btn.classList.remove("ok");
      btn.querySelector("svg").outerHTML = btn._icone;
    }, 1000);
  });
}

// Chargement paresseux de Firestore (SDK distant) : partagé par les pages.
let firestorePromise = null;
export function chargerFirestore() {
  if (!firestorePromise) {
    firestorePromise = Promise.all([
      import("./firebase-base.js"),
      import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"),
    ]).then(([{ db }, fs]) => ({ db, fs }));
  }
  return firestorePromise;
}
