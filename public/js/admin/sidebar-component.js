// Sidebar admin partagée par toutes les pages (Tableau de bord, Commandes,
// Produits, Fournisseurs, Livreurs, Demandes, Étiquettes, Paramètres…) — un
// seul composant Vue.js, monté sur #adminSidebar dans chaque page, plutôt
// que la sidebar dupliquée en HTML statique sur chacune.
//
// Desktop (>900px) : visible en permanence, comportement inchangé.
// Mobile/tablette (≤900px) : cachée par défaut, ouverte via le bouton ☰
// (téléporté dans .topbar) en tiroir/overlay par-dessus le contenu, avec un
// fond semi-transparent cliquable pour refermer. Se referme aussi au clic
// sur un lien du menu ou avec Échap. Le tiroir glisse par-dessus la page,
// vite au début puis en ralentissant (styles dans admin.css).
import { computed, createApp, onMounted, ref, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db } from "../firebase-base.js";
import { auth } from "../auth-client.js";
import { useListeCache } from "./liste-cache.js";
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
  localisation: '<i class="ph ph-map-pin" style="font-size:17px"></i>',
  enregistrements: '<i class="ph ph-device-mobile" style="font-size:17px"></i>',
  paiements: '<i class="ph ph-currency-circle-dollar" style="font-size:17px"></i>',
  versements: '<i class="ph ph-note" style="font-size:17px"></i>',
  livreurs: '<i class="ph ph-truck" style="font-size:17px"></i>',
  parametres: '<i class="ph ph-gear-six" style="font-size:17px"></i>',
  boutique: '<i class="ph ph-storefront" style="font-size:17px"></i>',
  deconnexion: '<i class="ph ph-sign-out" style="font-size:17px"></i>',
  menu: '<i class="ph-bold ph-list" style="font-size:18px"></i>',
  back: '<i class="ph-bold ph-arrow-left" style="font-size:18px"></i>',
  close: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>',
};

const NAV_ITEMS = [
  { href: "dashboard.html", label: "Tableau de bord", icon: ICONS.dashboard },
  { href: "commandes.html", label: "Commandes", icon: ICONS.commandes },
  { href: "corbeille-commandes.html", label: "Corbeille", icon: ICONS.corbeille },
  { href: "etiquettes-livraison.html", label: "Étiquettes", icon: ICONS.etiquettes },
  { href: "produits.html", label: "Produits", icon: ICONS.produits },
  { href: "journal-versements.html", label: "Journal de versement", icon: ICONS.versements },
  { href: "marges.html", label: "Marges", icon: ICONS.marges },
  { href: "statistiques.html", label: "Statistiques", icon: ICONS.statistiques },
  { href: "demandes-produits.html", label: "Demandes", icon: ICONS.demandes },
  { href: "fournisseurs.html", label: "Fournisseurs", icon: ICONS.fournisseurs },
  { href: "versements-fournisseurs.html", label: "Versements fournisseurs", icon: ICONS.versements },
];
const LIVRAISON_ITEMS = [
  { href: "ma-livraison.html", label: "Ma livraison", icon: ICONS.maLivraison },
  { href: "historique.html", label: "Historique", icon: ICONS.historique },
];
const GESTION_ITEMS = [
  { href: "creer-livreur.html", label: "Créer un livreur", icon: ICONS.creerLivreur },
  { href: "livreurs.html", label: "Livreurs", icon: ICONS.livreurs },
  { href: "localisation.html", label: "Localisation", icon: ICONS.localisation },
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
  "recu.html": "versements-fournisseurs.html",
  "versements.html": "journal-versements.html",
};

