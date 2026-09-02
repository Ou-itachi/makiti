import { createApp, ref, computed, watch } from "https://unpkg.com/vue@3.5.42/dist/vue.esm-browser.prod.js";
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
import { PRODUIT_CATEGORIES, CATEGORIE_NOMS, categorieConfig, categorieADesVariantes } from "../produit-categories.js";

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
    let blob = await canvasToBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(canvas, "image/jpeg", quality);

    while (blob && blob.size > IMAGE_TARGET_BYTES && quality > 0.4) {
      quality -= 0.15;
      blob = await canvasToBlob(canvas, blob.type, quality);
    }

    return blob && blob.size < file.size ? blob : file;
  } catch (err) {
    console.error("Compression image échouée, envoi de l'original :", err);
    return file;
  }
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
    const pendingImages = ref([]); // [{file, url}]
    const fileInputRef = ref(null);

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

    watch(
      produits,
      (list) => {
        list.forEach((p) => {
          if (!(p.id in ventes.value)) loadVenduFor(p.id);
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
      pendingImages.value.forEach((item) => URL.revokeObjectURL(item.url));
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
    }

    function triggerFileSelect() {
      fileInputRef.value?.click();
    }

    function handleFileChange(e) {
      const files = Array.from(e.target.files || []);
      const total = existingImages.value.length + pendingImages.value.length + files.length;
      if (total > 5) {
        formError.value = "5 photos maximum par produit.";
      }
      const room = Math.max(0, 5 - existingImages.value.length - pendingImages.value.length);
      files.slice(0, room).forEach((f) => pendingImages.value.push({ file: f, url: URL.createObjectURL(f) }));
      e.target.value = "";
    }

    function removeExistingImage(idx) {
      existingImages.value.splice(idx, 1);
    }

    function removePendingImage(idx) {
      URL.revokeObjectURL(pendingImages.value[idx].url);
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
          blobVersFinal.set(item.url, url);
        }
        const images = [...existingImages.value, ...uploadedUrls];

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
        const data = {
          infosGenerales: { ...infosPubliques, nom, description },
          caracteristiques,
          images,
          fournisseurId: fournisseurIdFinal,
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
      const raw = sessionStorage.getItem("makiti-prefill-produit");
      sessionStorage.removeItem("makiti-prefill-produit");
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
      currentCategorieConfig,
      aDesVariantes,
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
      productMarginPct,
      onCategorieChange,
      addVarianteRow,
      removeVarianteRow,
      openModal,
      closeModal,
      triggerFileSelect,
      handleFileChange,
      removeExistingImage,
      removePendingImage,
      save,
      removeProduct,
    };
  },
}).mount("#produitsApp");
