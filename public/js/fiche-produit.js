// Fiche produit (maquette design-refonte/maquettes/Produit.html).
// Reprend la logique de l'ancien produit-detail.js : variantes (chaque
// combinaison a son prix), pastilles de couleur, photo HD selon le réseau,
// avis, caractéristiques, SEO. « Commander » ne s'ouvre plus en fenêtre :
// il lance la commande en 2 étapes (/commande/identification).
import { suivrePub } from "./suivi-pub.js";
import { signalerAjoutPanier } from "./toast.js";
import { noterVue, afficherRecemment } from "./recemment.js";
import {
  carteProduitHTML, brancherCartes, escapeHTML, PLACEHOLDER_IMG,
  nomProduit, categorieProduit, CATEGORY_SLUG,
} from "./carte-produit.js";
import { lireProduit, lireVariantes, lireAvis, requeteProduits, idDepuisSlug } from "./donnees.js";
import { slugProduit, urlProduit } from "./slug.js";
import { seoProduit } from "./seo-produit.js";
import { categorieConfig, couleurHex } from "./produit-categories.js";
import { coeurHTML, brancherCoeurs } from "./favoris.js";
import { ajouterArticle } from "./panier-store.js";
import { moneyHTML, onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";
import { reseauLent, reseauRapide, surChangementReseau, prechargerImage, niveauReseau } from "./reseau.js";
import { demarrerCommande } from "./commande-store.js";
import { prixFiche, prixFicheHTML } from "./promo.js";
import { lienEtapeCommande } from "./commande-acces.js";

const QTE_MAX = 20;
const AVIS_APERCU = 4;
const $ = (id) => document.getElementById(id);

// Identifiant du produit, dans l'ordre :
//  1. ?id=… (page modèle /produit, nouveaux produits pas encore pré-rendus,
//     anciens liens) ;
//  2. les données de la page pré-rendue /produit/<nom>-<xxxx> ;
//  3. l'adresse elle-même : nom-xxxx d'un produit déjà vu (hors ligne), ou
//     ancien identifiant brut.
const segment = decodeURIComponent(location.pathname.match(/^\/produit\/([^/]+?)(?:\.html)?\/?$/)?.[1] || "");
const productId = new URLSearchParams(location.search).get("id")
  || (() => { try { return Object.keys(JSON.parse(document.getElementById("bk-data")?.textContent || "{}").produits || {})[0]; } catch { return null; } })()
  || (segment && idDepuisSlug(segment, (p) => slugProduit(p.id, nomProduit(p))))
  || segment || null;
if (!productId) location.replace("/catalogue");

let produit = null;
let config = null;
let variantes = [];
let choix = {}; // { dimKey: valeur }
let quantite = 1;
let premierRendu = true;
let vueSuivie = false;
let images = { hd: [], petites: [] };
let photo = 0;
let annulerHD = null;

// ---------- Utilitaires ----------
const etoiles = (n) => {
  const k = Math.max(0, Math.min(5, Math.round(n || 0)));
  return "★".repeat(k) + "☆".repeat(5 - k);
};
const initiales = (nom) => (nom || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");
const dateAvis = (ts) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
};
const description = (p) => p.infosGenerales?.description ?? p.description ?? "";
const dimensions = () => config?.variantes?.dimensions || [];

// ---------- Galerie ----------
function afficherPhoto(i) {
  if (!images.hd.length) return;
  photo = (i + images.hd.length) % images.hd.length;
  const hd = images.hd[photo];
  const petite = images.petites[photo] || hd;
  annulerHD?.();
  annulerHD = null;
  $("mainImg").src = petite;
  $("galCompteur").textContent = `${photo + 1} / ${images.hd.length}`;
  if (produit) $("mainImg").alt = images.hd.length > 1 ? `${nomProduit(produit)}, photo ${photo + 1} sur ${images.hd.length}` : nomProduit(produit);
  document.querySelectorAll("#thumbs .thumb").forEach((t, k) => t.setAttribute("aria-current", String(k === photo)));
  const aHD = hd && hd !== petite;
  // HD (jusqu'à 200 Ko) automatique seulement sur réseau rapide ; en 3G ou
  // moins, au toucher du bouton « Voir en HD » (audit performance, point 3).
  const auto = reseauRapide();
  $("galHd").hidden = !(aHD && !auto);
  $("galHd").textContent = "Voir en HD";
  if (aHD && auto) chargerHD(photo);
}
function chargerHD(i) {
  annulerHD?.();
  annulerHD = prechargerImage(images.hd[i], (url) => {
    annulerHD = null;
    if (photo !== i) return;
    $("mainImg").src = url;
    $("galHd").hidden = true;
  });
}
$("galHd").addEventListener("click", () => {
  $("galHd").textContent = "Chargement HD…";
  chargerHD(photo);
});
$("galPrev").addEventListener("click", () => afficherPhoto(photo - 1));
$("galNext").addEventListener("click", () => afficherPhoto(photo + 1));
$("thumbs").addEventListener("click", (e) => {
  const t = e.target.closest(".thumb");
  if (t) afficherPhoto(Number(t.dataset.i));
});
// Balayage au doigt sur la photo : elle suit le doigt, puis la suivante arrive.
// Un toucher sans glissement ouvre le zoom.
const zone = $("mainImg").parentElement;
const SEUIL_BALAYAGE = 40;
// Un geste vif suffit, sans parcourir toute la distance (px/ms).
const VITESSE_BALAYAGE = 0.11;
let x0 = null;
let y0 = null;
let t0 = 0;
// Une photo changée au doigt n'ouvre pas aussi le zoom : le clic qui suit
// aussitôt le geste est ignoré.
let finBalayage = 0;
zone.addEventListener("touchstart", (e) => {
  // Les flèches gardent leur propre clic.
  if (e.target.closest("button")) return;
  x0 = e.touches[0].clientX;
  y0 = e.touches[0].clientY;
  t0 = Date.now();
  $("mainImg").style.transition = "none";
}, { passive: true });
zone.addEventListener("touchmove", (e) => {
  if (x0 == null || images.hd.length < 2 || e.touches.length > 1) return;
  const dx = e.touches[0].clientX - x0;
  if (Math.abs(dx) > Math.abs(e.touches[0].clientY - y0)) $("mainImg").style.transform = `translateX(${dx}px)`;
}, { passive: true });
zone.addEventListener("touchend", (e) => {
  if (x0 == null) return;
  const dx = e.changedTouches[0].clientX - x0;
  const dy = e.changedTouches[0].clientY - y0;
  const vif = Math.abs(dx) > 12 && Math.abs(dx) / Math.max(Date.now() - t0, 1) > VITESSE_BALAYAGE;
  x0 = null;
  $("mainImg").style.transition = "";
  $("mainImg").style.transform = "";
  // Défilement de la page en diagonale : la photo ne change pas.
  if (Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) > SEUIL_BALAYAGE || vif) && images.hd.length > 1) {
    finBalayage = Date.now();
    afficherPhoto(photo + (dx < 0 ? 1 : -1));
  }
}, { passive: true });
// Geste interrompu par le système : la photo revient en place.
zone.addEventListener("touchcancel", () => {
  x0 = null;
  $("mainImg").style.transition = "";
  $("mainImg").style.transform = "";
}, { passive: true });

