import { createApp, ref, computed } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { db, storage } from "../firebase-config.js";
import {
  collection,
  doc,
  onSnapshot,
  getDocs,
  query,
  orderBy,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
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

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

// Prix/stock d'affichage d'un produit, compatibles ancien schéma plat
// (prixVente/stock) et nouveau schéma (caracteristiques.prix/stock ou
// caracteristiques.prixMin/stockTotal quand la catégorie a des variantes).
function prixAffiche(p) {
  return p.caracteristiques?.prixMin ?? p.caracteristiques?.prix ?? p.prixVente ?? 0;
}
function stockAffiche(p) {
  return p.caracteristiques?.stockTotal ?? p.caracteristiques?.stock ?? p.stock ?? 0;
}
function nomAffiche(p) {
  return p.infosGenerales?.nom ?? p.nom ?? "";
}
function categorieAffichee(p) {
  return p.infosGenerales?.categorie ?? p.categorie ?? "";
}
function prixAchatAffiche(p) {
  return p.infosGenerales?.prixAchat ?? p.prixAchat ?? 0;
}

function stockClass(stock) {
  if (stock <= 0) return "out";
  if (stock <= 10) return "low";
  return "ok";
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

function matchesStatus(p, filter) {
  const stock = stockAffiche(p);
  if (filter === "instock") return stock > 10;
  if (filter === "low") return stock > 0 && stock <= 10;
  if (filter === "out") return stock <= 0;
  return true;
}

function emptyForm() {
  return {
    infosGenerales: {
      nom: "",
      marque: "",
      modele: "",
      categorie: "Solaire",
      description: "",
      etat: "Neuf",
      garantie: "",
      prixAchat: 0,
    },
    caracteristiques: {},
    variantes: [],
  };
}

function nextVarianteRow(dimensions) {
  const dimensionsVal = {};
  dimensions.forEach((d) => (dimensionsVal[d.key] = ""));
  return { id: null, dimensions: dimensionsVal, prix: 0, prixAchat: 0, stock: 0, reference: "", image: "" };
}

createApp({
  setup() {
    const produits = ref([]);
    const searchTerm = ref("");
    const categoryFilter = ref("");
    const sortBy = ref("");
    const statusFilter = ref("tous");

    const modalOpen = ref(false);
    const editingId = ref(null);
    const formError = ref("");
    const saving = ref(false);
    const form = ref(emptyForm());
    const existingImages = ref([]);
    const pendingImages = ref([]); // [{file, url}]
    const fileInputRef = ref(null);

    const tbDateText = computed(() => {
      const n = produits.value.length;
      return `${n} produit${n !== 1 ? "s" : ""} actif${n !== 1 ? "s" : ""}`;
    });

    const statusCounts = computed(() => ({
      tous: produits.value.length,
      instock: produits.value.filter((p) => stockAffiche(p) > 10).length,
      low: produits.value.filter((p) => stockAffiche(p) > 0 && stockAffiche(p) <= 10).length,
      out: produits.value.filter((p) => stockAffiche(p) <= 0).length,
    }));

    const filteredProducts = computed(() => {
      const term = searchTerm.value.trim().toLowerCase();
      let list = produits.value.filter((p) => {
        if (term && !nomAffiche(p).toLowerCase().includes(term)) return false;
        if (categoryFilter.value && categorieAffichee(p) !== categoryFilter.value) return false;
        if (!matchesStatus(p, statusFilter.value)) return false;
        return true;
      });
      if (sortBy.value === "stock-asc") {
        list = [...list].sort((a, b) => stockAffiche(a) - stockAffiche(b));
      } else if (sortBy.value === "margin-desc") {
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
      if (product) {
        editingId.value = product.id;
        const categorie = categorieAffichee(product) || "Solaire";
        form.value = {
          infosGenerales: {
            nom: product.infosGenerales?.nom ?? product.nom ?? "",
            marque: product.infosGenerales?.marque ?? "",
            modele: product.infosGenerales?.modele ?? "",
            categorie,
            description: product.infosGenerales?.description ?? product.description ?? "",
            etat: product.infosGenerales?.etat ?? "Neuf",
            garantie: product.infosGenerales?.garantie ?? "",
            prixAchat: product.infosGenerales?.prixAchat ?? product.prixAchat ?? 0,
          },
          caracteristiques: { ...(product.caracteristiques || {}) },
          variantes: [],
        };
        existingImages.value = Array.isArray(product.images) ? [...product.images] : [];

        if (categorieADesVariantes(categorie)) {
          const snap = await getDocs(collection(db, "produits", product.id, "variantes"));
          form.value.variantes = snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              dimensions: { ...(data.options || {}) },
              prix: data.prix || 0,
              prixAchat: data.prixAchat || 0,
              stock: data.stock || 0,
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
        existingImages.value = [];
      }
      modalOpen.value = true;
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

      saving.value = true;
      try {
        const docRef = editingId.value ? doc(db, "produits", editingId.value) : doc(collection(db, "produits"));
        const uploadedUrls = [];
        // Les aperçus locaux (blob:) choisis comme photo d'une variante
        // couleur doivent être traduits vers l'URL Storage définitive une
        // fois l'upload fait, sinon on enregistrerait un lien local mort.
        const blobVersFinal = new Map();
        for (const item of pendingImages.value) {
          const path = `produits/${docRef.id}/${Date.now()}-${item.file.name}`;
          const fileRef = storageRef(storage, path);
          await uploadBytes(fileRef, item.file);
          const url = await getDownloadURL(fileRef);
          uploadedUrls.push(url);
          blobVersFinal.set(item.url, url);
        }
        const images = [...existingImages.value, ...uploadedUrls];

        // Caractéristiques = champs essentiel/secondaire saisis par l'admin
        // + prix/stock directs si la catégorie n'a pas de variantes, ou
        // prixMin/stockTotal dénormalisés sinon (évite un listener par
        // produit pour afficher la liste/catalogue).
        const caracteristiques = { ...form.value.caracteristiques };
        if (hasVariantes) {
          delete caracteristiques.prix;
          delete caracteristiques.stock;
          caracteristiques.prixMin = Math.min(...form.value.variantes.map((r) => Number(r.prix) || 0));
          caracteristiques.stockTotal = form.value.variantes.reduce((sum, r) => sum + (Number(r.stock) || 0), 0);
          // Les dimensions de variante (stockage, couleur…) n'ont pas de
          // valeur unique au niveau produit — on dénormalise l'ensemble des
          // valeurs utilisées par les variantes, pour que le catalogue/les
          // filtres client puissent les lire sans requêter la sous-collection.
          dimensions.forEach((d) => {
            caracteristiques[d.key] = [...new Set(form.value.variantes.map((r) => r.dimensions[d.key]).filter(Boolean))];
          });
        } else {
          delete caracteristiques.prixMin;
          delete caracteristiques.stockTotal;
        }

        // Champs constants : jamais demandés à l'admin, jamais filtrables —
        // glissés une seule fois dans la description générale (texte libre),
        // pas stockés comme caractéristiques structurées.
        let description = (infos.description || "").trim();
        const constantText = (config.constant || []).map((c) => c.valeur).join(". ");
        if (constantText && !description.includes(constantText)) {
          description = description ? description + "\n\n" + constantText : constantText;
        }

        const data = {
          infosGenerales: { ...infos, nom, description, prixAchat: Number(infos.prixAchat) || 0 },
          caracteristiques,
          images,
        };

        if (editingId.value) {
          await updateDoc(docRef, data);
        } else {
          await setDoc(docRef, { ...data, dateCreation: serverTimestamp() });
        }

        if (hasVariantes) {
          const existingSnap = editingId.value
            ? await getDocs(collection(db, "produits", docRef.id, "variantes"))
            : { docs: [] };
          const existingIds = new Set(existingSnap.docs.map((d) => d.id));
          const keptIds = new Set(form.value.variantes.filter((r) => r.id).map((r) => r.id));

          const batch = writeBatch(db);
          for (const row of form.value.variantes) {
            const varianteData = {
              libelle: varianteLibelle(row, dimensions),
              options: { ...row.dimensions },
              prix: Number(row.prix) || 0,
              prixAchat: Number(row.prixAchat) || 0,
              stock: parseInt(row.stock, 10) || 0,
              reference: (row.reference || "").trim(),
              image: row.image ? blobVersFinal.get(row.image) || row.image : null,
            };
            const varianteRef = row.id
              ? doc(db, "produits", docRef.id, "variantes", row.id)
              : doc(collection(db, "produits", docRef.id, "variantes"));
            batch.set(varianteRef, varianteData);
          }
          for (const existingId of existingIds) {
            if (!keptIds.has(existingId)) {
              batch.delete(doc(db, "produits", docRef.id, "variantes", existingId));
            }
          }
          await batch.commit();
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

    return {
      PLACEHOLDER_IMG,
      CATEGORIE_NOMS,
      searchTerm,
      categoryFilter,
      sortBy,
      statusFilter,
      statusCounts,
      filteredProducts,
      tbDateText,
      modalOpen,
      modalTag,
      modalTitle,
      formError,
      saving,
      form,
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
      stockAffiche,
      stockClass,
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
