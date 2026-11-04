// Suivi en temps réel : le serveur donne un identifiant secret au client qui a
// prouvé son code, et ce document ne contient que le statut. À chaque
// changement, la page relit sa commande par le chemin habituel.
const ecoutes = new Map();

export async function ecouterStatut(jeton, surChangement) {
  if (!jeton || ecoutes.has(jeton)) return;
  ecoutes.set(jeton, null);
  try {
    const [{ db }, { doc, onSnapshot }] = await Promise.all([
      import("./firebase-base.js"),
      import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"),
    ]);
    let premier = true;
    const arret = onSnapshot(doc(db, "suiviDirect", jeton), () => {
      if (premier) { premier = false; return; }
      surChangement();
    }, () => ecoutes.delete(jeton));
    ecoutes.set(jeton, arret);
  } catch (err) {
    ecoutes.delete(jeton);
    console.warn("Suivi en direct indisponible :", err);
  }
}
