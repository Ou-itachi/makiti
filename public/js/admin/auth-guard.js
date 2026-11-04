import { auth, db } from "../firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

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

async function deconnecterLivreur() {
  effacerCachesAdmin();
  await signOut(auth).catch(() => {});
  window.location.href = "login.html?desactive=1";
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
      // Compte livreur : seules les pages marquées data-page-livreur lui sont ouvertes.
      const compte = await getDoc(doc(db, "comptesLivreurs", user.uid)).catch(() => undefined);
      if (compte === undefined) return; // réseau coupé : on ne déconnecte pas.
      if (compte.exists()) {
        const fiche = compte.data();
        if (fiche.actif === false) return deconnecterLivreur();
        if (fiche.doitChangerMdp === true || fiche.infoAcceptee !== true) {
          window.location.href = "login.html?premiere=1";
          return;
        }
        // Désactivé pendant qu'il travaille : déconnecté tout de suite.
        onSnapshot(doc(db, "comptesLivreurs", user.uid), (snap) => {
          if (!snap.exists() || snap.data().actif === false) deconnecterLivreur();
          else if (snap.data().doitChangerMdp === true) window.location.href = "login.html?premiere=1";
        }, () => deconnecterLivreur());
        if (!document.body.hasAttribute("data-page-livreur")) {
          window.location.href = "ma-livraison.html";
          return;
        }
        document.documentElement.dataset.livreurSeul = "1";
        dispatchEvent(new Event("bokki:livreur-seul"));
        return;
      }
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
