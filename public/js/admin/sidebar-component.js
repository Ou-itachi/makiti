// Sidebar admin partagée par toutes les pages (Tableau de bord, Commandes,
// Produits, Fournisseurs, Livreurs, Demandes, Étiquettes, Paramètres…) — un
// seul composant Vue.js, monté sur #adminSidebar dans chaque page, plutôt
// que la sidebar dupliquée en HTML statique sur chacune.
//
// Desktop (>900px) : visible en permanence, comportement inchangé.
// Mobile/tablette (≤900px) : cachée par défaut, ouverte via le bouton ☰
// (téléporté dans .topbar) en tiroir/overlay par-dessus le contenu, avec un
// fond semi-transparent cliquable pour refermer. Se referme aussi au clic
// sur un lien du menu ou avec Échap. Animation façon appli (ChatGPT,
// Claude) : le tiroir glisse depuis la gauche et pousse la page sur le côté,
// vite au début puis en ralentissant (styles dans admin.css ; la classe
// menu-ouvert sur <html> déclenche la poussée).
import { computed, createApp, ref, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { auth, db } from "../firebase-config.js";
import {
  collection,
  query,
  where,
  getCountFromServer,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// Icônes Phosphor (https://phosphoricons.com), chargées via le script
// @phosphor-icons/web inclus sur chaque page admin — <i class="ph ph-x">
// rendu tel quel par v-html, comme les anciens SVG en ligne.
const ICONS = {
  dashboard: '<i class="ph ph-squares-four" style="font-size:17px"></i>',
  commandes: '<i class="ph ph-file-text" style="font-size:17px"></i>',
  corbeille: '<i class="ph ph-trash" style="font-size:17px"></i>',
  etiquettes: '<i class="ph ph-tag" style="font-size:17px"></i>',
  produits: '<i class="ph ph-cube" style="font-size:17px"></i>',
  marges: '<i class="ph ph-chart-bar" style="font-size:17px"></i>',
  statistiques: '<i class="ph ph-lightning" style="font-size:17px"></i>',
  demandes: '<i class="ph ph-magnifying-glass" style="font-size:17px"></i>',
  fournisseurs: '<i class="ph ph-storefront" style="font-size:17px"></i>',
  maLivraison: '<i class="ph ph-package" style="font-size:17px"></i>',
  historique: '<i class="ph ph-clock" style="font-size:17px"></i>',
  creerLivreur: '<i class="ph ph-plus-square" style="font-size:17px"></i>',
  incidents: '<i class="ph ph-warning" style="font-size:17px"></i>',
  enregistrements: '<i class="ph ph-device-mobile" style="font-size:17px"></i>',
  paiements: '<i class="ph ph-currency-circle-dollar" style="font-size:17px"></i>',
  livreurs: '<i class="ph ph-truck" style="font-size:17px"></i>',
  parametres: '<i class="ph ph-gear-six" style="font-size:17px"></i>',
  boutique: '<i class="ph ph-storefront" style="font-size:17px"></i>',
  deconnexion: '<i class="ph ph-sign-out" style="font-size:17px"></i>',
  menu: '<i class="ph-bold ph-list" style="font-size:18px"></i>',
  back: '<i class="ph-bold ph-arrow-left" style="font-size:18px"></i>',
  close: '<i class="ph-bold ph-x" style="font-size:16px"></i>',
};

const NAV_ITEMS = [
  { href: "dashboard.html", label: "Tableau de bord", icon: ICONS.dashboard },
  { href: "commandes.html", label: "Commandes", icon: ICONS.commandes },
  { href: "corbeille-commandes.html", label: "Corbeille", icon: ICONS.corbeille },
  { href: "etiquettes-livraison.html", label: "Étiquettes", icon: ICONS.etiquettes },
  { href: "produits.html", label: "Produits", icon: ICONS.produits },
  { href: "marges.html", label: "Marges", icon: ICONS.marges },
  { href: "statistiques.html", label: "Statistiques", icon: ICONS.statistiques },
  { href: "demandes-produits.html", label: "Demandes", icon: ICONS.demandes },
  { href: "fournisseurs.html", label: "Fournisseurs", icon: ICONS.fournisseurs },
];
const LIVRAISON_ITEMS = [
  { href: "ma-livraison.html", label: "Ma livraison", icon: ICONS.maLivraison },
  { href: "historique.html", label: "Historique", icon: ICONS.historique },
];
const GESTION_ITEMS = [
  { href: "creer-livreur.html", label: "Créer un livreur", icon: ICONS.creerLivreur },
  { href: "livreurs.html", label: "Livreurs", icon: ICONS.livreurs },
  { href: "incidents.html", label: "Incidents et SOS", icon: ICONS.incidents },
  { href: "enregistrements.html", label: "Enregistrements", icon: ICONS.enregistrements },
  { href: "paiement-livreurs.html", label: "Paiement des livreurs", icon: ICONS.paiements },
];
// Un compte livreur : son tableau de bord et le groupe Livraison.
const TABLEAU_LIVREUR = { href: "tableau-livreur.html", label: "Tableau de bord", icon: ICONS.dashboard };
const ACCOUNT_ITEMS = [{ href: "parametres.html", label: "Paramètres", icon: ICONS.parametres }];

// commande-detail.html / fournisseur-detail.html sont des sous-pages : le
// lien du menu correspondant reste actif quand on les consulte.
const ACTIVE_ALIASES = {
  "commande-detail.html": "commandes.html",
  "fournisseur-detail.html": "fournisseurs.html",
  "fiche-livreur.html": "livreurs.html",
};

const mountEl = document.getElementById("adminSidebar");
if (mountEl) {
  createApp({
    setup() {
      const open = ref(false);
      // Compte livreur : tableau de bord, groupe Livraison et déconnexion.
      const livreurSeul = ref(document.documentElement.dataset.livreurSeul === "1");
      addEventListener("bokki:livreur-seul", () => { livreurSeul.value = true; });
      const currentFile = location.pathname.split("/").pop() || "dashboard.html";

      function isActive(href) {
        return href === (ACTIVE_ALIASES[currentFile] || currentFile);
      }
      function toggle() {
        open.value = !open.value;
      }
      function close() {
        open.value = false;
      }
      watch(open, (v) => document.documentElement.classList.toggle("menu-ouvert", v));
      addEventListener("keydown", (e) => { if (e.key === "Escape" && open.value) close(); });

      // Badge "Demandes" : nombre de demandes de produits pas encore
      // traitées (statut "nouvelle"), pas un chiffre codé en dur. Masqué à
      // 0 plutôt que d'afficher "0" en permanence sur le menu.
      const demandesNouvellesCount = ref(0);
      async function loadDemandesBadge() {
        try {
          const snap = await getCountFromServer(
            query(collection(db, "demandesProduits"), where("statut", "==", "nouvelle"))
          );
          demandesNouvellesCount.value = snap.data().count;
        } catch (err) {
          console.error(err);
        }
      }
      loadDemandesBadge();

      // Alertes (admins seulement : pour un livreur la lecture est refusée par
      // les règles et le bandeau reste absent). Son répété tant qu'un SOS n'est
      // pas pris en charge ; le navigateur peut l'exiger après un premier clic.
      const alertesActives = ref([]);
      const sosActifs = computed(() => alertesActives.value.filter((a) => a.type === "sos"));
      let contexteSon = null;
      function sonner() {
        try {
          contexteSon ||= new AudioContext();
          if (contexteSon.state === "suspended") contexteSon.resume();
          [0, 0.3, 0.6].forEach((decalage) => {
            const o = contexteSon.createOscillator();
            const g = contexteSon.createGain();
            o.frequency.value = 880;
            g.gain.value = 0.15;
            o.connect(g).connect(contexteSon.destination);
            const debut = contexteSon.currentTime + decalage;
            o.start(debut);
            o.stop(debut + 0.2);
          });
          window.__bokkiSon = (window.__bokkiSon || 0) + 1;
        } catch { /* son indisponible : le bandeau reste affiché */ }
      }
      let repetition = null;
      watch(() => sosActifs.value.length, (n, avant) => {
        document.documentElement.classList.toggle("sos-actif", n > 0);
        clearInterval(repetition);
        if (n > 0) repetition = setInterval(sonner, 15000);
        if (n > avant) sonner();
      });
      const arreterSuivi = onAuthStateChanged(auth, (user) => {
        if (!user) return;
        arreterSuivi();
        onSnapshot(query(collection(db, "alertes"), where("etat", "==", "active")), (snap) => {
          alertesActives.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }, () => undefined);
      });

      function badgeFor(item) {
        if (item.href === "incidents.html") {
          return alertesActives.value.length > 0 ? String(alertesActives.value.length) : null;
        }
        if (item.href === "demandes-produits.html") {
          return demandesNouvellesCount.value > 0 ? String(demandesNouvellesCount.value) : null;
        }
        return item.badge || null;
      }

      return { open, toggle, close, isActive, badgeFor, NAV_ITEMS, LIVRAISON_ITEMS, GESTION_ITEMS, TABLEAU_LIVREUR, ACCOUNT_ITEMS, ICONS, livreurSeul, sosActifs };
    },
    template: `
      <Teleport to=".topbar">
        <button type="button" class="sidebar-toggle" @click="toggle" :aria-label="open ? 'Retour' : 'Ouvrir le menu'" aria-haspopup="true" :aria-expanded="open">
          <span v-html="open ? ICONS.back : ICONS.menu"></span>
        </button>
      </Teleport>

      <div v-if="sosActifs.length" class="lv-sos-bandeau" role="alert">
        <span>SOS : {{ sosActifs[0].nom }}<template v-if="sosActifs[0].numero"> · {{ sosActifs[0].numero }}</template><template v-if="sosActifs.length > 1"> · {{ sosActifs.length }} alertes</template></span>
        <a :href="'incidents.html?id=' + sosActifs[0].id">Ouvrir</a>
      </div>

      <div class="sidebar-scrim" :class="{on: open}" @click="close" aria-hidden="true"></div>

      <aside class="sidebar" :class="{open: open}">
        <button type="button" class="sidebar-close" @click="close" aria-label="Fermer le menu"><span v-html="ICONS.close"></span></button>

        <div class="sb-logo"><span class="baobab-badge"><svg class="baobab" viewBox="0 0 120 120" aria-hidden="true"><g class="baobab-crown"><circle cx="60" cy="44" r="23"/><circle cx="37" cy="50" r="14"/><circle cx="83" cy="50" r="14"/><circle cx="49" cy="30" r="13"/><circle cx="73" cy="30" r="13"/></g><path class="baobab-trunk" d="M42,109 C42,88 50,70 53,55 L67,55 C70,70 78,88 78,109 C78,111 76,112 74,110.5 C70,108 66,107 60,107 C54,107 50,108 46,110.5 C44,112 42,111 42,109 Z"/></svg></span><span class="brand-word">Bokki<span class="dot"></span></span></div>

        <div class="sb-section" v-if="!livreurSeul">Général</div>
        <template v-if="!livreurSeul"><a v-for="item in NAV_ITEMS" :key="item.href" :href="item.href" class="sb-link" :class="{active: isActive(item.href)}" @click="close">
          <span v-html="item.icon"></span>
          {{ item.label }}
          <span v-if="badgeFor(item)" style="margin-left:auto;background:rgba(232,163,61,.2);color:var(--terre);font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px">{{ badgeFor(item) }}</span>
        </a></template>

        <a v-if="livreurSeul" :href="TABLEAU_LIVREUR.href" class="sb-link" :class="{active: isActive(TABLEAU_LIVREUR.href)}" @click="close">
          <span v-html="TABLEAU_LIVREUR.icon"></span>
          {{ TABLEAU_LIVREUR.label }}
        </a>

        <div class="sb-section">Livraison</div>
        <a v-for="item in LIVRAISON_ITEMS" :key="item.href" :href="item.href" class="sb-link" :class="{active: isActive(item.href)}" @click="close">
          <span v-html="item.icon"></span>
          {{ item.label }}
        </a>

        <template v-if="!livreurSeul">
        <div class="sb-section">Gestion des livraisons</div>
        <a v-for="item in GESTION_ITEMS" :key="item.href" :href="item.href" class="sb-link" :class="{active: isActive(item.href)}" @click="close">
          <span v-html="item.icon"></span>
          {{ item.label }}
          <span v-if="badgeFor(item)" class="sb-alerte">{{ badgeFor(item) }}</span>
        </a>
        </template>

        <div class="sb-spacer"></div>

        <template v-if="!livreurSeul">
        <div class="sb-section">Compte</div>
        <a v-for="item in ACCOUNT_ITEMS" :key="item.href" :href="item.href" class="sb-link" :class="{active: isActive(item.href)}" @click="close">
          <span v-html="item.icon"></span>
          {{ item.label }}
        </a>
        </template>

        <div class="sb-bottom">
          <a href="../index.html" class="sb-link" @click="close">
            <span v-html="ICONS.boutique"></span>
            Voir la boutique
          </a>
          <a href="login.html" class="sb-link" id="logoutBtn" @click="close">
            <span v-html="ICONS.deconnexion"></span>
            Déconnexion
          </a>
        </div>
      </aside>
    `,
  }).mount(mountEl);
}
