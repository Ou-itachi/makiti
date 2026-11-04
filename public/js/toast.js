// Petit message en bas de l'écran (ajout au panier, favoris) et pastille du
// panier animée. Aucun accès au DOM au chargement : ce module est aussi
// importé par le pré-rendu.
const COCHE = '<svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=2#i-check"/></svg>';
let boite = null;

export function toast(html) {
  if (!boite) {
    boite = document.createElement("div");
    boite.className = "toast-panier";
    boite.setAttribute("role", "status");
    document.body.append(boite);
  }
  boite.innerHTML = `${COCHE}${html}`;
  boite.classList.remove("on");
  void boite.offsetWidth;
  boite.classList.add("on");
  clearTimeout(boite._t);
  boite._t = setTimeout(() => boite.classList.remove("on"), 2600);
}

export function signalerAjoutPanier() {
  toast('<span>Ajouté au panier</span><span aria-hidden="true">·</span><a href="/panier">Voir le panier</a>');
  document.querySelectorAll("[data-panier-badge]").forEach((b) => {
    b.classList.remove("panier-bump");
    void b.offsetWidth;
    b.classList.add("panier-bump");
  });
}
