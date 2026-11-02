// Brouillon de formulaire gardé sur le téléphone : une coupure de réseau,
// un rechargement ou une fermeture de l'onglet ne font jamais perdre la
// saisie. Jamais de code personnel ni de mot de passe dans le brouillon.
const PREFIXE = "bokki-brouillon:";
const DUREE = 14 * 24 * 3600 * 1000; // brouillon oublié au bout de 14 jours

function champs(form) {
  const els = form.elements ? [...form.elements] : [...form.querySelectorAll("input, textarea, select")];
  return els.filter((el) =>
    (el.id || el.name)
    && !el.disabled
    && !el.closest("[data-sans-brouillon]")
    && !el.hasAttribute("data-sans-brouillon")
    && (el.tagName === "TEXTAREA" || el.tagName === "SELECT"
      || (el.tagName === "INPUT" && ["text", "tel", "email", "number", "search", ""].includes(el.type)))
    && el.autocomplete !== "one-time-code"
    && el.inputMode !== "numeric" // codes à chiffres (code personnel, livraison)
  );
}
const cleChamp = (el) => el.id || el.name;

// Restaure le brouillon (champs vides seulement, sauf `ecraser`) puis le met
// à jour à chaque saisie. `form` : un <form> ou tout conteneur de champs.
// Renvoie { restaures: Set<clé>, restaurer(), effacer() }.
export function brancherBrouillon(form, cle, { ecraser = true } = {}) {
  const k = PREFIXE + cle;
  const restaures = new Set();
  if (!form) return { restaures, restaurer() {}, effacer() {} };
  const restaurer = () => { try {
    const b = JSON.parse(localStorage.getItem(k) || "null");
    if (b && Date.now() - b.t < DUREE) {
      for (const el of champs(form)) {
        const v = b.v[cleChamp(el)];
        if (typeof v !== "string" || v === "") continue;
        if (!ecraser && el.value && el.tagName !== "SELECT") continue;
        if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === v)) continue;
        el.value = v;
        restaures.add(cleChamp(el));
      }
    } else if (b) localStorage.removeItem(k);
  } catch { /* brouillon illisible : ignoré */ } };
  restaurer();

  let minuterie = null;
  const sauver = () => {
    clearTimeout(minuterie);
    minuterie = null;
    const v = {};
    for (const el of champs(form)) if (el.value) v[cleChamp(el)] = el.value.slice(0, 2000);
    try {
      if (Object.keys(v).length) localStorage.setItem(k, JSON.stringify({ t: Date.now(), v }));
      else localStorage.removeItem(k);
    } catch { /* stockage plein */ }
  };
  const planifier = () => { clearTimeout(minuterie); minuterie = setTimeout(sauver, 300); };
  form.addEventListener("input", planifier);
  form.addEventListener("change", planifier);
  // Onglet fermé / application mise en arrière-plan : sauvegarde immédiate.
  addEventListener("pagehide", () => { if (minuterie) sauver(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && minuterie) sauver(); });

  return {
    restaures,
    restaurer,
    effacer() {
      clearTimeout(minuterie);
      minuterie = null;
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    },
  };
}
