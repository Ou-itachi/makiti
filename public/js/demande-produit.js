import { db, storage } from "./firebase-config.js";
import {
  collection,
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 8 * 1024 * 1024; // doit rester sous la limite de storage.rules

const formBody = document.getElementById("formBody");
const successPanel = document.getElementById("successPanel");
const errorBox = document.getElementById("requestError");
const submitBtn = document.querySelector(".submit-btn");
const submitBtnLabel = document.querySelector(".submit-btn .btn-label");

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}
function hideError() {
  errorBox.hidden = true;
}

let qty = 1;
window.changeQty = function (d) {
  qty = Math.max(1, qty + d);
  document.getElementById("qtyVal").textContent = qty;
};

// Fichiers réels à uploader vers Storage — chaque entrée garde le File et
// son aperçu (data URL) pour l'affichage, jusqu'à MAX_PHOTOS.
let photos = [];
window.handlePhotos = function (e) {
  hideError();
  const disponible = MAX_PHOTOS - photos.length;
  const files = Array.from(e.target.files).slice(0, disponible);
  e.target.value = "";
  if (Array.from(e.target.files || []).length > disponible) {
    showError(`Vous pouvez ajouter jusqu'à ${MAX_PHOTOS} photos.`);
  }
  files.forEach((file) => {
    if (!file.type.startsWith("image/")) {
      showError("Seules les images sont acceptées.");
      return;
    }
    if (file.size >= MAX_PHOTO_SIZE) {
      showError("Chaque photo doit faire moins de 8 Mo.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      photos.push({ file, preview: ev.target.result });
      renderPhotos();
    };
    reader.readAsDataURL(file);
  });
};
function renderPhotos() {
  const wrap = document.getElementById("photoPreviews");
  wrap.innerHTML = "";
  photos.forEach((p, i) => {
    const div = document.createElement("div");
    div.className = "photo-thumb";
    div.innerHTML = `<img src="${p.preview}" alt="Photo ${i + 1}"/><button class="rm" type="button">×</button>`;
    div.querySelector(".rm").addEventListener("click", () => removePhoto(i));
    wrap.appendChild(div);
  });
}
function removePhoto(i) {
  photos.splice(i, 1);
  renderPhotos();
}

window.submitRequest = async function () {
  hideError();
  const nom = document.getElementById("pname").value.trim();
  const categorie = document.getElementById("pcat").value;
  const description = document.getElementById("pdesc").value.trim();
  const clientNom = document.getElementById("cname").value.trim();
  const clientTel = document.getElementById("cphone").value.trim();

  if (!nom || !clientNom || !clientTel) {
    showError("Merci de remplir au moins le nom du produit, votre nom et votre téléphone.");
    return;
  }

  submitBtn.disabled = true;
  if (submitBtnLabel) submitBtnLabel.textContent = "Envoi en cours…";

  try {
    const demandeRef = doc(collection(db, "demandesProduits"));

    // storage.rules interdit la lecture de demandes-produits/** au client
    // (réservée à l'admin) : on ne peut donc pas appeler getDownloadURL()
    // ici, ça échouerait systématiquement. On stocke le chemin Storage brut
    // — c'est côté admin, une fois authentifié, qu'on résout l'URL réelle.
    const photoPaths = await Promise.all(
      photos.map(async (p, i) => {
        const path = `demandes-produits/${demandeRef.id}/${i}-${p.file.name}`;
        await uploadBytes(ref(storage, path), p.file, { contentType: p.file.type });
        return path;
      })
    );

    await setDoc(demandeRef, {
      nom,
      quantite: qty,
      categorie,
      description: description || null,
      photos: photoPaths,
      clientNom,
      clientTel,
      statut: "nouvelle",
      dateCreation: serverTimestamp(),
    });

    formBody.classList.add("hide");
    successPanel.classList.add("show");
  } catch (err) {
    console.error(err);
    showError("Une erreur est survenue en envoyant votre demande. Réessayez.");
    submitBtn.disabled = false;
    if (submitBtnLabel) submitBtnLabel.textContent = "Envoyer ma demande";
  }
};
