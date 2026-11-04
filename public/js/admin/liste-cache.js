// Listes lues depuis la copie du téléphone faute de réseau. Firestore sert le
// cache sans erreur : une liste vide ou un montant ancien ressemblent alors à
// des données à jour. En production, presque chaque ouverture passe un court
// instant par le cache avant la réponse du serveur : l'avertissement attend
// donc quelques secondes pour ne pas clignoter à chaque page.
import { ref } from "/vendor/vue-3.5.42.esm-browser.prod.js";

const DELAI_AVERTISSEMENT = 3000;

export function useListeCache() {
  // incertain : tout de suite, pour ne pas affirmer qu'une liste est vide.
  // enCache : après le délai, pour afficher l'avertissement.
  const incertain = ref(false);
  const enCache = ref(false);
  const sources = new Set();
  let minuteur = null;
  // Une page peut lire plusieurs listes : chacune se note sous son nom.
  function noter(source, depuisCache) {
    if (depuisCache) sources.add(source);
    else sources.delete(source);
    incertain.value = sources.size > 0;
    if (!sources.size) {
      clearTimeout(minuteur);
      minuteur = null;
      enCache.value = false;
      return;
    }
    if (enCache.value || minuteur) return;
    minuteur = setTimeout(() => {
      minuteur = null;
      enCache.value = true;
      dispatchEvent(new Event("bokki:donnees-cache")); // bandeau de reseau.js
    }, DELAI_AVERTISSEMENT);
  }
  return { incertain, enCache, noter };
}
