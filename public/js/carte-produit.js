// Carte produit commune (accueil, catalogue, « similaires » de la fiche).
// Maquette : design-refonte/maquettes/Catalogue.html (.pcard).
// Accessibilité : la maquette met le bouton « + » DANS le lien de la carte ;
// ici le lien (.pcard-link) couvre toute la carte et le bouton d'ajout est
// un vrai <button> à côté (pas d'élément interactif imbriqué).
import { ajouterArticle } from "./panier-store.js";
import { moneyHTML, formatCurrencyFromGNF, onCurrencyChange } from "./currency-display.js";
import { reseauRapide } from "./reseau.js";
import { coeurHTML, brancherCoeurs } from "./favoris.js";
import { prechargerProduit } from "./donnees.js";
import { urlProduit } from "./slug.js";
import { hologrammeParDefaut } from "./produit-categories.js";

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
export function prixProduit(p) {
  return Number(p.caracteristiques?.prixMin ?? p.caracteristiques?.prix ?? p.prixVente ?? 0) || 0;
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

// ---------- Cartes « hologramme » (mise à jour n°3) ----------
// Activées uniquement par la classe cartes-holo sur <html> (+ la feuille
// css/cartes-hologramme.css). Sans cette classe, les cartes restent
// exactement celles d'avant (carteProduitHTML ci-dessous, inchangée).
// Couleur de l'hologramme par catégorie — table unique (couleurs dans le CSS).
export const HOLO_COULEUR = {
  "Téléphones": "h-green", "Tablettes": "h-green",
  "Ordinateurs": "h-cyan", "Télévisions": "h-cyan", "Électronique": "h-cyan",
  "Énergie": "h-orange", "Voitures": "h-orange",
  "Vêtements": "h-red", "Chaussures": "h-red",
};
// Hologramme choisi dans l'admin pour ce produit (Activé / Désactivé) ;
// sans réglage : selon la catégorie (hologrammeParDefaut). Désactivé :
// carte sobre, sans socle (classe h-sobre).
export function avecHologramme(p) {
  return typeof p.hologramme === "boolean" ? p.hologramme : hologrammeParDefaut(categorieProduit(p));
}
export const holoActif = () => !!globalThis.document?.documentElement?.classList?.contains?.("cartes-holo");
const ICONE_PLUS = `<svg class="i" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
// Prix sur une ligne : montant en gros, devise en petit juste après.
// Attribut propre (data-holo-gnf) : refreshCurrencyPrices n'y touche pas.
function prixHoloTexte(gnf) {
  const t = formatCurrencyFromGNF(gnf);
  const m = t.match(/^([\d\s  .,]+?)\s*([^\d\s  ].*)$/);
  return m ? `${escapeHTML(m[1])}<small>${escapeHTML(m[2])}</small>` : escapeHTML(t);
}
const prixHoloHTML = (gnf) => `<span data-holo-gnf="${Number(gnf) || 0}">${prixHoloTexte(gnf)}</span>`;
function sousTitreHolo(p) {
  const ig = p.infosGenerales || {};
  const marqueModele = [ig.marque ?? p.marque, ig.modele ?? p.modele].map((s) => String(s ?? "").trim()).filter(Boolean).join(" ");
  return marqueModele || categorieProduit(p);
}
function carteHoloHTML(p, { eager, vignette, srcset, nom, variantes, prix, prixBarre, enPromo, url, libelle }) {
  const cat = categorieProduit(p);
  const classes = [HOLO_COULEUR[cat], !avecHologramme(p) && "h-sobre"].filter(Boolean).map((c) => ` ${c}`).join("");
  const sous = sousTitreHolo(p);
  return `
    <article class="pcard pholo${classes}" data-id="${escapeHTML(p.id)}">
      <div class="pmedia">
        ${coeurHTML(p.id, nom)}
        <span class="holo-beam" aria-hidden="true"></span>
        <span class="holo-ring" aria-hidden="true"></span>
        <img src="${escapeHTML(vignette)}"${srcset} alt="${escapeHTML(nom)}" width="480" height="480" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"/>
      </div>
      <div class="pbody">
        <h3 class="pname"><a class="pcard-link" href="${url}">${escapeHTML(nom)}</a></h3>
        ${sous ? `<span class="psub">${escapeHTML(sous)}</span>` : ""}
        <span class="pprice">${variantes ? '<span class="pfrom">Dès </span>' : ""}${prixHoloHTML(prix)}${
          enPromo ? ` <s class="pold">${moneyHTML(prixBarre)}</s>` : ""
        }</span>
        <div class="pfoot">
          <span class="cod">${ICONE("i-truck")}À la livraison</span>
          <button type="button" class="padd" data-id="${escapeHTML(p.id)}"${variantes ? ' data-variantes="1"' : ""} aria-label="${escapeHTML(libelle)}">${ICONE_PLUS}</button>
        </div>
      </div>
    </article>`;
}
if (holoActif()) {
  // Changement de devise : les prix hologramme sont réécrits ici (après
  // la mise à jour des autres prix), et une fois au chargement pour les
  // cartes pré-rendues en GNF.
  const majPrixHolo = () => document.querySelectorAll("[data-holo-gnf]").forEach((n) => { n.innerHTML = prixHoloTexte(n.dataset.holoGnf); });
  onCurrencyChange(() => queueMicrotask(majPrixHolo));
  majPrixHolo();
}

// Toast « Ajouté au panier · Voir le panier » + pastille du panier animée.
let toastHolo = null;
function signalerAjoutHolo() {
  if (!toastHolo) {
    toastHolo = document.createElement("div");
    toastHolo.className = "holo-toast";
    toastHolo.setAttribute("role", "status");
    document.body.append(toastHolo);
  }
  toastHolo.innerHTML = `${ICONE("i-check")}<span>Ajouté au panier</span><span aria-hidden="true">·</span><a href="/panier">Voir le panier</a>`;
  toastHolo.classList.remove("on");
  void toastHolo.offsetWidth;
  toastHolo.classList.add("on");
  clearTimeout(toastHolo._t);
  toastHolo._t = setTimeout(() => toastHolo.classList.remove("on"), 2600);
  document.querySelectorAll("[data-panier-badge]").forEach((b) => {
    b.classList.remove("holo-bump");
    void b.offsetWidth;
    b.classList.add("holo-bump");
  });
}

// Carte d'un produit. options.eager : première rangée visible (pas de lazy).
// options.holo : cartes hologramme (par défaut : classe cartes-holo de la page).
export function carteProduitHTML(p, { eager = false, holo = holoActif() } = {}) {
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
  const prix = prixProduit(p);
  const prixBarre = p.caracteristiques?.prixBarre;
  const enPromo = typeof prixBarre === "number" && prixBarre > prix;
  const url = urlProduit(p.id, nom);
  const libelle = variantes ? `Choisir les options de ${nom}` : `Ajouter ${nom} au panier`;
  if (holo) return carteHoloHTML(p, { eager, vignette, srcset, nom, variantes, prix, prixBarre, enPromo, url, libelle });
  return `
    <article class="pcard" data-id="${escapeHTML(p.id)}">
      <div class="pmedia">
        <span class="cod">À la livraison</span>
        ${coeurHTML(p.id, nom)}
        <img src="${escapeHTML(vignette)}"${srcset} alt="${escapeHTML(nom)}" width="480" height="480" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"/>
      </div>
      <div class="pbody">
        <h3 class="pname"><a class="pcard-link" href="${url}">${escapeHTML(nom)}</a></h3>
        <div class="row between g6">
          <span class="pprice">${variantes ? '<span class="pfrom">Dès </span>' : ""}${moneyHTML(prix)}${
            enPromo ? ` <s class="pold">${moneyHTML(prixBarre)}</s>` : ""
          }</span>
          <button type="button" class="padd" data-id="${escapeHTML(p.id)}"${variantes ? ' data-variantes="1"' : ""} aria-label="${escapeHTML(libelle)}">${ICONE("i-cart")}</button>
        </div>
      </div>
    </article>`;
}

export function carteSqueletteHTML() {
  return `<div class="pcard pcard-skel" aria-hidden="true"><div class="pmedia"></div><div class="pbody"><span class="skel-l"></span><span class="skel-s"></span></div></div>`;
}

// Préchargement de la fiche : dès que le doigt touche une carte (ou après
// un court survol à la souris), ses données sont demandées — la fiche
// s'affiche alors aussitôt. Option « visibles » : aussi pour chaque carte
// qui apparaît à l'écran (produits similaires). Désactivé en réseau très
// lent ou économie de données (voir prechargementPermis).
function brancherPrechargement(conteneur, visibles) {
  const idDe = (e) => e.target.closest?.(".pcard[data-id]")?.dataset.id;
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
    const observer = () => conteneur.querySelectorAll(".pcard[data-id]").forEach((c) => io.observe(c));
    new MutationObserver(observer).observe(conteneur, { childList: true });
    observer();
  }
}

// Branche les boutons « + » d'un conteneur (délégation : un seul écouteur,
// valable aussi pour les cartes ajoutées ensuite par « Voir plus »).
export function brancherCartes(conteneur, trouverProduit, { prechargerVisibles = false } = {}) {
  if (!conteneur || conteneur.dataset.cartesBranchees) return;
  conteneur.dataset.cartesBranchees = "1";
  brancherCoeurs(conteneur);
  brancherPrechargement(conteneur, prechargerVisibles);
  const holo = holoActif();
  conteneur.addEventListener("click", (e) => {
    const btn = e.target.closest(".padd");
    if (!btn || !conteneur.contains(btn)) return;
    const id = btn.dataset.id;
    if (btn.dataset.variantes) {
      const pv = trouverProduit(id);
      location.href = urlProduit(id, pv ? nomProduit(pv) : "");
      return;
    }
    const p = trouverProduit(id);
    if (!p) return;
    // prixUnitaire indicatif : creerCommande recalcule toujours côté serveur.
    ajouterArticle({
      produitId: id,
      varianteId: null,
      nom: nomProduit(p),
      image: (p.images && p.images[0]) || PLACEHOLDER_IMG,
      prixUnitaire: prixProduit(p),
      quantite: 1,
    });
    btn.classList.add("ok");
    btn.innerHTML = ICONE("i-check");
    btn.setAttribute("aria-label", `${nomProduit(p)} ajouté au panier`);
    clearTimeout(btn._t);
    if (holo) signalerAjoutHolo();
    btn._t = setTimeout(() => {
      btn.classList.remove("ok");
      btn.innerHTML = holo ? ICONE_PLUS : ICONE("i-cart");
      btn.setAttribute("aria-label", `Ajouter ${nomProduit(p)} au panier`);
    }, holo ? 1000 : 1400);
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
