import { createApp, ref, computed } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { db, storage } from "../firebase-config.js";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Crect width='400' height='400' fill='%2316233D'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='20' fill='%2393A4C3' text-anchor='middle' dominant-baseline='middle'%3EPas de photo%3C/text%3E%3C/svg%3E";

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function stockClass(stock) {
  if (stock <= 0) return "out";
  if (stock <= 10) return "low";
  return "ok";
}

function productMarginPct(p) {
  return p.prixAchat > 0 ? Math.round(((p.prixVente - p.prixAchat) / p.prixAchat) * 100) : 0;
}

function marginRatio(p) {
  return p.prixAchat > 0 ? (p.prixVente - p.prixAchat) / p.prixAchat : 0;
}

function matchesStatus(p, filter) {
  if (filter === "instock") return p.stock > 10;
  if (filter === "low") return p.stock > 0 && p.stock <= 10;
  if (filter === "out") return p.stock <= 0;
  return true;
}

function emptyForm() {
  return {
    nom: "",
    categorie: "Solaire",
    fournisseurNom: "",
    prixAchat: 0,
    prixVente: 0,
    stock: 0,
    description: "",
  };
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
      instock: produits.value.filter((p) => p.stock > 10).length,
      low: produits.value.filter((p) => p.stock > 0 && p.stock <= 10).length,
      out: produits.value.filter((p) => p.stock <= 0).length,
    }));

    const filteredProducts = computed(() => {
      const term = searchTerm.value.trim().toLowerCase();
      let list = produits.value.filter((p) => {
        if (term && !(p.nom || "").toLowerCase().includes(term)) return false;
        if (categoryFilter.value && p.categorie !== categoryFilter.value) return false;
        if (!matchesStatus(p, statusFilter.value)) return false;
        return true;
      });
      if (sortBy.value === "stock-asc") {
        list = [...list].sort((a, b) => a.stock - b.stock);
      } else if (sortBy.value === "margin-desc") {
        list = [...list].sort((a, b) => marginRatio(b) - marginRatio(a));
      } else if (sortBy.value === "price-desc") {
        list = [...list].sort((a, b) => b.prixVente - a.prixVente);
      }
      return list;
    });

    const modalTag = computed(() => (editingId.value ? "Modification" : "Nouveau"));
    const modalTitle = computed(() => (editingId.value ? "Modifier le produit" : "Ajouter un produit"));

    const marginPct = computed(() => {
      const buy = Number(form.value.prixAchat) || 0;
      const sell = Number(form.value.prixVente) || 0;
      return buy > 0 ? Math.round(((sell - buy) / buy) * 100) : 0;
    });
    const marginAmtText = computed(() => {
      const buy = Number(form.value.prixAchat) || 0;
      const sell = Number(form.value.prixVente) || 0;
      return fmt(sell - buy) + " GNF de marge";
    });

    function resetPendingImages() {
      pendingImages.value.forEach((item) => URL.revokeObjectURL(item.url));
      pendingImages.value = [];
    }

    function openModal(product) {
      formError.value = "";
      resetPendingImages();
      if (product) {
        editingId.value = product.id;
        form.value = {
          nom: product.nom || "",
          categorie: product.categorie || "Solaire",
          fournisseurNom: product.fournisseurNom || "",
          prixAchat: product.prixAchat || 0,
          prixVente: product.prixVente || 0,
          stock: product.stock || 0,
          description: product.description || "",
        };
        existingImages.value = Array.isArray(product.images) ? [...product.images] : [];
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

    async function save() {
      formError.value = "";
      const nom = form.value.nom.trim();
      const categorie = form.value.categorie;
      const prixAchat = Number(form.value.prixAchat) || 0;
      const prixVente = Number(form.value.prixVente) || 0;
      const stock = parseInt(form.value.stock, 10) || 0;

      if (!nom) return (formError.value = "Le nom du produit est obligatoire.");
      if (!categorie) return (formError.value = "La catégorie est obligatoire.");
      if (prixVente <= 0) return (formError.value = "Le prix de vente doit être supérieur à 0.");

      saving.value = true;
      try {
        const docRef = editingId.value ? doc(db, "produits", editingId.value) : doc(collection(db, "produits"));
        const uploadedUrls = [];
        for (const item of pendingImages.value) {
          const path = `produits/${docRef.id}/${Date.now()}-${item.file.name}`;
          const fileRef = storageRef(storage, path);
          await uploadBytes(fileRef, item.file);
          uploadedUrls.push(await getDownloadURL(fileRef));
        }
        const images = [...existingImages.value, ...uploadedUrls];

        const data = {
          nom,
          categorie,
          fournisseurNom: form.value.fournisseurNom.trim(),
          prixAchat,
          prixVente,
          stock,
          description: form.value.description.trim(),
          images,
        };

        if (editingId.value) {
          await updateDoc(docRef, data);
        } else {
          await setDoc(docRef, { ...data, dateCreation: serverTimestamp() });
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
      if (!confirm(`Supprimer « ${p.nom} » ? Cette action est irréversible.`)) return;
      try {
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
      marginPct,
      marginAmtText,
      fmt,
      stockClass,
      productMarginPct,
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