// Zoom : la photo en grand. Un toucher grossit ou revient (faire glisser pour
// se déplacer) ; le pincement du téléphone reste possible.
let zoom = null;
function ouvrirZoom() {
  const src = images.hd[photo];
  if (!src) return;
  if (!zoom) {
    zoom = document.createElement("dialog");
    zoom.className = "gal-zoom";
    zoom.setAttribute("aria-label", "Photo du produit en grand");
    zoom.innerHTML = `<button type="button" class="gal-zoom-fermer" aria-label="Fermer la photo"><svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=2#i-x"/></svg></button><div class="gal-zoom-cadre"><img alt=""/></div>`;
    zoom.querySelector("button").addEventListener("click", () => zoom.close());
    zoom.querySelector("img").addEventListener("click", (e) => {
      const cadre = e.currentTarget.parentElement;
      const on = cadre.classList.toggle("loupe");
      if (on) {
        const r = e.currentTarget.getBoundingClientRect();
        cadre.scrollTo((e.offsetX / r.width) * cadre.scrollWidth - cadre.clientWidth / 2, (e.offsetY / r.height) * cadre.scrollHeight - cadre.clientHeight / 2);
      }
    });
    document.body.append(zoom);
  }
  zoom.querySelector(".gal-zoom-cadre").classList.remove("loupe");
  const img = zoom.querySelector("img");
  img.src = src;
  img.alt = $("mainImg").alt;
  zoom.showModal();
}
$("mainImg").addEventListener("click", () => {
  if (Date.now() - finBalayage < 400) return;
  ouvrirZoom();
});
$("mainImg").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ouvrirZoom(); }
});

