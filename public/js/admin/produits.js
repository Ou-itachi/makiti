import { createApp, ref, computed, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db, storage } from "../firebase-config.js";
import {
  collection,
  doc,
  onSnapshot,
  getDoc,
  getDocs,
  query,
  orderBy,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  getCountFromServer,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import { PRODUIT_CATEGORIES, CATEGORIE_NOMS, categorieConfig, categorieADesVariantes, infosConfig } from "../produit-categories.js";

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Crect width='400' height='400' fill='%2316233D'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='20' fill='%2393A4C3' text-anchor='middle' dominant-baseline='middle'%3EPas de photo%3C/text%3E%3C/svg%3E";

// Redimensionnement + compression côté client avant upload Storage : une
// photo prise au téléphone (plusieurs Mo, résolution bien au-delà de ce
// qu'affiche une fiche produit) est ensuite réutilisée telle quelle partout
// (carte catalogue, fiche détail, miniatures) — sans retouche ici, chaque
// affichage retélécharge l'original en entier. Vise <200 Ko via un plafond
// de résolution (1600px de long côté max) puis une qualité réduite par
// paliers si besoin.
const IMAGE_MAX_DIMENSION = 1600;
const IMAGE_TARGET_BYTES = 200 * 1024;

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function compressImage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale) || 1;
    const height = Math.round(bitmap.height * scale) || 1;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    let quality = 0.85;
    // Repli si le navigateur ne sait pas encoder en WebP : PNG pour une photo
    // détourée (le JPEG n'a pas de transparence, le fond deviendrait noir).
    let blob = await canvasToBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(canvas, file.type === "image/png" ? "image/png" : "image/jpeg", quality);

    while (blob && blob.size > IMAGE_TARGET_BYTES && quality > 0.4) {
      quality -= 0.15;
      blob = await canvasToBlob(canvas, blob.type, quality);
    }

    return blob || file;
  } catch (err) {
    console.error("Compression image échouée, envoi de l'original :", err);
    return file;
  }
}

async function makeProductThumbnail(file) {
  try {
    const bitmap = await createImageBitmap(file);
    // Photo ENTIÈRE réduite à 480 px max sur son plus grand côté, proportions
    // gardées : pas de recadrage carré (une télé, large, perdait ses côtés).
    // Le cadre carré de la carte client l'affiche en object-fit: contain.
    const side = 480;
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return await canvasToBlob(canvas, "image/webp", 0.78) || file;
  } catch (error) {
    console.warn("Miniature WebP non générée, utilisation de la photo originale", error);
    return file;
  }
}

// Détourage automatique (retrait de l'arrière-plan) des photos ajoutées ou
// prises dans le formulaire produit, entièrement dans le navigateur :
// @imgly/background-removal (modèle ISNet, AGPL-3.0 — sources :
// https://github.com/imgly/background-removal-js) servi depuis /vendor, le
// modèle étant téléchargé depuis staticimgly.com la première fois puis gardé
// en cache par le navigateur. Chargé à la demande seulement : la page
// produits ne paie rien tant qu'aucune photo n'est ajoutée.
let detourageModule = null;
// Sur téléphone, le modèle moyen (~88 Mo, plusieurs Go de mémoire en
// inférence) met des minutes à se télécharger en 4G et peut faire planter
// l'onglet : modèle léger (~44 Mo) sur écran tactile, moyen sur ordinateur.
const MODELE_DETOURAGE = matchMedia("(hover: none) and (pointer: coarse)").matches ? "isnet_quint8" : "isnet_fp16";
// Une seule photo traitée à la fois : le modèle occupe plusieurs centaines de
// Mo en mémoire, en lancer cinq en parallèle ferait planter un téléphone.
let fileDetourage = Promise.resolve();

