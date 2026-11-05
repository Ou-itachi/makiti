// « Livreurs » : tous ceux qui peuvent livrer. Les admins apparaissent
// automatiquement, sans compte livreur et sans paiement par course.
import { createApp, ref, computed } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db, functions } from "../firebase-config.js";
import { collection, getDocs, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { argentARemettre, cleMois, fmt, libelleMois, soldeLivreur } from "./livraison-commun.js";
import { useListeCache } from "./liste-cache.js";

const listerAdmins = httpsCallable(functions, "listerAdmins");

createApp({
  setup() {
    const livreurs = ref([]);
    const { incertain, enCache, noter } = useListeCache();
    const admins = ref([]);
    const courses = ref([]);
    const paiements = ref([]);
    const alertes = ref([]);
    const charge = ref(false);
    const erreurListe = ref(false);
    const recherche = ref("");
    const mois = cleMois();

    const lignes = computed(() => {
      const pour = (liste, id) => liste.filter((x) => x.livreurId === id);
      const ligne = (id, base) => {
        const cs = pour(courses.value, id);
        return {
          ...base, id,
          livraisonsMois: cs.filter((c) => c.mois === mois).length,
          incidents: pour(alertes.value, id).length,
          aRemettre: argentARemettre(cs),
          reste: base.role === "Admin" ? null : soldeLivreur(cs, pour(paiements.value, id)).reste,
        };
      };
      const toutes = [
        ...admins.value.map((a) => ligne(a.id, { nom: a.vous ? `${a.nom} (vous)` : a.nom, role: "Admin", telephone: a.telephone, email: "", actif: true })),
        ...livreurs.value.map((l) => ligne(l.id, { nom: l.nom, role: "Livreur", telephone: l.telephone, email: l.compteEmail || "", actif: l.actif !== false })),
      ];
      const terme = recherche.value.trim().toLowerCase();
      return terme ? toutes.filter((l) => `${l.nom} ${l.telephone} ${l.email}`.toLowerCase().includes(terme)) : toutes;
    });

    onSnapshot(query(collection(db, "livreurs"), orderBy("nom")), { includeMetadataChanges: true }, (snap) => {
      noter("livreurs", snap.metadata.fromCache);
      livreurs.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      charge.value = true;
    }, (err) => { console.error(err); erreurListe.value = true; charge.value = true; });
    listerAdmins().then((r) => { admins.value = r.data.admins; }).catch(console.error);
    const lire = (nom, cible) => getDocs(collection(db, nom)).then((s) => { noter(nom, s.metadata.fromCache); cible.value = s.docs.map((d) => d.data()); }).catch(console.error);
    lire("courses", courses);
    lire("paiementsLivreurs", paiements);
    lire("alertes", alertes);

    return { lignes, charge, erreurListe, incertain, enCache, recherche, fmt, moisTexte: libelleMois() };
  },
}).mount("#livreursApp");