surChangementReseau((niveau) => {
  const hd = images.hd[photo];
  if (niveau === "rapide" && hd && $("mainImg").getAttribute("src") !== hd) chargerHD(photo);
});

// Photos suivantes de la galerie téléchargées d'avance (après la 1re), pour
// un balayage sans attente. Réseau lent : seulement la suivante.
function prechargerGalerie() {
  const autres = images.petites.slice(1).filter((u) => u && !u.startsWith("data:"));
  if (!autres.length || navigator.connection?.saveData) return;
  const liste = niveauReseau() === "lent" ? autres.slice(0, 1) : autres;
  const lancer = () => liste.forEach((u) => prechargerImage(u, () => {}));
  const img = $("mainImg");
  if (img.complete) setTimeout(lancer, 300);
  else img.addEventListener("load", () => setTimeout(lancer, 300), { once: true });
}

// ---------- Variantes ----------
function varianteChoisie() {
  const dims = dimensions();
  if (!dims.length || dims.some((d) => !choix[d.key])) return null;
  return variantes.find((v) => dims.every((d) => v.options?.[d.key] === choix[d.key])) || null;
}
function possible(dimKey, valeur) {
  return variantes.some((v) => v.options?.[dimKey] === valeur && Object.entries(choix).every(([k, val]) => k === dimKey || v.options?.[k] === val));
}
function renderOptions() {
  const dims = dimensions().filter((d) => d.key !== "couleur");
  const box = $("options");
  box.hidden = !dims.length || !variantes.length;
  box.innerHTML = dims.map((dim) => {
    const valeurs = [...new Set(variantes.map((v) => v.options?.[dim.key]).filter(Boolean))];
    return `<div class="opt-group" role="group" aria-label="${escapeHTML(dim.label)}"><span class="lbl">${escapeHTML(dim.label)}${choix[dim.key] ? ` : <b>${escapeHTML(choix[dim.key])}</b>` : ""}</span><div class="opts">${valeurs.map((val) => {
      const dispo = possible(dim.key, val);
      return `<button type="button" class="optb" data-dim="${escapeHTML(dim.key)}" data-val="${escapeHTML(val)}" aria-pressed="${choix[dim.key] === val}"${dispo ? "" : ` disabled aria-label="${escapeHTML(val)}, indisponible"`}>${escapeHTML(val)}</button>`;
    }).join("")}</div></div>`;
  }).join("");
  const aCouleur = dimensions().some((d) => d.key === "couleur");
  const couleurs = [...new Set(variantes.map((v) => v.options?.couleur).filter(Boolean))];
  const c = $("couleurs");
  c.hidden = !aCouleur || !couleurs.length;
  c.innerHTML = `<span class="lbl">Couleur${choix.couleur ? ` : <b>${escapeHTML(choix.couleur)}</b>` : ""}</span><div class="opts" role="group" aria-label="Couleur">${couleurs.map((val) => {
    const hex = couleurHex(val);
    const dispo = possible("couleur", val);
    return `<button type="button" class="swatch${hex ? "" : " txt"}" data-dim="couleur" data-val="${escapeHTML(val)}" aria-pressed="${choix.couleur === val}" aria-label="${escapeHTML(val)}${dispo ? "" : ", indisponible"}"${hex ? ` style="background:${hex}"` : ""}${dispo ? "" : " disabled"}>${hex ? "" : escapeHTML(val)}</button>`;
  }).join("")}</div>`;
}
function onChoix(e) {
  const b = e.target.closest("button[data-dim]");
  if (!b || b.disabled) return;
  choix[b.dataset.dim] = b.dataset.val;
  renderOptions();
  majPrix();
  if (b.dataset.dim === "couleur") {
    const v = variantes.find((x) => x.options?.couleur === b.dataset.val && x.image);
    if (v) {
      annulerHD?.();
      $("mainImg").src = v.image;
    }
  }
  document.querySelector(`button[data-dim="${CSS.escape(b.dataset.dim)}"][data-val="${CSS.escape(b.dataset.val)}"]`)?.focus();
}
$("options").addEventListener("click", onChoix);
$("couleurs").addEventListener("click", onChoix);

