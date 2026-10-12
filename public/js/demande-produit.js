import { messageErreurAppel, appelPublic } from "./firebase-config.js";

const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // doit rester sous la limite de storage.rules
const DEMANDE_PHOTO_MAX = 700 * 1024;
const creerDemandeProduit = appelPublic("creerDemandeProduit");

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
let photosEnPreparation = 0;
function lireDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function compresserPhoto(file) {
  if (file.type === "image/heic" || file.type === "image/heif") {
    if (file.size > DEMANDE_PHOTO_MAX) throw new Error("Une photo HEIC doit faire moins de 700 Ko.");
    return file;
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  let quality = 0.82;
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  while (blob && blob.size > DEMANDE_PHOTO_MAX && quality > 0.42) {
    quality -= 0.1;
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  }
  if (!blob || blob.size > DEMANDE_PHOTO_MAX) throw new Error("Impossible de réduire cette photo sous 700 Ko.");
  return blob;
}
window.handlePhotos = function (e) {
  hideError();
  const disponible = MAX_PHOTOS - photos.length - photosEnPreparation;
  const selection = Array.from(e.target.files || []);
  const files = selection.slice(0, disponible);
  e.target.value = "";
  if (selection.length > disponible) {
    showError(`Vous pouvez ajouter jusqu'à ${MAX_PHOTOS} photos.`);
  }
  files.forEach(async (file) => {
    if (!/^image\/(webp|jpeg|png|gif|heic|heif)$/i.test(file.type)) {
      showError("Choisissez une image WebP, JPG, PNG, GIF ou HEIC.");
      return;
    }
    if (file.size >= MAX_PHOTO_SIZE) {
      showError("Chaque photo doit faire moins de 5 Mo.");
      return;
    }
    photosEnPreparation++;
    compresserPhoto(file).then(async (image) => {
      photos.push({ file: image, preview: await lireDataUrl(image) });
      renderPhotos();
    }).catch((error) => showError(error.message || "Cette photo ne peut pas être préparée."))
      .finally(() => { photosEnPreparation = Math.max(0, photosEnPreparation - 1); });
  });
};
function renderPhotos() {
  const wrap = document.getElementById("photoPreviews");
  wrap.innerHTML = "";
  photos.forEach((p, i) => {
    const div = document.createElement("div");
    div.className = "photo-thumb";
    const image = document.createElement("img");
    image.src = p.preview;
    image.alt = `Photo ${i + 1}`;
    const removeButton = document.createElement("button");
    removeButton.className = "rm";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => removePhoto(i));
    div.append(image, removeButton);
    wrap.appendChild(div);
  });
}
function removePhoto(i) {
  photos.splice(i, 1);
  renderPhotos();
}

window.submitRequest = async function () {
  hideError();
  if (photosEnPreparation) {
    showError("Patientez pendant la préparation des photos.");
    return;
  }
  const nom = document.getElementById("pname").value.trim();
  const categorie = document.getElementById("pcat").value;
  const description = document.getElementById("pdesc").value.trim();
  const clientNom = document.getElementById("cname").value.trim();
  const clientTel = document.getElementById("cphone").value.trim();

  if (!nom || !clientNom || !clientTel) {
    showError("Merci de remplir au moins le nom du produit, votre nom et votre téléphone.");
    return;
  }
  if (nom.length > 200 || clientNom.length > 120 || description.length > 1000) {
    showError("Le nom du produit, votre nom ou la description est trop long.");
    return;
  }
  const telephone = clientTel.replace(/[\s().-]/g, "");
  if (!/^(\+224)?[0-9]{9}$/.test(telephone)) {
    showError("Entrez un numéro guinéen valide (9 chiffres, avec ou sans +224).");
    return;
  }

  submitBtn.disabled = true;
  if (submitBtnLabel) submitBtnLabel.textContent = "Envoi en cours…";

  try {
    const images = await Promise.all(photos.map(async (p) => {
      const dataUrl = await lireDataUrl(p.file);
      return { mimeType: p.file.type, base64: dataUrl.split(",", 2)[1] || "" };
    }));
    await creerDemandeProduit({
      nom,
      quantite: qty,
      categorie,
      description: description || null,
      clientNom,
      clientTel,
      images,
    });

    formBody.classList.add("hide");
    successPanel.classList.add("show");
  } catch (err) {
    console.error(err);
    showError(err?.code === "functions/unauthenticated"
      ? messageErreurAppel(err)
      : "Une erreur est survenue en envoyant votre demande. Réessayez.");
    submitBtn.disabled = false;
    if (submitBtnLabel) submitBtnLabel.textContent = "Envoyer ma demande";
  }
};
