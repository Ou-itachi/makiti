// Fiche produit (maquette design-refonte/maquettes/Produit.html).
// Reprend la logique de l'ancien produit-detail.js : variantes (chaque
// combinaison a son prix), pastilles de couleur, photo HD selon le réseau,
// avis, caractéristiques, SEO. « Commander » ne s'ouvre plus en fenêtre :
// il lance la commande en 2 étapes (/commande/identification).
import {
  carteProduitHTML, brancherCartes, escapeHTML, PLACEHOLDER_IMG,
  nomProduit, categorieProduit, CATEGORY_SLUG,
} from "./carte-produit.js";
import { lireProduit, lireVariantes, lireAvis, requeteProduits } from "./donnees.js";
import { categorieConfig, couleurHex } from "./produit-categories.js";
import { coeurHTML, brancherCoeurs } from "./favoris.js";
import { ajouterArticle } from "./panier-store.js";
import { moneyHTML, onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";
import { reseauLent, reseauRapide, surChangementReseau, prechargerImage, niveauReseau } from "./reseau.js";
import { demarrerCommande } from "./commande-store.js";
import { lienEtapeCommande } from "./commande-acces.js";

const QTE_MAX = 20;
const AVIS_APERCU = 4;
const $ = (id) => document.getElementById(id);

// Adresse /produit/<id> (pages pré-rendues) ; anciens liens /produit?id=… acceptés.
const productId = new URLSearchParams(location.search).get("id")
  || decodeURIComponent(location.pathname.match(/^\/produit\/([^/]+?)(?:\.html)?\/?$/)?.[1] || "") || null;
if (!productId) location.replace("/catalogue");

let produit = null;
let config = null;
let variantes = [];
let choix = {}; // { dimKey: valeur }
let quantite = 1;
let premierRendu = true;
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
const prixSansVariante = (p) => Number(p.caracteristiques?.prix ?? p.prixVente ?? 0) || 0;
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
// Balayage horizontal sur la photo (mobile)
let x0 = null;
$("mainImg").parentElement.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
$("mainImg").parentElement.addEventListener("touchend", (e) => {
  if (x0 == null) return;
  const dx = e.changedTouches[0].clientX - x0;
  x0 = null;
  if (Math.abs(dx) > 40 && images.hd.length > 1) afficherPhoto(photo + (dx < 0 ? 1 : -1));
}, { passive: true });
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
    return { varianteId: v.id, varianteLibelle: v.libelle || null, prixUnitaire: Number(v.prix) || 0 };
  }
  return { varianteId: null, varianteLibelle: null, prixUnitaire: prixSansVariante(produit) };
}
function majPrix() {
  const art = articleCourant();
  if (art) $("pPrice").innerHTML = moneyHTML(art.prixUnitaire);
  else {
    const prix = variantes.length ? Math.min(...variantes.map((v) => Number(v.prix) || 0)) : Number(produit?.caracteristiques?.prixMin) || 0;
    $("pPrice").innerHTML = `<span class="pfrom">Dès </span>${moneyHTML(prix)}`;
  }
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
  if (!avis.length) {
    $("avis").hidden = true;
    $("pRating").hidden = true;
    return;
  }
  const moyenne = avis.reduce((s, a) => s + (a.note || 0), 0) / avis.length;
  const nb = avis.length === 50 ? "50 derniers avis" : `${avis.length} avis`;
  $("avis").hidden = false;
  $("pRating").hidden = false;
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
  requeteProduits({ categorie, limite: 5 }, afficherSim).catch((err) => console.warn("Produits similaires indisponibles", err));
}
// Similaires visibles à l'écran : fiche préchargée.
brancherCartes($("simGrille"), (id) => similaires.find((p) => p.id === id), { prechargerVisibles: true });

// ---------- SEO ----------
function majSEO() {
  const nom = nomProduit(produit);
  const categorie = categorieProduit(produit);
  const url = `https://bokki.shop/produit/${encodeURIComponent(productId)}`;
  const desc = (description(produit) || `${nom} disponible chez Bokki, avec paiement à la livraison et sans avance.`).slice(0, 280);
  document.title = `Bokki | ${nom} — ${categorie}`;
  const meta = (sel, v) => document.querySelector(sel)?.setAttribute("content", v);
  meta('meta[name="description"]', `Bokki — ${desc} Paiement à la livraison.`.slice(0, 300));
  meta('meta[property="og:title"]', document.title);
  meta('meta[property="og:description"]', desc);
  meta('meta[property="og:url"]', url);
  meta('meta[property="og:type"]', "product");
  if (produit.images?.[0]) meta('meta[property="og:image"]', produit.images[0]);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = url;
  const prix = variantes.map((v) => Number(v.prix)).filter((p) => p > 0);
  const base = { url, priceCurrency: "GNF", availability: "https://schema.org/InStock", seller: { "@type": "Organization", name: "Bokki", url: "https://bokki.shop/" } };
  const p0 = prixSansVariante(produit) || Number(produit.caracteristiques?.prixMin) || 0;
  const offers = prix.length
    ? Math.max(...prix) > Math.min(...prix)
      ? { "@type": "AggregateOffer", ...base, lowPrice: Math.min(...prix), highPrice: Math.max(...prix), offerCount: prix.length }
      : { "@type": "Offer", ...base, price: prix[0] }
    : p0 > 0 ? { "@type": "Offer", ...base, price: p0 } : undefined;
  const slug = CATEGORY_SLUG[categorie];
  let node = $("productStructuredData");
  if (!node) {
    node = document.createElement("script");
    node.type = "application/ld+json";
    node.id = "productStructuredData";
    document.head.append(node);
  }
  node.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Product", "@id": `${url}#product`, name: nom, description: desc, category: categorie, sku: productId,
        image: (produit.images || []).filter((u) => typeof u === "string" && /^https:\/\//.test(u)),
        brand: produit.infosGenerales?.marque ? { "@type": "Brand", name: produit.infosGenerales.marque } : undefined, offers },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: "https://bokki.shop/" },
        { "@type": "ListItem", position: 2, name: categorie || "Catalogue", item: slug ? `https://bokki.shop/categorie/${slug}` : "https://bokki.shop/catalogue" },
        { "@type": "ListItem", position: 3, name: nom, item: url },
      ] },
    ],
  });
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
  $("mainImg").alt = `${nom}, photo du produit`;
  if (changementPhotos) {
    $("thumbs").innerHTML = hd.length > 1
      ? petites.map((u, i) => `<button type="button" class="thumb" data-i="${i}" aria-label="Photo ${i + 1} sur ${hd.length}"><img src="${escapeHTML(u)}" alt="" loading="lazy" width="52" height="52"/></button>`).join("")
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

function erreur(msg) {
  document.body.classList.remove("p-chargement");
  $("pTitle").textContent = "Fiche produit indisponible";
  $("pDesc").hidden = false;
  $("pDesc").innerHTML = `${escapeHTML(msg)} <button type="button" class="btn btn-secondary btn-sm" id="pReessayer">Réessayer</button>`;
  $("pReessayer").addEventListener("click", () => location.reload());
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
}

if (productId) {
  lireProduit(productId, (p, { source }) => {
    if (p === null && source === "reseau") location.replace("/catalogue");
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
  }).catch((err) => console.warn("Avis", err));
}

onCurrencyChange(() => {
  if (produit) majPrix();
  refreshCurrencyPrices();
});
