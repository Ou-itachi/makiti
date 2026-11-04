// Enregistrements : l'admin voit tout, un livreur seulement les siens (règles).
// Toute lecture passe par le serveur : un livreur désactivé est refusé aussitôt
// et chaque consultation par un admin est notée au journal.
import { createApp, ref, computed, onMounted } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { auth, db, functions } from "../firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { dateHeure, enDate } from "./livraison-commun.js";

const consulterEnregistrement = httpsCallable(functions, "consulterEnregistrement");
const lireFichierLivraison = httpsCallable(functions, "lireFichierLivraison", { timeout: 60000 });
const garderIncident = httpsCallable(functions, "garderIncident");
const JOUR = 86400000;

const enOctets = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

createApp({
  setup() {
    const liste = ref([]);
    const charge = ref(false);
    const estAdmin = ref(false);
    const filtres = ref({ periode: "7", livreur: "", etat: "", numero: "" });
    const idChoisi = ref(new URLSearchParams(location.search).get("id"));
    const lecture = ref({ etat: "", url: "", recus: 0, total: 0, message: "" });
    const message = ref("");
    const messageType = ref("");
    const erreurListe = ref(false);

    const choisi = computed(() => liste.value.find((e) => e.id === idChoisi.value) || null);
    const livreurs = computed(() => [...new Set(liste.value.map((e) => e.nom).filter(Boolean))].sort());
    const etatDe = (e) => (e.garde ? "garde" : e.etat);
    const affiches = computed(() => {
      const { periode, livreur, etat, numero } = filtres.value;
      const minuit = new Date().setHours(0, 0, 0, 0);
      const debut = periode === "0" ? minuit : periode === "1" ? minuit - JOUR : Date.now() - 7 * JOUR;
      const fin = periode === "1" ? minuit : Infinity;
      return liste.value.filter((e) => {
        const t = enDate(e.debut)?.getTime() || Date.now();
        return t >= debut && t < fin
          && (!livreur || e.nom === livreur)
          && (!etat || e.etat === etat || (etat === "garde" && e.garde))
          && (!numero || String(e.numero || "").toLowerCase().includes(numero.trim().toLowerCase()));
      });
    });
    const duree = (e) => {
      const a = enDate(e.debut)?.getTime();
      const b = enDate(e.fin)?.getTime();
      if (!a || !b) return "—";
      const s = Math.max(0, Math.round((b - a) / 1000));
      return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
    };
    const libelleEtat = (e) => {
      if (e.etat === "interrompu") return `Interrompu${e.raison ? ` · ${e.raison}` : ""}`;
      if (e.etat === "en_cours") return `Envoi en cours · ${(e.morceaux || []).length} morceaux`;
      return "Complet";
    };
    const conservation = (e) => {
      if (e.garde) return "Gardé (incident)";
      const fin = enDate(e.expireAt)?.getTime();
      return fin ? `Expire dans ${Math.max(0, Math.ceil((fin - Date.now()) / JOUR))} j` : "—";
    };

    function fermerLecture() {
      if (lecture.value.url) URL.revokeObjectURL(lecture.value.url);
      lecture.value = { etat: "", url: "", recus: 0, total: 0, message: "" };
    }
    async function lire() {
      const id = idChoisi.value;
      fermerLecture();
      lecture.value = { ...lecture.value, etat: "charge" };
      try {
        const { data } = await consulterEnregistrement({ id });
        lecture.value.total = data.morceaux.length;
        if (!data.morceaux.length) {
          lecture.value = { ...lecture.value, etat: "erreur", message: "Aucun morceau n'est arrivé pour cet enregistrement." };
          return;
        }
        const parties = [];
        for (const index of data.morceaux) {
          const { data: f } = await lireFichierLivraison({ enregistrementId: id, index });
          parties.push(enOctets(f.base64));
          lecture.value = { ...lecture.value, recus: parties.length };
        }
        lecture.value = { ...lecture.value, etat: "pret", url: URL.createObjectURL(new Blob(parties, { type: data.mime })) };
      } catch (err) {
        console.error(err);
        lecture.value = { ...lecture.value, etat: "erreur", message: err.message || "Lecture impossible, réessayez." };
      }
    }
    function voir(e) {
      idChoisi.value = e.id;
      history.pushState(null, "", `?id=${e.id}`);
      scrollTo(0, 0);
      lire();
    }
    function retour() {
      fermerLecture();
      idChoisi.value = null;
      history.pushState(null, "", location.pathname);
    }
    async function garder(garde) {
      message.value = "";
      try {
        await garderIncident({ commandeId: choisi.value.commandeId, garde });
        message.value = garde ? "Gardé : ne sera pas supprimé après 7 jours." : "Suppression automatique rétablie.";
        messageType.value = "ok";
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
        const q = admin
          ? query(collection(db, "enregistrements"), orderBy("debut", "desc"), limit(300))
          : query(collection(db, "enregistrements"), where("livreurId", "==", compte?.data()?.livreurId || "-"));
        let premiere = true;
        onSnapshot(q, (snap) => {
          liste.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (enDate(b.debut)?.getTime() || 0) - (enDate(a.debut)?.getTime() || 0));
          charge.value = true;
          if (premiere && choisi.value) lire();
          premiere = false;
        }, (err) => { console.error(err); erreurListe.value = true; charge.value = true; });
      });
    });
    addEventListener("popstate", () => {
      fermerLecture();
      idChoisi.value = new URLSearchParams(location.search).get("id");
      if (choisi.value) lire();
    });

    return { liste, charge, erreurListe, messageType, estAdmin, filtres, livreurs, affiches, choisi, lecture, message, duree, libelleEtat, conservation, etatDe, dateHeure, voir, retour, garder, lire };
  },
}).mount("#enregistrementsApp");
