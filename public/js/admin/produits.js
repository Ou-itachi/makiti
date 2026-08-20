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
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Crect width='400' height='400' fill='%2316233D'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='20' fill='%2393A4C3' text-anchor='middle' dominant-baseline='middle'%3EPas de photo%3C/text%3E%3C/svg%3E";

let produits = []; // {id, ...data}
let editingId = null;
let existingImages = []; // URLs conservées (mode édition)
let pendingFiles = []; // File[] nouvellement sélectionnés
let activeFilter = "tous";

const pgrid = document.getElementById("pgrid");
const overlay = document.getElementById("overlay");
const modalTag = document.getElementById("modalTag");
const modalTitle = document.getElementById("modalTitle");
const formError = document.getElementById("formError");
const fSearch = document.getElementById("fSearch");
const fCat = document.getElementById("fCat");
const fSort = document.getElementById("fSort");
const fStatus = document.getElementById("fStatus");
const uploadZone = document.getElementById("uploadZone");
const uzThumbs = document.getElementById("uzThumbs");
const pimages = document.getElementById("pimages");
const btnSave = document.querySelector(".btn-save");
const tbDate = document.querySelector(".tb-date");

const pname = document.getElementById("pname");
const pcat = document.getElementById("pcat");
const psupp = document.getElementById("psupp");
const pbuy = document.getElementById("pbuy");
const psell = document.getElementById("psell");
const pstock = document.getElementById("pstock");
const pdesc = document.getElementById("pdesc");
const marginAmt = document.getElementById("marginAmt");
const marginPct = document.getElementById("marginPct");

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

function stockClassOf(stock) {
  if (stock <= 0) return "out";
  if (stock <= 10) return "low";
  return "ok";
}

function calcMargin() {
  const buy = parseFloat(pbuy.value) || 0;
  const sell = parseFloat(psell.value) || 0;
  const margin = sell - buy;
  const pct = buy > 0 ? Math.round((margin / buy) * 100) : 0;
  marginPct.textContent = (pct >= 0 ? "+" : "") + pct + "%";
  marginAmt.textContent = fmt(margin) + " GNF de marge";
}
pbuy.addEventListener("input", calcMargin);
psell.addEventListener("input", calcMargin);

function showFormError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
}
function hideFormError() {
  formError.hidden = true;
}

// ---------- Modale ----------
function renderUzThumbs() {
  const existingHTML = existingImages
    .map(
      (url, i) =>
        `<div class="uz-thumb"><img src="${escapeHTML(url)}" alt=""/><button type="button" class="rm" data-kind="existing" data-idx="${i}">×</button></div>`
    )
    .join("");
  const pendingHTML = pendingFiles
    .map(
      (file, i) =>
        `<div class="uz-thumb"><img src="${URL.createObjectURL(file)}" alt=""/><button type="button" class="rm" data-kind="pending" data-idx="${i}">×</button></div>`
    )
    .join("");
  uzThumbs.innerHTML = existingHTML + pendingHTML;
  uzThumbs.querySelectorAll(".rm").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx, 10);
      if (btn.dataset.kind === "existing") existingImages.splice(idx, 1);
      else pendingFiles.splice(idx, 1);
      renderUzThumbs();
    });
  });
}

uploadZone.addEventListener("click", () => pimages.click());
pimages.addEventListener("change", () => {
  const total = existingImages.length + pendingFiles.length + pimages.files.length;
  if (total > 5) {
    showFormError("5 photos maximum par produit.");
  }
  Array.from(pimages.files)
    .slice(0, Math.max(0, 5 - existingImages.length - pendingFiles.length))
    .forEach((f) => pendingFiles.push(f));
  pimages.value = "";
  renderUzThumbs();
});