// Une seule valeur possible pour une option : déjà choisie.
function preselection() {
  for (const d of dimensions()) {
    const valeurs = [...new Set(variantes.map((v) => v.options?.[d.key]).filter(Boolean))];
    if (valeurs.length === 1 && !choix[d.key]) choix[d.key] = valeurs[0];
  }
}

// Prix + état des boutons. Renvoie l'article à commander (ou null).
function articleCourant() {
  if (!produit) return null;
  if (dimensions().length) {
    const v = varianteChoisie();
    if (!v) return null;
    return { varianteId: v.id, varianteLibelle: v.libelle || null, prixUnitaire: prixFiche(produit, [], v).prix };
  }
  return { varianteId: null, varianteLibelle: null, prixUnitaire: prixFiche(produit).prix };
}
function majPrix() {
  const art = articleCourant();
  const choisie = art?.varianteId ? variantes.find((v) => v.id === art.varianteId) : null;
  $("pPrice").innerHTML = prixFicheHTML(moneyHTML, prixFiche(produit || {}, art ? [] : variantes, choisie));
  const ok = !!art && art.prixUnitaire > 0;
  $("btnPanier").disabled = !ok;
  $("btnCommander").disabled = !ok;
  $("btnCommander").setAttribute("aria-describedby", ok ? "" : "pErreur");
  if (!ok && dimensions().length && variantes.length) {
    $("pErreur").textContent = "Choisissez les options ci-dessus pour commander.";
    $("pErreur").className = "hint";
    $("pErreur").hidden = false;
    $("pErreur").setAttribute("role", "status");
  } else $("pErreur").hidden = true;
  majPartage(art);
}

// Lien WhatsApp : la photo, le nom et le prix de l'aperçu viennent des balises
// Open Graph de la page du produit.
function majPartage(art) {
  if (!produit) return;
  const nom = nomProduit(produit);
  const url = `https://bokki.shop${urlProduit(produit.id, nom)}`;
  const prix = art?.prixUnitaire > 0 ? ` à ${Math.round(art.prixUnitaire).toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ")} GNF` : "";
  const texte = `${nom}${prix} sur Bokki, payez à la livraison : ${url}`;
  $("btnPartager").href = `https://wa.me/?text=${encodeURIComponent(texte)}`;
  $("btnPartager").hidden = false;
}

// ---------- Quantité, panier, commande ----------
function majQuantite(n) {
  quantite = Math.max(1, Math.min(QTE_MAX, n));
  $("qVal").textContent = quantite;
  $("qMoins").disabled = quantite <= 1;
  $("qPlus").disabled = quantite >= QTE_MAX;
}
$("qMoins").addEventListener("click", () => majQuantite(quantite - 1));
$("qPlus").addEventListener("click", () => majQuantite(quantite + 1));

function articleComplet() {
  const art = articleCourant();
  if (!art) return null;
  return {
    produitId: productId,
    ...art,
    nom: nomProduit(produit),
    image: images.petites[0] || PLACEHOLDER_IMG,
    quantite,
  };
}
$("btnPanier").addEventListener("click", () => {
  const a = articleComplet();
  if (!a) return;
  ajouterArticle(a);
  signalerAjoutPanier();
  const b = $("btnPanier");
  b.querySelector("span").textContent = "Ajouté au panier";
  clearTimeout(b._t);
  b._t = setTimeout(() => (b.querySelector("span").textContent = "Ajouter au panier"), 1600);
});
// Test A/B en cours (js/mesures.js, page admin « Statistiques ») : libellé
// du bouton principal. A = « Commander », B = « Commander, payer à la livraison ».
if (window.bokkiVariante === "B") {
  const texte = [...$("btnCommander").childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
  if (texte) texte.textContent = "Commander, payer à la livraison";
}

$("btnCommander").addEventListener("click", async () => {
  const a = articleComplet();
  if (!a) return;
  demarrerCommande("direct", [a]);
  location.href = await lienEtapeCommande();
});

// ---------- Onglets ----------
const onglets = [...document.querySelectorAll('.tabs [role="tab"]')];
function activerOnglet(tab) {
  onglets.forEach((t) => {
    const on = t === tab;
    t.classList.toggle("on", on);
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  });
}
onglets.forEach((t, i) => {
  t.addEventListener("click", () => activerOnglet(t));
  t.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const n = onglets[(i + d + onglets.length) % onglets.length];
    activerOnglet(n);
    n.focus();
  });
});

