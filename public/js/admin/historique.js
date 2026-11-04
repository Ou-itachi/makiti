// « Historique » : un livreur voit les siennes, un admin voit tout. Chaque
// ligne ouvre le détail : chronologie, positions, vidéo, photos, client.
import { createApp, ref, computed, nextTick, onMounted } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { auth, db, functions } from "../firebase-config.js";
import { storage } from "../firebase-stockage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { getDownloadURL, ref as storageRef } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import { afficherCarte } from "./carte-livraison.js";
import { dateHeure, enDate, fmt, heure, infoStatut, libelleRaison } from "./livraison-commun.js";

const lireFichierLivraison = httpsCallable(functions, "lireFichierLivraison");
const garderIncident = httpsCallable(functions, "garderIncident");
const TERMINEES = ["livree", "retournee", "endommagee", "annulee_client"];

const duree = (l) => {
  const debut = enDate(l.lanceeLe)?.getTime();
  const fin = enDate(l.livreeLe)?.getTime() || (TERMINEES.includes(l.statut) ? enDate(l.statutMajLe)?.getTime() : null);
  return debut && fin && fin > debut ? `${Math.max(1, Math.round((fin - debut) / 60000))} min` : "—";
};

createApp({
  setup() {
    const livraisons = ref([]);
    const charge = ref(false);
    const estAdmin = ref(false);
    const idLivraison = ref(new URLSearchParams(location.search).get("id"));
    const ids = ref([]);
    const positions = ref([]);
    const enregistrements = ref([]);
    const photos = ref([]);
    const commande = ref(null);
    const message = ref("");
    const messageType = ref("");
    const erreurListe = ref(false);

    const passees = computed(() => livraisons.value.filter((l) => l.lanceeLe || TERMINEES.includes(l.statut)));
    const choisie = computed(() => livraisons.value.find((l) => l.commandeId === idLivraison.value) || null);
    const chronologie = computed(() => {
      const l = choisie.value;
      if (!l) return [];
      const lignes = (commande.value?.historique || []).map((h) => ({
        date: h.date,
        titre: h.type === "attribution" ? "Attribuée" : infoStatut(h.vers).label,
        detail: [h.nom, h.raison === "correction" ? "Correction" : libelleRaison(h.raison), h.commentaire].filter(Boolean).join(" · "),
      }));
      if (!lignes.length) {
        if (l.attribueeLe) lignes.push({ date: l.attribueeLe, titre: "Attribuée", detail: "" });
        if (l.lanceeLe) lignes.push({ date: l.lanceeLe, titre: "En livraison", detail: "" });
        if (TERMINEES.includes(l.statut)) lignes.push({ date: l.statutMajLe, titre: infoStatut(l.statut).label, detail: libelleRaison(l.raison) });
      }
      positions.value.forEach((p) => lignes.push({ date: p.date, titre: "Position", detail: p.source === "sos" ? "SOS" : "" }));
      return lignes.sort((a, b) => (enDate(a.date)?.getTime() || 0) - (enDate(b.date)?.getTime() || 0));
    });

    async function chargerPhoto(p) {
      if (estAdmin.value) return getDownloadURL(storageRef(storage, p.chemin));
      const { data } = await lireFichierLivraison({ photoId: p.id });
      return `data:${data.mimeType};base64,${data.base64}`;
    }
    async function ouvrirDetail(l) {
      commande.value = null;
      const filtres = [where("commandeId", "==", l.commandeId), ...(estAdmin.value ? [] : [where("livreurId", "==", l.livreurId)])];
      const lire = (nom) => getDocs(query(collection(db, nom), ...filtres)).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))).catch((err) => { console.error(err); return []; });
      const [pos, enr, pho] = await Promise.all([lire("positions"), lire("enregistrements"), lire("photosIncident")]);
      positions.value = pos.sort((a, b) => (enDate(a.date)?.getTime() || 0) - (enDate(b.date)?.getTime() || 0));
      enregistrements.value = enr;
      photos.value = await Promise.all(pho.map(async (p) => ({ ...p, url: await chargerPhoto(p).catch(() => "") })));
      if (estAdmin.value) {
        const snap = await getDoc(doc(db, "commandes", l.commandeId)).catch(() => null);
        if (snap?.exists()) {
          const c = snap.data();
          delete c.codeLivraison;
          commande.value = c;
        }
      }
      if (positions.value.length) {
        await nextTick();
        afficherCarte(document.getElementById("carteLivraison"), positions.value).catch(console.error);
      }
    }
    function voir(l) {
      idLivraison.value = l.commandeId;
      history.pushState(null, "", `?id=${l.commandeId}`);
      scrollTo(0, 0);
      ouvrirDetail(l);
    }
    function retour() {
      idLivraison.value = null;
      history.pushState(null, "", location.pathname);
    }
    async function garder(garde) {
      try {
        await garderIncident({ commandeId: idLivraison.value, garde });
        message.value = garde ? "Gardé : ne sera pas supprimé après 7 jours." : "Suppression automatique rétablie.";
        messageType.value = "ok";
        ouvrirDetail(choisie.value);
      } catch (err) {
        console.error(err);
        message.value = err.message || "Action impossible, réessayez.";
        messageType.value = "erreur";
      }
    }

    onMounted(() => {
      const stop = onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        stop();
        const [compte, admin] = await Promise.all([
          getDoc(doc(db, "comptesLivreurs", user.uid)).catch(() => null),
          getDoc(doc(db, "parametres", "livraison")).then(() => true).catch(() => false),
        ]);
        estAdmin.value = admin;
        const lieId = compte?.exists() ? compte.data().livreurId : null;
        ids.value = lieId ? [lieId] : [];
        const q = admin
          ? query(collection(db, "livraisons"), orderBy("attribueeLe", "desc"), limit(300))
          : query(collection(db, "livraisons"), where("livreurId", "==", lieId), orderBy("attribueeLe", "desc"), limit(300));
        let premiere = true;
        onSnapshot(q, (snap) => {
          livraisons.value = snap.docs.map((d) => d.data());
          charge.value = true;
          if (premiere && choisie.value) ouvrirDetail(choisie.value);
          premiere = false;
        }, (err) => { console.error(err); erreurListe.value = true; charge.value = true; });
      });
    });
    addEventListener("popstate", () => {
      idLivraison.value = new URLSearchParams(location.search).get("id");
      if (choisie.value) ouvrirDetail(choisie.value);
    });

    return {
      passees, charge, erreurListe, messageType, estAdmin, choisie, positions, enregistrements, photos, commande, chronologie, message,
      duree, fmt, heure, dateHeure, infoStatut, libelleRaison, voir, retour, garder,
    };
  },
}).mount("#historiqueApp");