function detourerPhoto(file, onProgress) {
  const tache = fileDetourage.then(async () => {
    detourageModule ??= await import("/vendor/background-removal-1.7.0.mjs");
    const blob = await detourageModule.removeBackground(file, {
      model: MODELE_DETOURAGE,
      output: { format: "image/png" },
      progress: (key, current, total) => {
        if (key.startsWith("fetch:") && total) onProgress?.(Math.round((current / total) * 100));
      },
    });
    const base = (file.name || "photo").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}-detouree.png`, { type: "image/png" });
  });
  fileDetourage = tache.catch(() => {});
  return tache;
}

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

// Prix d'affichage d'un produit, compatible ancien schéma plat (prixVente)
// et nouveau schéma (caracteristiques.prix ou caracteristiques.prixMin
// quand la catégorie a des variantes).
function prixAffiche(p) {
  return p.caracteristiques?.prixMin ?? p.caracteristiques?.prix ?? p.prixVente ?? 0;
}
function nomAffiche(p) {
  return p.infosGenerales?.nom ?? p.nom ?? "";
}
function categorieAffichee(p) {
  return p.infosGenerales?.categorie ?? p.categorie ?? "";
}

// Le nom du fournisseur n'est jamais dénormalisé sur le produit (seul
// fournisseurId l'est) : recherché en direct dans la liste des fournisseurs
// chargée en parallèle, pour ne jamais afficher un nom devenu obsolète si le
// fournisseur est renommé, et afficher "—" proprement s'il est supprimé.
function fournisseurNomFor(p, fournisseurs) {
  if (!p.fournisseurId) return "—";
  return fournisseurs.find((f) => f.id === p.fournisseurId)?.nom || "—";
}

function emptyForm() {
  return {
    infosGenerales: {
      nom: "",
      marque: "",
      modele: "",
      categorie: "",
      description: "",
      etat: "Neuf",
      garantie: "",
      prixAchat: 0,
    },
    caracteristiques: {},
    variantes: [],
    fournisseurId: null,
  };
}

function nextVarianteRow(dimensions) {
  const dimensionsVal = {};
  dimensions.forEach((d) => (dimensionsVal[d.key] = ""));
  return { id: null, dimensions: dimensionsVal, prix: 0, prixAchat: 0, reference: "", image: "" };
}

// Catégorie choisie sur le formulaire public "Demander un produit" -> même
// libellé côté catalogue admin (les deux listes sont désormais alignées).
// "Autre" et toute valeur inconnue -> "" : l'admin choisit lui-même la
// catégorie à la création du produit (jamais bloquant, juste non pré-rempli).
function mapDemandeCategorie(cat) {
  return PRODUIT_CATEGORIES[cat] ? cat : "";
}

async function fetchAsFile(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Téléchargement de la photo échoué (" + res.status + ")");
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

// v-visible="fn" : appelle fn une seule fois, quand l'élément approche de
// l'écran (200 px d'avance pour que les chiffres soient prêts au scroll).
const directiveVisible = {
  mounted(el, binding) {
    if (!("IntersectionObserver" in window)) {
      binding.value();
      return;
    }
    el._observateurVisible = new IntersectionObserver((entries, obs) => {
      if (entries.some((e) => e.isIntersecting)) {
        obs.disconnect();
        binding.value();
      }
    }, { rootMargin: "200px" });
    el._observateurVisible.observe(el);
  },
  unmounted(el) {
    el._observateurVisible?.disconnect();
  },
};

// Vignette 480 px pour les cartes (la photo originale fait jusqu'à 1600 px).
function imageCarte(p) {
  return (Array.isArray(p.imagesSmall) && p.imagesSmall[0]) || (Array.isArray(p.images) && p.images[0]) || PLACEHOLDER_IMG;
}

createApp({
  setup() {
    const produits = ref([]);
    const fournisseurs = ref([]);
    const searchTerm = ref("");
    const categoryFilter = ref("");
    const sortBy = ref("");

    const modalOpen = ref(false);
    const editingId = ref(null);
    const formError = ref("");
    // Le fournisseur d'un produit n'existe pas toujours encore dans le
    // système au moment d'ajouter le produit : plutôt que de forcer un
    // aller-retour par fournisseurs.html, "__nouveau__" révèle un champ nom
    // pour le créer directement ici (mêmes valeurs par défaut que
    // fournisseurs.js pour le reste — l'admin complète plus tard si besoin).
    const fournisseurChoix = ref("__aucun__");
    const nouveauFournisseurNom = ref("");
    const saving = ref(false);
    const form = ref(emptyForm());
    const existingImages = ref([]);
    const existingImageThumbs = ref([]);
    const existingImageWidths = ref([]);
    // [{file, url, original?, detouree?, etat?: "detourage" | "ok" | "erreur", progression?}]
    const pendingImages = ref([]);
    const fileInputRef = ref(null);
    const cameraInputRef = ref(null);
    // Choisi par le bouton qui a ouvert le sélecteur : true = arrière-plan
    // retiré automatiquement, false = photo ajoutée telle quelle.
    const retirerFond = ref(true);
    const photosEnTraitement = computed(() => pendingImages.value.some((item) => item.etat === "detourage"));
    const placesPhotos = computed(() => Math.max(0, 5 - existingImages.value.length - pendingImages.value.length));

    const tbDateText = computed(() => {
      const n = produits.value.length;
      return `${n} produit${n !== 1 ? "s" : ""} actif${n !== 1 ? "s" : ""}`;
    });

    // Pas de stock à afficher (dépôt-vente, quantité illimitée) : à la place,
    // le nombre d'unités vendues, compté via une requête agrégée sur les
    // commandes livrées de ce produit (même pattern que les stats livreur).
    const ventes = ref({});

    // Deux requêtes disjointes par construction : les commandes créées avant
    // l'évolution panier multi-articles portent produitId à plat, celles
    // créées depuis portent produitIds[] (tableau) — jamais les deux à la
    // fois sur un même document, donc les deux comptes s'additionnent sans
    // risque de double comptage.
    async function loadVenduFor(produitId) {
      ventes.value = { ...ventes.value, [produitId]: { loading: true } };
      try {
        const [ancien, nouveau] = await Promise.all([
          getCountFromServer(
            query(collection(db, "commandes"), where("produitId", "==", produitId), where("statut", "==", "livree"))
          ),
          getCountFromServer(
            query(collection(db, "commandes"), where("produitIds", "array-contains", produitId), where("statut", "==", "livree"))
          ),
        ]);
        const count = ancien.data().count + nouveau.data().count;
        ventes.value = { ...ventes.value, [produitId]: { loading: false, count } };
      } catch (err) {
        console.error(err);
        ventes.value = { ...ventes.value, [produitId]: { loading: false, error: true } };
      }
    }
    function venduFor(produitId) {
      return ventes.value[produitId] || { loading: true };
    }

    // Prix d'achat : jamais sur le document produit/variante lui-même
    // (lisible publiquement), lu à part depuis la sous-collection admin
    // produits/{id}/interne/achat pour l'affichage (marge, "Achat: X").
    const achatInterne = ref({});
    async function loadAchatFor(produitId) {
      try {
        const snap = await getDoc(doc(db, "produits", produitId, "interne", "achat"));
        achatInterne.value = { ...achatInterne.value, [produitId]: snap.exists() ? snap.data() : {} };
      } catch (err) {
        console.error(err);
        achatInterne.value = { ...achatInterne.value, [produitId]: {} };
      }
    }
    function prixAchatAffiche(p) {
      const achat = achatInterne.value[p.id];
      if (!achat) return 0;
      if (achat.parVariante) {
        const valeurs = Object.values(achat.parVariante).map((v) => Number(v) || 0);
        return valeurs.length ? Math.min(...valeurs) : 0;
      }
      return Number(achat.prixAchat) || 0;
    }
    function productMarginPct(p) {
      const achat = prixAchatAffiche(p);
      const vente = prixAffiche(p);
      return achat > 0 ? Math.round(((vente - achat) / achat) * 100) : 0;
    }
    function marginRatio(p) {
      const achat = prixAchatAffiche(p);
      const vente = prixAffiche(p);
      return achat > 0 ? (vente - achat) / achat : 0;
    }

    // Stats d'une carte (nombre de ventes, 2 comptages) chargées seulement quand
    // elle devient visible (directive v-visible) : avant, 3 requêtes par
    // produit partaient toutes à l'ouverture de la page, soit des centaines
    // sur un gros catalogue en réseau mobile.
    function chargerStatsProduit(produitId) {
      if (!(produitId in ventes.value)) loadVenduFor(produitId);
    }
    // Le tri par marge a besoin du prix d'achat de TOUT le catalogue : chargé
    // uniquement si l'admin choisit ce tri.
    watch(
      [sortBy, produits],
      ([tri, list]) => {
        if (tri !== "margin-desc") return;
        list.forEach((p) => {
          if (!(p.id in achatInterne.value)) loadAchatFor(p.id);
        });
      },
      { immediate: true }
    );

    const filteredProducts = computed(() => {
      const term = searchTerm.value.trim().toLowerCase();
      let list = produits.value.filter((p) => {
        if (term && !nomAffiche(p).toLowerCase().includes(term)) return false;
        if (categoryFilter.value && categorieAffichee(p) !== categoryFilter.value) return false;
        return true;
      });
      if (sortBy.value === "margin-desc") {
        list = [...list].sort((a, b) => marginRatio(b) - marginRatio(a));
      } else if (sortBy.value === "price-desc") {
        list = [...list].sort((a, b) => prixAffiche(b) - prixAffiche(a));
      }
      return list;
    });

    const modalTag = computed(() => (editingId.value ? "Modification" : "Nouveau"));
    const modalTitle = computed(() => (editingId.value ? "Modifier le produit" : "Ajouter un produit"));

    const currentCategorieConfig = computed(() => categorieConfig(form.value.infosGenerales.categorie));
    const aDesVariantes = computed(() => categorieADesVariantes(form.value.infosGenerales.categorie));

    // En-tête du formulaire adapté à la catégorie : « Modèle » et « Garantie »
    // n'apparaissent que là où ils ont du sens, et les exemples (placeholder)
    // parlent le vocabulaire de la catégorie choisie.
    const infosCfg = computed(() => infosConfig(form.value.infosGenerales.categorie));
    const marqueOptionnelle = computed(() => /optionnel/i.test(infosCfg.value.exemples.marque || ""));

    // Les champs essentiel/secondaire qui sont AUSSI des dimensions de
    // variante (ex. stockage/couleur pour les téléphones) ne doivent pas être
    // redemandés ici : leur valeur vit par variante (une seule combinaison ne
    // peut pas résumer un produit qui existe en 128 Go ET 256 Go), pas au
    // niveau du produit.
    const dimensionKeys = computed(
      () => new Set((currentCategorieConfig.value?.variantes?.dimensions || []).map((d) => d.key))
    );
    const essentielAffiches = computed(
      () => (currentCategorieConfig.value?.essentiel || []).filter((f) => !dimensionKeys.value.has(f.key))
    );
    const secondaireAffiches = computed(
      () => (currentCategorieConfig.value?.secondaire || []).filter((f) => !dimensionKeys.value.has(f.key))
    );

    // Pastilles de couleur (fiche produit) : cliquer sur une couleur change
    // aussi l'image affichée, donc chaque variante couleur peut avoir sa
    // propre photo parmi celles déjà téléversées pour ce produit.
    const aDimensionCouleur = computed(() => dimensionKeys.value.has("couleur"));
    const toutesLesImages = computed(() => [
      ...existingImages.value,
      ...pendingImages.value.map((item) => item.url),
    ]);

    // Marge affichée dans le formulaire : au niveau produit si pas de
    // variantes, sinon calculée par ligne de variante directement dans le
    // tableau (chaque variante a son propre coût potentiellement différent).
    const marginPct = computed(() => {
      const buy = Number(form.value.infosGenerales.prixAchat) || 0;
      const sell = Number(form.value.caracteristiques.prix) || 0;
      return buy > 0 ? Math.round(((sell - buy) / buy) * 100) : 0;
    });
    const marginAmtText = computed(() => {
      const buy = Number(form.value.infosGenerales.prixAchat) || 0;
      const sell = Number(form.value.caracteristiques.prix) || 0;
      return fmt(sell - buy) + " GNF de marge";
    });

    function resetPendingImages() {
      pendingImages.value.forEach(revokeApercus);
      pendingImages.value = [];
    }

    function onCategorieChange() {
      // Les champs essentiel/secondaire ne sont pas les mêmes d'une
      // catégorie à l'autre : repartir d'un bloc caractéristiques propre
      // évite de garder des champs qui n'existent plus pour la catégorie
      // choisie.
      form.value.caracteristiques = {};
      form.value.variantes = aDesVariantes.value
        ? [nextVarianteRow(currentCategorieConfig.value.variantes.dimensions)]
        : [];
      // Idem pour l'en-tête : si la nouvelle catégorie n'a pas de « Modèle »
      // ou de « Garantie », on efface la valeur pour ne pas publier un champ
      // masqué resté rempli d'une catégorie précédente.
      if (!infosCfg.value.modele) form.value.infosGenerales.modele = "";
      if (!infosCfg.value.garantie) form.value.infosGenerales.garantie = "";
    }

    function addVarianteRow() {
      form.value.variantes.push(nextVarianteRow(currentCategorieConfig.value.variantes.dimensions));
    }
    function removeVarianteRow(idx) {
      form.value.variantes.splice(idx, 1);
    }

    async function openModal(product) {
      formError.value = "";
      resetPendingImages();
      nouveauFournisseurNom.value = "";
      if (product) {
        editingId.value = product.id;
        const categorie = categorieAffichee(product) || CATEGORIE_NOMS[0];
        const achatSnap = await getDoc(doc(db, "produits", product.id, "interne", "achat"));
        const achat = achatSnap.exists() ? achatSnap.data() : {};
        form.value = {
          infosGenerales: {
            nom: product.infosGenerales?.nom ?? product.nom ?? "",
            marque: product.infosGenerales?.marque ?? "",
            modele: product.infosGenerales?.modele ?? "",
            categorie,
            description: product.infosGenerales?.description ?? product.description ?? "",
            etat: product.infosGenerales?.etat ?? "Neuf",
            garantie: product.infosGenerales?.garantie ?? "",
            prixAchat: achat.prixAchat ?? 0,
          },
          caracteristiques: { ...(product.caracteristiques || {}) },
          variantes: [],
          fournisseurId: product.fournisseurId || null,
        };
        fournisseurChoix.value = product.fournisseurId || "__aucun__";
        existingImages.value = Array.isArray(product.images) ? [...product.images] : [];
        existingImageThumbs.value = existingImages.value.map((_, index) => product.imagesSmall?.[index] || "");
        existingImageWidths.value = existingImages.value.map((_, index) => Number(product.imageWidths?.[index]) || 0);

        if (categorieADesVariantes(categorie)) {
          const snap = await getDocs(collection(db, "produits", product.id, "variantes"));
          form.value.variantes = snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              dimensions: { ...(data.options || {}) },
              prix: data.prix || 0,
              prixAchat: achat.parVariante?.[d.id] || 0,
              reference: data.reference || "",
              image: data.image || "",
            };
          });
          if (!form.value.variantes.length) {
            form.value.variantes = [nextVarianteRow(categorieConfig(categorie).variantes.dimensions)];
          }
        }
      } else {
        editingId.value = null;
        form.value = emptyForm();
        fournisseurChoix.value = "__aucun__";
        existingImages.value = [];
        existingImageThumbs.value = [];
        existingImageWidths.value = [];
      }
      modalOpen.value = true;
    }

    // Ouvre le formulaire "Nouveau produit" pré-rempli depuis une demande de
    // produit hors catalogue marquée "Trouvée" (admin-11-demandes-produits.js
    // écrit le passage de relais dans sessionStorage puis redirige ici).
    // Les photos sont re-téléchargées puis traitées comme pendingImages
    // normales : au save(), elles seront re-uploadées sous produits/{id}/…
    // plutôt que de garder un lien vers demandes-produits/… (dossier
    // admin-only, dont le cycle de vie ne doit pas être lié à celui du
    // produit publié).
    async function openModalFromDemande(prefill) {
      await openModal(null);
      form.value.infosGenerales.nom = prefill.nom || "";
      form.value.infosGenerales.categorie = mapDemandeCategorie(prefill.categorie);
      onCategorieChange();

      const photoUrls = Array.isArray(prefill.photoUrls) ? prefill.photoUrls.slice(0, 5) : [];
      if (photoUrls.length) {
        try {
          const files = await Promise.all(
            photoUrls.map((url, i) => fetchAsFile(url, `demande-${i}.jpg`))
          );
          files.forEach((file) => pendingImages.value.push({ file, url: URL.createObjectURL(file) }));
        } catch (err) {
          console.error(err);
          formError.value =
            "Nom et catégorie pré-remplis, mais les photos de la demande n'ont pas pu être récupérées automatiquement — ajoute-les manuellement.";
        }
      }
    }

    function closeModal() {
      modalOpen.value = false;
      editingId.value = null;
      resetPendingImages();
      existingImages.value = [];
      existingImageThumbs.value = [];
      existingImageWidths.value = [];
    }

    function triggerFileSelect(detourer = true) {
      retirerFond.value = detourer;
      fileInputRef.value?.click();
    }

    function triggerCamera(detourer = true) {
      retirerFond.value = detourer;
      cameraInputRef.value?.click();
    }

    // L'aperçu local (blob:) d'une photo peut déjà avoir été choisi comme
    // photo d'une variante couleur : on suit le changement d'URL quand la
    // version détourée remplace l'originale (ou l'inverse).
    function changerApercu(item, file) {
      const ancienneUrl = item.url;
      item.file = file;
      item.url = URL.createObjectURL(file);
      form.value.variantes.forEach((row) => {
        if (row.image === ancienneUrl) row.image = item.url;
      });
      if (ancienneUrl !== item.original?.url && ancienneUrl !== item.detouree?.url) URL.revokeObjectURL(ancienneUrl);
    }

    async function lancerDetourage(item) {
      item.etat = "detourage";
      item.progression = 0;
      try {
        const detouree = await detourerPhoto(item.original.file, (pct) => (item.progression = pct));
        // Photo retirée, ou produit enregistré avec la photo d'origine
        // pendant le traitement : rien à mettre à jour.
        if (!pendingImages.value.includes(item) || item.etat !== "detourage") return;
        changerApercu(item, detouree);
        item.detouree = { file: detouree, url: item.url };
        item.etat = "ok";
      } catch (err) {
        console.error("Détourage échoué, photo originale conservée :", err);
        if (item.etat === "detourage") item.etat = "erreur";
      }
    }

    function handleFileChange(e) {
      const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
      e.target.value = "";
      if (files.length > placesPhotos.value) {
        formError.value = "5 photos maximum par produit.";
      }
      files.slice(0, placesPhotos.value).forEach((f) => {
        const url = URL.createObjectURL(f);
        pendingImages.value.push({ file: f, url, original: { file: f, url } });
        // Relu depuis le tableau réactif pour que les changements d'état
        // (progression, aperçu détouré) rafraîchissent la vignette.
        if (retirerFond.value) lancerDetourage(pendingImages.value[pendingImages.value.length - 1]);
      });
    }

    // Bascule entre la version détourée et la photo d'origine, si le
    // détourage a mangé une partie du produit (ex. objet blanc sur fond blanc).
    function basculerDetourage(idx) {
      const item = pendingImages.value[idx];
      // Photo ajoutée telle quelle : le détourage peut encore être demandé.
      if (!item.detouree) {
        if (item.original && !item.etat) lancerDetourage(item);
        return;
      }
      const cible = item.file === item.detouree.file ? item.original : item.detouree;
      const ancienneUrl = item.url;
      item.file = cible.file;
      item.url = cible.url;
      form.value.variantes.forEach((row) => {
        if (row.image === ancienneUrl) row.image = item.url;
      });
    }

    function removeExistingImage(idx) {
      existingImages.value.splice(idx, 1);
      existingImageThumbs.value.splice(idx, 1);
      existingImageWidths.value.splice(idx, 1);
    }

    function revokeApercus(item) {
      new Set([item.url, item.original?.url, item.detouree?.url].filter(Boolean)).forEach((url) => URL.revokeObjectURL(url));
    }

    function removePendingImage(idx) {
      revokeApercus(pendingImages.value[idx]);
      pendingImages.value.splice(idx, 1);
    }

    function varianteLibelle(row, dimensions) {
      return dimensions
        .map((d) => row.dimensions[d.key])
        .filter(Boolean)
        .join(" · ");
    }

    async function save() {
      formError.value = "";
      const infos = form.value.infosGenerales;
      const nom = infos.nom.trim();
      const categorie = infos.categorie;
      const config = categorieConfig(categorie);

      if (!nom) return (formError.value = "Le nom du produit est obligatoire.");
      if (!categorie || !config) return (formError.value = "La catégorie est obligatoire.");

      const hasVariantes = categorieADesVariantes(categorie);
      const dimensions = hasVariantes ? config.variantes.dimensions : [];

      if (hasVariantes) {
        const rows = form.value.variantes;
        if (!rows.length) return (formError.value = "Ajoute au moins une variante (combinaison d'options).");
        for (const row of rows) {
          if (dimensions.some((d) => !String(row.dimensions[d.key] || "").trim())) {
            return (formError.value = "Renseigne toutes les options de chaque variante.");
          }
          if (!(Number(row.prix) > 0)) {
            return (formError.value = "Chaque variante doit avoir un prix supérieur à 0.");
          }
        }
      } else {
        if (!(Number(form.value.caracteristiques.prix) > 0)) {
          return (formError.value = "Le prix de vente doit être supérieur à 0.");
        }
      }

      const nouveauFournisseurNomTrim = nouveauFournisseurNom.value.trim();
      if (fournisseurChoix.value === "__nouveau__" && !nouveauFournisseurNomTrim) {
        return (formError.value = "Renseigne le nom du nouveau fournisseur, ou choisis « Aucun fournisseur lié ».");
      }

      // Le détourage ne bloque jamais l'enregistrement (sur téléphone il peut
      // prendre plusieurs minutes, voire ne jamais finir) : une photo encore
      // en traitement part telle quelle, version d'origine.
      pendingImages.value.forEach((item) => {
        if (item.etat === "detourage") item.etat = "abandonne";
      });

      saving.value = true;
      try {
        // Le fournisseur choisi ici n'existait peut-être pas encore : on le
        // crée avant le produit s'il faut, avec les mêmes valeurs par défaut
        // que fournisseurs.js (l'admin complète le reste plus tard si besoin).
        let fournisseurIdFinal = null;
        if (fournisseurChoix.value === "__nouveau__") {
          const fournisseurRef = doc(collection(db, "fournisseurs"));
          await setDoc(fournisseurRef, {
            nom: nouveauFournisseurNomTrim,
            telephone: "",
            categoriePrincipale: CATEGORIE_NOMS[0] || "",
            adresse: "",
            note: "",
            montantDu: 0,
            dateCreation: serverTimestamp(),
          });
          fournisseurIdFinal = fournisseurRef.id;
        } else if (fournisseurChoix.value !== "__aucun__") {
          fournisseurIdFinal = fournisseurChoix.value;
        }

        const docRef = editingId.value ? doc(db, "produits", editingId.value) : doc(collection(db, "produits"));
        const uploadedUrls = [];
        const uploadedThumbUrls = [];
        const uploadedImageWidths = [];
        // Les aperçus locaux (blob:) choisis comme photo d'une variante
        // couleur doivent être traduits vers l'URL Storage définitive une
        // fois l'upload fait, sinon on enregistrerait un lien local mort.
        const blobVersFinal = new Map();
        for (const item of pendingImages.value) {
          const compressed = await compressImage(item.file);
          const ext = compressed.type === "image/webp" ? "webp" : compressed.type === "image/jpeg" ? "jpg" : (item.file.name.split(".").pop() || "jpg");
          const path = `produits/${docRef.id}/${Date.now()}-photo.${ext}`;
          const fileRef = storageRef(storage, path);
          await uploadBytes(fileRef, compressed, { contentType: compressed.type || item.file.type });
          const url = await getDownloadURL(fileRef);
          uploadedUrls.push(url);
          const bitmap = await createImageBitmap(compressed);
          uploadedImageWidths.push(bitmap.width);
          bitmap.close?.();
          const thumbnail = await makeProductThumbnail(item.file);
          const thumbnailExt = thumbnail.type === "image/webp" ? "webp" : "jpg";
          const thumbnailPath = `produits/${docRef.id}/${Date.now()}-photo-480.${thumbnailExt}`;
          const thumbnailRef = storageRef(storage, thumbnailPath);
          await uploadBytes(thumbnailRef, thumbnail, { contentType: thumbnail.type || item.file.type });
          uploadedThumbUrls.push(await getDownloadURL(thumbnailRef));
          blobVersFinal.set(item.url, url);
        }
        const images = [...existingImages.value, ...uploadedUrls];
        const imagesSmall = [...existingImageThumbs.value, ...uploadedThumbUrls];
        const imageWidths = [...existingImageWidths.value, ...uploadedImageWidths];

        // Caractéristiques = champs essentiel/secondaire saisis par l'admin
        // + prix direct si la catégorie n'a pas de variantes, ou prixMin
        // dénormalisé sinon (évite un listener par produit pour afficher la
        // liste/catalogue). Pas de stock : Bokki n'a pas d'entrepôt, les
        // produits sont pris en dépôt-vente et toujours commandables — un
        // ancien champ stock/stockTotal (produits créés avant ce ticket) est
        // nettoyé à la première modification.
        const caracteristiques = { ...form.value.caracteristiques };
        delete caracteristiques.stock;
        delete caracteristiques.stockTotal;
        if (hasVariantes) {
          delete caracteristiques.prix;
          caracteristiques.prixMin = Math.min(...form.value.variantes.map((r) => Number(r.prix) || 0));
          // Les dimensions de variante (stockage, couleur…) n'ont pas de
          // valeur unique au niveau produit — on dénormalise l'ensemble des
          // valeurs utilisées par les variantes, pour que le catalogue/les
          // filtres client puissent les lire sans requêter la sous-collection.
          dimensions.forEach((d) => {
            caracteristiques[d.key] = [...new Set(form.value.variantes.map((r) => r.dimensions[d.key]).filter(Boolean))];
          });
        } else {
          delete caracteristiques.prixMin;
        }
        delete caracteristiques.prixAchatMin;

        // Champs constants : jamais demandés à l'admin, jamais filtrables —
        // glissés une seule fois dans la description générale (texte libre),
        // pas stockés comme caractéristiques structurées.
        let description = (infos.description || "").trim();
        const constantText = (config.constant || []).map((c) => c.valeur).join(". ");
        if (constantText && !description.includes(constantText)) {
          description = description ? description + "\n\n" + constantText : constantText;
        }

        // prixAchat n'est jamais écrit ici : ce document produit est lisible
        // publiquement (catalogue), voir produits/{id}/interne/achat plus bas.
        const infosPubliques = { ...infos };
        delete infosPubliques.prixAchat;
        // Marqueur « miniatures non recadrées » : vrai si toutes les miniatures
        // viennent du générateur actuel (nouvelles photos seulement, ou produit
        // déjà marqué). Sinon le bouton « Recalculer les miniatures » s'en charge.
        const produitAvant = editingId.value ? produits.value.find((p) => p.id === editingId.value) : null;
        const miniaturesEntieres = existingImages.value.length === 0 || !!produitAvant?.miniaturesEntieres;
        const data = {
          infosGenerales: { ...infosPubliques, nom, description },
          caracteristiques,
          images,
          imagesSmall,
          imageWidths,
          miniaturesEntieres,
          fournisseurId: fournisseurIdFinal,
          dateModification: serverTimestamp(),
        };

        if (editingId.value) {
          await updateDoc(docRef, data);
        } else {
          await setDoc(docRef, { ...data, dateCreation: serverTimestamp() });
        }

        // Prix d'achat : jamais sur produits/{id} ni produits/{id}/variantes/{vid}
        // (tous deux lisibles publiquement) — écrit à part dans
        // produits/{id}/interne/achat, réservé à l'admin (voir firestore.rules).
        const achatInterneRef = doc(db, "produits", docRef.id, "interne", "achat");

        if (hasVariantes) {
          const existingSnap = editingId.value
            ? await getDocs(collection(db, "produits", docRef.id, "variantes"))
            : { docs: [] };
          const existingIds = new Set(existingSnap.docs.map((d) => d.id));
          const keptIds = new Set(form.value.variantes.filter((r) => r.id).map((r) => r.id));

          const batch = writeBatch(db);
          const parVariante = {};
          for (const row of form.value.variantes) {
            const varianteData = {
              libelle: varianteLibelle(row, dimensions),
              options: { ...row.dimensions },
              prix: Number(row.prix) || 0,
              reference: (row.reference || "").trim(),
              image: row.image ? blobVersFinal.get(row.image) || row.image : null,
            };
            const varianteRef = row.id
              ? doc(db, "produits", docRef.id, "variantes", row.id)
              : doc(collection(db, "produits", docRef.id, "variantes"));
            batch.set(varianteRef, varianteData);
            parVariante[varianteRef.id] = Number(row.prixAchat) || 0;
          }
          for (const existingId of existingIds) {
            if (!keptIds.has(existingId)) {
              batch.delete(doc(db, "produits", docRef.id, "variantes", existingId));
            }
          }
          await batch.commit();
          await setDoc(achatInterneRef, { parVariante });
        } else {
          await setDoc(achatInterneRef, { prixAchat: Number(infos.prixAchat) || 0 });
        }

        // Le cache prix d'achat (donc la marge affichée sur la carte) est
        // peuplé par watch(produits) au moment où onSnapshot livre le
        // document produit — ce qui a lieu AVANT l'écriture de interne/achat
        // juste au-dessus. Sans ce rafraîchissement explicite, la carte du
        // produit qu'on vient de créer/modifier affiche « Achat 0 / marge
        // 0 % » jusqu'au prochain rechargement de la page.
        await loadAchatFor(docRef.id);

        closeModal();
      } catch (err) {
        console.error(err);
        formError.value = "Erreur lors de l'enregistrement : " + (err.message || err.code || "réessaie.");
      } finally {
        saving.value = false;
      }
    }

    async function removeProduct(p) {
      if (!confirm(`Supprimer « ${nomAffiche(p)} » ? Cette action est irréversible.`)) return;
      try {
        if (categorieADesVariantes(categorieAffichee(p))) {
          const snap = await getDocs(collection(db, "produits", p.id, "variantes"));
          const batch = writeBatch(db);
          snap.docs.forEach((d) => batch.delete(d.ref));
          if (snap.docs.length) await batch.commit();
        }
        await deleteDoc(doc(db, "produits", p.id, "interne", "achat"));
        await deleteDoc(doc(db, "produits", p.id));
        for (const url of p.images || []) {
          try {
            await deleteObject(storageRef(storage, url));
          } catch (e) {
            // image déjà absente du Storage, on ignore
          }
        }
      } catch (err) {
        console.error(err);
        alert("Erreur lors de la suppression : " + (err.message || err.code || "réessaie."));
      }
    }

    // Les anciennes miniatures 480 px étaient recadrées en carré (une télé,
    // large, perdait ses côtés). On les recalcule depuis les photos
    // originales (jamais recadrées) pour chaque produit sans le marqueur
    // miniaturesEntieres, puis on pose le marqueur.
    const miniaturesARefaire = computed(() => produits.value.filter((p) => !p.miniaturesEntieres && Array.isArray(p.images) && p.images.length));
    const regenEnCours = ref(false);
    const regenProgression = ref("");

    async function regenererMiniatures() {
      if (regenEnCours.value) return;
      const liste = [...miniaturesARefaire.value];
      if (!liste.length) return;
      regenEnCours.value = true;
      let faits = 0;
      let echecs = 0;
      try {
        for (const p of liste) {
          regenProgression.value = `${faits + echecs + 1}/${liste.length}`;
          try {
            const imagesSmall = [];
            for (let i = 0; i < p.images.length; i++) {
              const original = await fetchAsFile(p.images[i], `photo-${i}`);
              const thumbnail = await makeProductThumbnail(original);
              if (thumbnail === original) throw new Error("miniature non générée");
              const ext = thumbnail.type === "image/webp" ? "webp" : "jpg";
              const path = `produits/${p.id}/${Date.now()}-${i}-photo-480.${ext}`;
              const thumbRef = storageRef(storage, path);
              await uploadBytes(thumbRef, thumbnail, { contentType: thumbnail.type });
              imagesSmall.push(await getDownloadURL(thumbRef));
            }
            const anciennes = Array.isArray(p.imagesSmall) ? p.imagesSmall : [];
            await updateDoc(doc(db, "produits", p.id), { imagesSmall, miniaturesEntieres: true });
            // Ancien fichier recadré : supprimé seulement après la mise à jour
            // du produit, et sans bloquer si la suppression échoue.
            for (const url of anciennes) {
              if (url && !imagesSmall.includes(url)) {
                deleteObject(storageRef(storage, url)).catch(() => {});
              }
            }
            faits++;
          } catch (err) {
            echecs++;
            console.error("Miniatures non recalculées pour", p.id, err);
          }
        }
      } finally {
        regenEnCours.value = false;
        regenProgression.value = "";
      }
      alert(`Miniatures recalculées : ${faits} produit(s).` + (echecs ? ` Échecs : ${echecs} (voir la console).` : ""));
    }

    onSnapshot(query(collection(db, "produits"), orderBy("dateCreation", "desc")), (snap) => {
      produits.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });

    onSnapshot(query(collection(db, "fournisseurs"), orderBy("nom")), (snap) => {
      fournisseurs.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });

    function fournisseurNomForProduct(p) {
      return fournisseurNomFor(p, fournisseurs.value);
    }

    // Arrivée depuis "Créer une fiche produit" (admin-11-demandes-produits) :
    // ?prefill=1 dans l'URL signale qu'un pré-remplissage attend dans
    // sessionStorage. Consommé une seule fois puis nettoyé (clé + URL), pour
    // qu'un rechargement de la page ne rouvre pas le formulaire.
    const params = new URLSearchParams(location.search);
    if (params.get("prefill") === "1") {
      const raw = sessionStorage.getItem("bokki-prefill-produit");
      sessionStorage.removeItem("bokki-prefill-produit");
      history.replaceState(null, "", location.pathname);
      if (raw) {
        try {
          openModalFromDemande(JSON.parse(raw));
        } catch (err) {
          console.error(err);
        }
      }
    }

    return {
      miniaturesARefaire,
      regenEnCours,
      regenProgression,
      regenererMiniatures,
      PLACEHOLDER_IMG,
      CATEGORIE_NOMS,
      fournisseurs,
      fournisseurNomForProduct,
      searchTerm,
      categoryFilter,
      sortBy,
      filteredProducts,
      tbDateText,
      modalOpen,
      modalTag,
      modalTitle,
      formError,
      saving,
      form,
      fournisseurChoix,
      nouveauFournisseurNom,
      existingImages,
      pendingImages,
      fileInputRef,
      cameraInputRef,
      photosEnTraitement,
      placesPhotos,
      currentCategorieConfig,
      aDesVariantes,
      infosCfg,
      marqueOptionnelle,
      essentielAffiches,
      secondaireAffiches,
      aDimensionCouleur,
      toutesLesImages,
      marginPct,
      marginAmtText,
      fmt,
      nomAffiche,
      categorieAffichee,
      prixAffiche,
      prixAchatAffiche,
      ventes,
      venduFor,
      chargerStatsProduit,
      imageCarte,
      productMarginPct,
      onCategorieChange,
      addVarianteRow,
      removeVarianteRow,
      openModal,
      closeModal,
      triggerFileSelect,
      triggerCamera,
      handleFileChange,
      basculerDetourage,
      removeExistingImage,
      removePendingImage,
      save,
      removeProduct,
    };
  },
}).directive("visible", directiveVisible).mount("#produitsApp");
