// Suggestions de la barre de recherche : catégories et produits pendant la
// frappe, recherches récentes (gardées sur le téléphone) quand le champ est
// vide. Chargé au premier toucher sur la barre (js/header-search.js) : aucune
// donnée n'est lue tant que la personne ne cherche pas.
import { requeteProduits } from "./donnees.js";
import { CATEGORY_LABEL, escapeHTML, nomProduit, categorieProduit } from "./carte-produit.js";
import { urlProduit } from "./slug.js";
import { prixCarte } from "./promo.js";
import { moneyHTML } from "./currency-display.js";
import { correspondRecherche } from "./recherche-texte.js";

const CLE_RECENTES = "bokki-recherches";
const MAX_RECENTES = 5;
const MAX_CATEGORIES = 2;
const MAX_PRODUITS = 5;
const MAX_CATALOGUE = 200;
const ATTENTE_FRAPPE = 120; // ms

const lireRecentes = () => {
  try { return JSON.parse(localStorage.getItem(CLE_RECENTES) || "[]").filter((t) => typeof t === "string"); } catch { return []; }
};
const ecrireRecentes = (liste) => {
  try { localStorage.setItem(CLE_RECENTES, JSON.stringify(liste)); } catch { /* stockage plein ou bloqué */ }
};
export function memoriserRecherche(texte) {
  const t = texte.trim().slice(0, 80);
  if (t.length < 2) return;
  ecrireRecentes([t, ...lireRecentes().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX_RECENTES));
}

const ICONE = (id) => `<svg class="i i-sm" aria-hidden="true"><use href="/assets/icons.svg?v=2#${id}"/></svg>`;

export function brancher(form, input) {
  if (form.__suggestions) return;
  form.__suggestions = true;
  const panneau = document.createElement("div");
  panneau.className = "sugg";
  panneau.id = "suggRecherche";
  panneau.setAttribute("role", "listbox");
  panneau.setAttribute("aria-label", "Suggestions de recherche");
  panneau.hidden = true;
  form.append(panneau);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", panneau.id);
  input.setAttribute("aria-expanded", "false");

  let produits = null;
  let chargement = null;
  let actif = -1;
  let minuteur = 0;

  const charger = () => {
    chargement ||= requeteProduits({ recents: true, limite: MAX_CATALOGUE }, (l) => { produits = l; })
      .then((l) => { produits = l; }).catch(() => { chargement = null; });
    return chargement;
  };
  const options = () => [...panneau.querySelectorAll('[role="option"]')];
  const fermer = () => {
    panneau.hidden = true;
    actif = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const ouvrir = (html) => {
    panneau.innerHTML = html;
    panneau.hidden = !html;
    actif = -1;
    input.setAttribute("aria-expanded", String(!!html));
    input.removeAttribute("aria-activedescendant");
    options().forEach((o, i) => { o.id = `sugg-${i}`; });
  };

  function afficherRecentes() {
    const recentes = lireRecentes();
    ouvrir(recentes.length ? `<div class="sugg-titre"><span>Recherches récentes</span><button type="button" class="sugg-effacer">Effacer</button></div>${
      recentes.map((t) => `<a class="sugg-ligne" role="option" aria-selected="false" href="/catalogue?q=${encodeURIComponent(t)}" data-q="${escapeHTML(t)}">${ICONE("i-search")}<span>${escapeHTML(t)}</span></a>`).join("")}` : "");
  }

  function afficherSuggestions(q) {
    const categories = Object.entries(CATEGORY_LABEL).filter(([, l]) => correspondRecherche(q, l)).slice(0, MAX_CATEGORIES);
    const trouves = (produits || []).filter((p) => correspondRecherche(q, `${nomProduit(p)} ${categorieProduit(p)} ${p.infosGenerales?.marque ?? ""}`)).slice(0, MAX_PRODUITS);
    ouvrir([
      ...categories.map(([slug, l]) => `<a class="sugg-ligne" role="option" aria-selected="false" href="/categorie/${slug}">${ICONE("i-grid")}<span>${escapeHTML(l)}</span><small>Catégorie</small></a>`),
      ...trouves.map((p) => {
        const nom = nomProduit(p);
        return `<a class="sugg-ligne" role="option" aria-selected="false" href="${urlProduit(p.id, nom)}"><img src="${escapeHTML(p.imagesSmall?.[0] || p.images?.[0] || "/favicon.svg")}" alt="" width="36" height="36" loading="lazy"/><span>${escapeHTML(nom)}</span><small>${moneyHTML(prixCarte(p).prix)}</small></a>`;
      }),
    ].join(""));
  }

  function majPanneau() {
    const q = input.value.trim();
    if (q.length < 2) return afficherRecentes();
    afficherSuggestions(q);
    if (!produits) charger().then(() => { if (input.value.trim() === q && document.activeElement === input) afficherSuggestions(q); });
  }

  input.addEventListener("focus", () => { charger(); majPanneau(); });
  input.addEventListener("input", () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(majPanneau, ATTENTE_FRAPPE);
  });
  input.addEventListener("keydown", (e) => {
    const liste = options();
    if (e.key === "Escape") return fermer();
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || !liste.length) return;
    e.preventDefault();
    actif = (actif + (e.key === "ArrowDown" ? 1 : -1) + liste.length) % liste.length;
    liste.forEach((o, i) => o.setAttribute("aria-selected", String(i === actif)));
    input.setAttribute("aria-activedescendant", liste[actif].id);
    liste[actif].scrollIntoView({ block: "nearest" });
  });
  form.addEventListener("submit", (e) => {
    if (actif >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      options()[actif].click();
      return;
    }
    memoriserRecherche(input.value);
    fermer();
  }, true);
  panneau.addEventListener("click", (e) => {
    if (e.target.closest(".sugg-effacer")) {
      e.preventDefault();
      ecrireRecentes([]);
      fermer();
      input.focus();
    }
  });
  // Le panneau reste ouvert pendant un toucher dedans.
  panneau.addEventListener("pointerdown", (e) => e.preventDefault());
  input.addEventListener("blur", fermer);
}