function openModal(editBtn) {
  hideFormError();
  overlay.classList.add("open");
  pendingFiles = [];
  existingImages = [];

  const id = editBtn ? editBtn.dataset.id : null;
  if (id) {
    const p = produits.find((x) => x.id === id);
    if (!p) return;
    editingId = id;
    modalTag.textContent = "Modification";
    modalTitle.textContent = "Modifier le produit";
    pname.value = p.nom || "";
    pcat.value = p.categorie || "Solaire";
    psupp.value = p.fournisseurNom || "";
    pbuy.value = p.prixAchat || 0;
    psell.value = p.prixVente || 0;
    pstock.value = p.stock || 0;
    pdesc.value = p.description || "";
    existingImages = Array.isArray(p.images) ? [...p.images] : [];
  } else {
    editingId = null;
    modalTag.textContent = "Nouveau";
    modalTitle.textContent = "Ajouter un produit";
    pname.value = "";
    pcat.value = "Solaire";
    psupp.value = "";
    pbuy.value = 0;
    psell.value = 0;
    pstock.value = 0;
    pdesc.value = "";
  }
  calcMargin();
  renderUzThumbs();
}

function closeModal() {
  overlay.classList.remove("open");
  editingId = null;
  pendingFiles = [];
  existingImages = [];
}
window.openModal = openModal;
window.closeModal = closeModal;

async function save() {
  hideFormError();
  const nom = pname.value.trim();
  const categorie = pcat.value;
  const prixAchat = parseFloat(pbuy.value) || 0;
  const prixVente = parseFloat(psell.value) || 0;
  const stock = parseInt(pstock.value, 10) || 0;

  if (!nom) return showFormError("Le nom du produit est obligatoire.");
  if (!categorie) return showFormError("La catégorie est obligatoire.");
  if (prixVente <= 0) return showFormError("Le prix de vente doit être supérieur à 0.");

  btnSave.disabled = true;
  const originalLabel = btnSave.innerHTML;
  btnSave.innerHTML = "Enregistrement…";

  try {
    const docRef = editingId ? doc(db, "produits", editingId) : doc(collection(db, "produits"));
    const uploadedUrls = [];
    for (const file of pendingFiles) {
      const path = `produits/${docRef.id}/${Date.now()}-${file.name}`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, file);
      uploadedUrls.push(await getDownloadURL(fileRef));
    }
    const images = [...existingImages, ...uploadedUrls];

    const data = {
      nom,
      categorie,
      fournisseurNom: psupp.value.trim(),
      prixAchat,
      prixVente,
      stock,
      description: pdesc.value.trim(),
      images,
    };

    if (editingId) {
      await updateDoc(docRef, data);
    } else {
      await setDoc(docRef, { ...data, dateCreation: serverTimestamp() });
    }
    closeModal();
    btnSave.innerHTML = originalLabel;
    btnSave.disabled = false;
  } catch (err) {
    console.error(err);
    showFormError("Erreur lors de l'enregistrement : " + (err.message || err.code || "réessaie."));
    btnSave.innerHTML = originalLabel;
    btnSave.disabled = false;
  }
}
btnSave.addEventListener("click", save);

async function removeProduct(id) {
  const p = produits.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`Supprimer « ${p.nom} » ? Cette action est irréversible.`)) return;
  try {
    await deleteDoc(doc(db, "produits", id));
    for (const url of p.images || []) {
      try {
        await deleteObject(ref(storage, url));
      } catch (e) {
        // image déjà absente du Storage, on ignore
      }
    }
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la suppression : " + (err.message || err.code || "réessaie."));
  }
}

// ---------- Liste / filtres ----------
function matchesStatus(p, filter) {
  if (filter === "instock") return p.stock > 10;
  if (filter === "low") return p.stock > 0 && p.stock <= 10;
  if (filter === "out") return p.stock <= 0;
  return true;
}