// ---------- Caractéristiques ----------
function renderSpecs() {
  const infos = produit.infosGenerales || {};
  const car = produit.caracteristiques || {};
  const dims = new Set(dimensions().map((d) => d.key));
  const lignes = [];
  if (infos.marque) lignes.push(["Marque", infos.marque]);
  if (infos.modele) lignes.push(["Modèle", infos.modele]);
  if (infos.etat) lignes.push(["État", infos.etat]);
  for (const f of [...(config?.essentiel || []), ...(config?.secondaire || [])]) {
    if (!dims.has(f.key) && car[f.key] != null && car[f.key] !== "") lignes.push([f.label, Array.isArray(car[f.key]) ? car[f.key].join(", ") : car[f.key]]);
  }
  if (infos.garantie) lignes.push(["Garantie", infos.garantie]);
  $("specs").innerHTML = lignes.map(([l, v]) => `<div class="spec"><span class="muted">${escapeHTML(l)}</span><b>${escapeHTML(v)}</b></div>`).join("");
  $("specsVide").hidden = lignes.length > 0;
}

// ---------- Avis ----------
let tousLesAvis = false;
function renderAvis(avis) {
  $("pRating").hidden = false;
  $("avisResume").hidden = !avis.length;
  if (!avis.length) {
    $("pStars").textContent = etoiles(0);
    $("pStars").classList.add("stars-vides");
    $("pRatingTxt").textContent = "0 avis";
    $("avisListe").innerHTML = '<p class="muted small">Aucun avis pour l’instant. Les avis sont laissés après la livraison.</p>';
    $("avisPlus").hidden = true;
    return;
  }
  $("pStars").classList.remove("stars-vides");
  // Mêmes chiffres que sur les cartes ; à défaut, ceux des avis chargés.
  const moyenne = Number(produit?.noteMoyenne) || avis.reduce((s, a) => s + (a.note || 0), 0) / avis.length;
  const nb = produit?.nbAvis ? `${produit.nbAvis} avis` : avis.length === 50 ? "50 derniers avis" : `${avis.length} avis`;
  $("pStars").textContent = etoiles(moyenne);
  $("pRatingTxt").textContent = `${moyenne.toFixed(1).replace(".", ",")} sur 5 · ${nb}`;
  $("avisMoyenne").textContent = moyenne.toFixed(1).replace(".", ",");
  $("avisEtoiles").textContent = etoiles(moyenne);
  $("avisNombre").textContent = `${nb} · laissés après livraison`;
  $("avisResumeTab").innerHTML = `${escapeHTML(moyenne.toFixed(1).replace(".", ","))} sur 5 (${escapeHTML(nb)}). <a href="#avis">Lire les avis</a>`;
  const visibles = tousLesAvis ? avis : avis.slice(0, AVIS_APERCU);
  $("avisListe").innerHTML = visibles.map((a) => `
    <article class="card avis">
      <div class="avis-head"><span class="stars" aria-label="${a.note || 0} sur 5">${etoiles(a.note)}</span><span>${escapeHTML(dateAvis(a.dateCreation))}</span></div>
      <p>${a.commentaire ? escapeHTML(a.commentaire) : '<span class="muted">Aucun commentaire laissé.</span>'}</p>
      <div class="avis-auteur"><span class="avatar" aria-hidden="true">${escapeHTML(initiales(a.clientNom))}</span>${escapeHTML(a.clientNom || "Client Bokki")}</div>
    </article>`).join("");
  $("avisPlus").hidden = tousLesAvis || avis.length <= AVIS_APERCU;
}
let avisCourants = [];
$("avisPlus").querySelector("button").addEventListener("click", () => {
  tousLesAvis = true;
  renderAvis(avisCourants);
});