const CLE_DEFIL_MENU = "bokki-menu-defil";
const CLE_SOS_CONNU = "bokki-sos-bandeau";
function lireSosConnu() {
  try {
    return JSON.parse(sessionStorage.getItem(CLE_SOS_CONNU));
  } catch {
    return null;
  }
}

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
      // Le menu reste à sa place d'une page à l'autre : le lien actif ne sort pas de l'écran.
      onMounted(() => {
        const barre = mountEl.querySelector(".sidebar") || document.querySelector(".sidebar");
        if (!barre) return;
        barre.scrollTop = Number(sessionStorage.getItem(CLE_DEFIL_MENU)) || 0;
        addEventListener("pagehide", () => sessionStorage.setItem(CLE_DEFIL_MENU, String(barre.scrollTop)));
      });
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

      // Alertes (admins seulement : pour un livreur la lecture est refusée par
      // les règles et le bandeau reste absent). Son répété tant qu'un SOS n'est
      // pas pris en charge ; le navigateur peut l'exiger après un premier clic.
      const alertesActives = ref([]);
      const sosActifs = computed(() => alertesActives.value.filter((a) => a.type === "sos"));
      // D'une page à l'autre, le bandeau est là dès le premier affichage : sans
      // ce souvenir, chaque navigation décalait toute la page quand il arrivait.
      const sosConnu = ref(lireSosConnu());
      const sosAffiche = computed(() => (sosActifs.value.length ? { ...sosActifs.value[0], total: sosActifs.value.length } : sosConnu.value));
      // Sans réseau, la copie du téléphone ne prouve pas qu'il n'y a aucun SOS.
      const { enCache: alertesEnCache, noter: noterAlertes } = useListeCache();
      const alertesIncertaines = computed(() => alertesEnCache.value && !livreurSeul.value && !sosAffiche.value);
      watch(alertesIncertaines, (v) => document.documentElement.classList.toggle("sos-actif", v || !!sosAffiche.value));
      const sosArrive = ref(false);
      let sosDejaAffiche = !!sosConnu.value;
      document.documentElement.classList.toggle("sos-actif", !!sosConnu.value);
      function retenirSos() {
        const a = sosActifs.value[0];
        sosConnu.value = null;
        document.documentElement.classList.toggle("sos-actif", !!a);
        try {
          if (a) sessionStorage.setItem(CLE_SOS_CONNU, JSON.stringify({ id: a.id, nom: a.nom, numero: a.numero || "", total: sosActifs.value.length }));
          else sessionStorage.removeItem(CLE_SOS_CONNU);
        } catch { /* stockage indisponible : le bandeau arrive un peu plus tard */ }
      }
      function oublierSos() {
        sosConnu.value = null;
        sessionStorage.removeItem(CLE_SOS_CONNU);
      }
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
        if (n > avant && !sosDejaAffiche) sosArrive.value = true;
        sosDejaAffiche = false;
        clearInterval(repetition);
        if (n > 0) repetition = setInterval(sonner, 15000);
        if (n > avant) sonner();
      });
      function suivreEquipe() {
        loadDemandesBadge();
        onSnapshot(query(collection(db, "alertes"), where("etat", "==", "active")), { includeMetadataChanges: true }, (snap) => {
          alertesActives.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          noterAlertes("alertes", snap.metadata.fromCache);
          if (!snap.metadata.fromCache || sosActifs.value.length) retenirSos();
        }, (err) => {
          if (err.code === "permission-denied") { alertesActives.value = []; retenirSos(); }
          else noterAlertes("alertes", true);
        });
      }
      const arreterSuivi = onAuthStateChanged(auth, (user) => {
        if (!user) { oublierSos(); document.documentElement.classList.remove("sos-actif"); return; }
        arreterSuivi();
        // Le compteur et les alertes sont refusés à un compte livreur : sur un
        // appareil déjà reconnu comme tel (auth-guard.js), on attend la
        // vérification du compte (deux requêtes de moins à chaque page). Partout
        // ailleurs on écoute tout de suite : un SOS ne doit jamais en dépendre.
        // Attendre pour tout le monde serait pire : une écoute ajoutée pendant
        // l'arrivée d'une grosse liste faisait renvoyer toute la liste.
        let lance = false;
        const lancer = () => { if (!lance) { lance = true; suivreEquipe(); } };
        let livreurConnu = false;
        try { livreurConnu = localStorage.getItem("bokki-appareil-livreur") === "1"; } catch { /* stockage indisponible */ }
        if (!livreurConnu || window.__bokkiRole === "equipe") lancer();
        else if (!livreurSeul.value) {
          addEventListener("bokki:role-connu", lancer, { once: true });
          setTimeout(() => { if (!livreurSeul.value) lancer(); }, 15000);
        }
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

      return { open, toggle, close, isActive, badgeFor, NAV_ITEMS, LIVRAISON_ITEMS, GESTION_ITEMS, TABLEAU_LIVREUR, ACCOUNT_ITEMS, ICONS, livreurSeul, sosAffiche, sosArrive, oublierSos, alertesIncertaines };
    },
    template: `
      <Teleport to=".topbar">
        <button type="button" class="sidebar-toggle" @click="toggle" :aria-label="open ? 'Retour' : 'Ouvrir le menu'" aria-haspopup="true" :aria-expanded="open">
          <span v-html="open ? ICONS.back : ICONS.menu"></span>
        </button>
      </Teleport>

      <div v-if="sosAffiche" class="lv-sos-bandeau" :class="{arrive: sosArrive}" role="alert">
        <span>SOS : {{ sosAffiche.nom }}<template v-if="sosAffiche.numero"> · {{ sosAffiche.numero }}</template><template v-if="sosAffiche.total > 1"> · {{ sosAffiche.total }} alertes</template></span>
        <a :href="'incidents.html?id=' + sosAffiche.id">Ouvrir</a>
      </div>

      <div v-if="alertesIncertaines" class="lv-sos-bandeau" role="alert">
        <span>Connexion impossible : SOS non vérifiés</span>
        <a href="incidents.html">Ouvrir</a>
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
          <a href="login.html" class="sb-link" id="logoutBtn" @click="close(); oublierSos()">
            <span v-html="ICONS.deconnexion"></span>
            Déconnexion
          </a>
        </div>
      </aside>
    `,
  }).mount(mountEl);
}