function pcardHTML(p) {
  const cls = stockClassOf(p.stock);
  const margin = p.prixAchat > 0 ? Math.round(((p.prixVente - p.prixAchat) / p.prixAchat) * 100) : 0;
  const img = (p.images && p.images[0]) || PLACEHOLDER_IMG;
  return `
    <div class="pcard" data-id="${p.id}">
      <div class="pcard-media">
        <span class="stock-badge ${cls}">${p.stock} EN STOCK</span>
        <button class="pcard-menu" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg></button>
        <img src="${escapeHTML(img)}" alt="${escapeHTML(p.nom)}"/>
      </div>
      <div class="pcard-body">
        <div class="pcard-cat">${escapeHTML(p.categorie)}</div>
        <h3>${escapeHTML(p.nom)}</h3>
        <div class="pcard-prices">
          <div class="pp-item"><div class="lbl">Achat</div><div class="val">${fmt(p.prixAchat)}</div></div>
          <div class="pp-item sell"><div class="lbl">Vente</div><div class="val">${fmt(p.prixVente)}</div></div>
          <div class="pp-item margin"><div class="lbl">Marge</div><div class="val">${margin >= 0 ? "+" : ""}${margin}%</div></div>
        </div>
        <div class="pcard-foot">
          <span class="supp"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M3 21h18M5 21V7l7-4 7 4v14"/></svg>${escapeHTML(p.fournisseurNom || "—")}</span>
          <div class="pcard-actions">
            <button class="pc-act edit" data-id="${p.id}" title="Modifier"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button class="pc-act del" data-id="${p.id}" title="Supprimer"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg></button>
          </div>
        </div>
      </div>
    </div>`;
}

const ADD_CARD_HTML = `
  <button class="add-card" onclick="openModal()">
    <div class="plus-circle"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M12 5v14M5 12h14"/></svg></div>
    <span>Ajouter un produit</span>
  </button>`;

function render() {
  const term = fSearch.value.trim().toLowerCase();
  const cat = fCat.value;
  const sort = fSort.value;

  let list = produits.filter((p) => {
    if (term && !(p.nom || "").toLowerCase().includes(term)) return false;
    if (cat && p.categorie !== cat) return false;
    if (!matchesStatus(p, activeFilter)) return false;
    return true;
  });

  if (sort === "stock-asc") list = [...list].sort((a, b) => a.stock - b.stock);
  else if (sort === "margin-desc")
    list = [...list].sort((a, b) => {
      const ma = a.prixAchat > 0 ? (a.prixVente - a.prixAchat) / a.prixAchat : 0;
      const mb = b.prixAchat > 0 ? (b.prixVente - b.prixAchat) / b.prixAchat : 0;
      return mb - ma;
    });
  else if (sort === "price-desc") list = [...list].sort((a, b) => b.prixVente - a.prixVente);

  pgrid.innerHTML =
    (list.length ? list.map(pcardHTML).join("") : `<div class="pgrid-empty">Aucun produit ne correspond à ces filtres.</div>`) +
    ADD_CARD_HTML;

  pgrid.querySelectorAll(".pc-act.edit").forEach((btn) => btn.addEventListener("click", () => openModal(btn)));
  pgrid.querySelectorAll(".pc-act.del").forEach((btn) => btn.addEventListener("click", () => removeProduct(btn.dataset.id)));

  tbDate.textContent = `${produits.length} produit${produits.length !== 1 ? "s" : ""} actif${produits.length !== 1 ? "s" : ""}`;

  const counts = {
    tous: produits.length,
    instock: produits.filter((p) => p.stock > 10).length,
    low: produits.filter((p) => p.stock > 0 && p.stock <= 10).length,
    out: produits.filter((p) => p.stock <= 0).length,
  };
  fStatus.querySelectorAll(".f-chip").forEach((chip) => {
    const key = chip.dataset.filter;
    const labels = { tous: "Tous", instock: "En stock", low: "Stock faible", out: "Rupture" };
    chip.textContent = `${labels[key]} (${counts[key]})`;
  });
}

fStatus.querySelectorAll(".f-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    activeFilter = chip.dataset.filter;
    fStatus.querySelectorAll(".f-chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    render();
  });
});
fSearch.addEventListener("input", render);
fCat.addEventListener("change", render);
fSort.addEventListener("change", render);

onSnapshot(query(collection(db, "produits"), orderBy("dateCreation", "desc")), (snap) => {
  produits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
});
