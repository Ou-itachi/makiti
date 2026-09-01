// Panneaux "Informations de la boutique" et "Notifications" de la page
// Paramètres. Avant, les deux boutons "Enregistrer" appelaient showToast()
// sans rien persister : les valeurs affichées (téléphone, WhatsApp…) étaient
// des libellés statiques dans le HTML, et toute modification disparaissait au
// rechargement tout en affichant "Modifications enregistrées". Ici on les
// branche réellement sur Firestore, sur le même modèle que
// parametres/livraison (voir parametres.js).
//
// - parametres/boutique       : nom, téléphone, WhatsApp, adresse, horaires.
//   Lu aussi côté client par contact.html et faq.html (repli sur les valeurs
//   du HTML si le document n'existe pas encore).
// - parametres/notifications  : préférences d'alerte du tableau de bord.
import { db } from "../firebase-config.js";
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const toast = document.getElementById("saveToast");
let toastTimer;
function showToast(texte) {
  if (!toast) return;
  toast.textContent = texte || "Modifications enregistrées";
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function bindPanel({ fields, docRef, saveBtnId, msgId, read, collect }) {
  const saveBtn = document.getElementById(saveBtnId);
  const msgEl = document.getElementById(msgId);
  if (!saveBtn) return;

  // On ne réécrit pas un champ que l'admin est en train de modifier.
  let editing = false;
  fields.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("focus", () => { editing = true; });
    el.addEventListener("blur", () => { editing = false; });
  });

  onSnapshot(
    docRef,
    (snap) => {
      if (!snap.exists() || editing) return;
      read(snap.data() || {});
    },
    (err) => {
      console.error(err);
      if (msgEl) msgEl.textContent = "Chargement impossible : " + (err.message || err.code);
    }
  );

  saveBtn.addEventListener("click", async () => {
    if (msgEl) msgEl.textContent = "";
    saveBtn.disabled = true;
    try {
      await setDoc(docRef, collect(), { merge: true });
      showToast("Modifications enregistrées");
    } catch (err) {
      console.error(err);
      if (msgEl) msgEl.textContent = "Erreur : " + (err.message || err.code || "réessaie.");
    } finally {
      saveBtn.disabled = false;
    }
  });
}

const val = (id) => document.getElementById(id)?.value.trim() || "";
const setVal = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
const checked = (id) => !!document.getElementById(id)?.checked;
const setChecked = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };

bindPanel({
  fields: ["shopName", "shopPhone", "shopWhatsapp", "shopAddr", "shopHours"],
  docRef: doc(db, "parametres", "boutique"),
  saveBtnId: "shopSaveBtn",
  msgId: "shopSaveMsg",
  read: (d) => {
    setVal("shopName", d.nom);
    setVal("shopPhone", d.telephone);
    setVal("shopWhatsapp", d.whatsapp);
    setVal("shopAddr", d.adresse);
    setVal("shopHours", d.horaires);
  },
  collect: () => ({
    nom: val("shopName"),
    telephone: val("shopPhone"),
    whatsapp: val("shopWhatsapp"),
    adresse: val("shopAddr"),
    horaires: val("shopHours"),
  }),
});

bindPanel({
  fields: [],
  docRef: doc(db, "parametres", "notifications"),
  saveBtnId: "notifSaveBtn",
  msgId: "notifSaveMsg",
  read: (d) => {
    setChecked("notifNouvelleCommande", d.nouvelleCommande !== false);
    setChecked("notifNegociation", d.negociation !== false);
    setChecked("notifRappelFournisseur", d.rappelFournisseur === true);
  },
  collect: () => ({
    nouvelleCommande: checked("notifNouvelleCommande"),
    negociation: checked("notifNegociation"),
    rappelFournisseur: checked("notifRappelFournisseur"),
  }),
});