// ---------- Similaires ----------
let similaires = [];
let similairesCharges = false;
function chargerSimilaires(categorie) {
  if (similairesCharges || !categorie) return;
  similairesCharges = true;
  const afficherSim = (liste) => {
    similaires = liste.filter((p) => p.id !== productId).slice(0, 4);
    if (!similaires.length) return;
    $("similaires").hidden = false;
    $("simGrille").innerHTML = similaires.map((p) => carteProduitHTML(p)).join("");
  };
  requeteProduits({ categorie, limite: 5 }, afficherSim)
    .catch((err) => console.warn("Produits similaires indisponibles", err))
    .finally(chargerMoment);
}

// ---------- Sélection du moment (bas de page) ----------
let moment = [];
function chargerMoment() {
  const afficherMoment = (liste) => {
    const deja = new Set([productId, ...similaires.map((p) => p.id)]);
    moment = liste.filter((p) => !deja.has(p.id)).slice(0, 8);
    $("moment").hidden = !moment.length;
    $("momentRail").innerHTML = moment.map((p) => carteProduitHTML(p)).join("");
  };
  // Comme sur l'accueil : liste incomplète (calcul quotidien pas encore passé)
  // ou indisponible, complétée par les plus récents.
  requeteProduits({ selection: true, limite: 16 }, afficherMoment)
    .catch((err) => { console.warn("Sélection indisponible", err); return []; })
    .then((selection) => {
      if (selection.length >= 16) return null;
      const vus = new Set(selection.map((p) => p.id));
      return requeteProduits({ recents: true, limite: 16 }, (liste) => afficherMoment([...selection, ...liste.filter((p) => !vus.has(p.id))]));
    })
    .catch((err) => console.warn("Sélection indisponible", err));
}
brancherCartes($("momentRail"), (id) => moment.find((p) => p.id === id));
// Similaires visibles à l'écran : fiche préchargée.
brancherCartes($("simGrille"), (id) => similaires.find((p) => p.id === id), { prechargerVisibles: true });

// ---------- SEO ----------
function majSEO() {
  const nom = nomProduit(produit);
  const categorie = categorieProduit(produit);
  // Mêmes titre, description et données structurées que le pré-rendu.
  const seo = seoProduit(produit, { nom, categorie, slugCategorie: CATEGORY_SLUG[categorie] }, variantes, avisCourants);
  document.title = seo.titre;
  const meta = (sel, v) => document.querySelector(sel)?.setAttribute("content", v);
  meta('meta[name="description"]', seo.description);
  meta('meta[property="og:title"]', seo.titre);
  meta('meta[property="og:description"]', seo.description);
  meta('meta[property="og:url"]', seo.url);
  meta('meta[property="og:type"]', "product");
  meta('meta[name="twitter:title"]', seo.titre);
  meta('meta[name="twitter:description"]', seo.description);
  // Image de partage : celle du pré-rendu (1200 × 630) si la page en a une.
  const og = document.querySelector('meta[property="og:image"]');
  if (produit.images?.[0] && og && !og.content.includes("/og/")) {
    meta('meta[property="og:image"]', produit.images[0]);
    meta('meta[name="twitter:image"]', produit.images[0]);
  }
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = seo.url;
  let node = $("productStructuredData");
  if (!node) {
    node = document.createElement("script");
    node.type = "application/ld+json";
    node.id = "productStructuredData";
    document.head.append(node);
  }
  node.textContent = JSON.stringify(seo.jsonld);
}

