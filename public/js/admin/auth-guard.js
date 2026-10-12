import { auth, db } from "../firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// Un compte Firebase Auth ne suffit pas : n'importe qui peut en créer un avec
// la clé publique du projet. Les données restent protégées par firestore.rules
// (isAdmin), mais un non-admin connecté voyait quand même la coquille de
// l'admin. On vérifie donc l'appartenance à la liste blanche en tentant une
// lecture réservée aux admins (parametres/livraison, allow read: if isAdmin)
// et on renvoie vers login si elle est refusée.
// Chiffres du tableau de bord mémorisés pour l'affichage instantané
// (dashboard.js / dashboard.html) : jamais conservés après une déconnexion.
function effacerCachesAdmin() {
  try {
    localStorage.removeItem("bokki-dashboard-cache-v1");
    localStorage.removeItem("bokki-dashboard-ventes-v1");
    localStorage.removeItem("bokki-commandes-compteurs-v1");
    localStorage.removeItem("bokki-demandes-compteurs-v1");
  } catch { /* stockage indisponible */ }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    effacerCachesAdmin();
    window.location.href = "login.html";
    return;
  }
  try {
    await getDoc(doc(db, "parametres", "livraison"));
  } catch (err) {
    if (err?.code === "permission-denied") {
      effacerCachesAdmin();
      await signOut(auth).catch(() => {});
      window.location.href = "login.html";
    }
    // autre erreur (réseau…) : on ne déconnecte pas, les pages géreront.
  }
});

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", (e) => {
    e.preventDefault();
    effacerCachesAdmin();
    signOut(auth).then(() => {
      window.location.href = "login.html";
    });
  });
}