// ---------- Rendu ----------
function render() {
  config = categorieConfig(categorieProduit(produit));
  const nom = nomProduit(produit);
  const categorie = categorieProduit(produit);
  const slug = CATEGORY_SLUG[categorie];
  $("crumbCat").textContent = categorie || "Catalogue";
  $("crumbCat").href = slug ? `/categorie/${slug}` : "/catalogue";
  $("simTout").href = $("crumbCat").href;
  $("crumbNom").textContent = nom;
  $("pCat").textContent = categorie;
  $("pTitle").textContent = nom;
  $("pFav").innerHTML = coeurHTML(produit.id, nom, "fav fav-lg");
  brancherCoeurs($("pFav"));
  $("pDesc").textContent = description(produit);
  $("pDesc").hidden = !description(produit);

  const hd = produit.images?.length ? produit.images : [PLACEHOLDER_IMG];
  // Vignettes 480 px seulement si elles gardent la photo entière.
  const petites = hd.map((u, i) => (produit.miniaturesEntieres && typeof produit.imagesSmall?.[i] === "string" && produit.imagesSmall[i]) || u);
  const changementPhotos = images.hd.join("|") !== hd.join("|");
  images = { hd, petites };
  $("mainImg").alt = hd.length > 1 ? `${nom}, photo ${photo + 1} sur ${hd.length}` : nom;
  if (changementPhotos) {
    $("thumbs").innerHTML = hd.length > 1
      ? petites.map((u, i) => `<button type="button" class="thumb" data-i="${i}" aria-label="Photo ${i + 1} sur ${hd.length}"><img src="${escapeHTML(u)}" alt="${escapeHTML(`${nom}, photo ${i + 1} sur ${hd.length}`)}" loading="lazy" width="52" height="52"/></button>`).join("")
      : "";
    $("galCompteur").hidden = hd.length < 2;
    $("galPrev").hidden = $("galNext").hidden = hd.length < 2;
    afficherPhoto(Math.min(photo, hd.length - 1));
    prechargerGalerie();
  }
  renderSpecs();
  preselection();
  renderOptions();
  majPrix();
  majSEO();
  if (premierRendu) majQuantite(1);
  premierRendu = false;
}

// Fiche sans produit (erreur réseau ou produit retiré) : seuls le message et
// son bouton restent à l'écran.
function ficheVide(titre, html) {
  document.body.classList.remove("p-chargement");
  document.body.classList.add("p-vide");
  $("pTitle").textContent = titre;
  $("pDesc").hidden = false;
  $("pDesc").innerHTML = html;
}

function erreur(msg) {
  ficheVide("Fiche produit indisponible", `${escapeHTML(msg)} <button type="button" class="btn btn-secondary btn-sm" id="pReessayer">Réessayer</button>`);
  $("pReessayer").addEventListener("click", () => location.reload());
}

function introuvable() {
  document.title = "Produit introuvable | Bokki";
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex";
  document.head.append(robots);
  ficheVide("Ce produit n’est plus disponible", `Il a peut-être été retiré de la boutique. <a class="btn btn-primary btn-sm" href="/catalogue">Voir les produits</a>`);
}

// Affichage immédiat : la fiche est d'abord dessinée avec ce que le
// téléphone connaît déjà (carte touchée sur l'accueil ou le catalogue,
// visite précédente), puis mise à jour dès que la version fraîche arrive.
function afficherProduit(p) {
  if (!p) return;
  const signature = JSON.stringify(p);
  if (produit && produit.__sig === signature) return;
  produit = { ...p, __sig: signature };
  document.body.classList.remove("p-chargement");
  render();
  chargerSimilaires(categorieProduit(produit));
  noterVue(p.id);
  if (!vueSuivie) {
    vueSuivie = true;
    suivrePub("vue_produit", { articles: [{ produitId: p.id, nom: nomProduit(p), prixUnitaire: prixFiche(p, []).prix, quantite: 1 }] });
  }
}

if (productId) {
  lireProduit(productId, (p, { source }) => {
    if (p === null && source === "reseau") introuvable();
    else afficherProduit(p);
  }).catch((err) => {
    console.warn("Fiche produit", err);
    if (!produit) erreur(navigator.onLine === false
      ? "Vous êtes hors ligne et cette fiche n’a pas encore été vue sur ce téléphone."
      : "Le réseau est trop lent ou coupé.");
  });
  lireVariantes(productId, (liste) => {
    variantes = liste;
    preselection();
    if (produit) {
      renderOptions();
      majPrix();
      majSEO();
    }
  }).catch((err) => console.warn("Variantes", err));
  lireAvis(productId, 50, (liste) => {
    avisCourants = liste;
    renderAvis(avisCourants);
    if (produit) majSEO();
  }).catch((err) => { console.warn("Avis", err); $("avis").hidden = true; });
}

afficherRecemment($("recemment"), $("recRail"), productId);

onCurrencyChange(() => {
  if (produit) majPrix();
  refreshCurrencyPrices();
});
