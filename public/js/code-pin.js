// Saisie du code personnel à 4 chiffres (maquettes Connexion / Identification) :
// 4 cases, passage automatique à la suivante, retour arrière, collage d'un
// code entier. Les cases sont des <input> masqués (type password).
// Bouton « œil » ajouté à côté des cases : affiche / masque le mot de passe
// (le client vérifie ce qu'il a tapé, surtout quand il le choisit).
const OEIL = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const OEIL_BARRE = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.7 8.5 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

export function brancherPin(conteneur, { surComplet } = {}) {
  const cases = [...conteneur.querySelectorAll("input")];
  const zone = conteneur.querySelector(".pin-cases");
  if (zone && !zone.querySelector(".pin-oeil")) {
    const oeil = document.createElement("button");
    oeil.type = "button";
    oeil.className = "pin-oeil";
    oeil.setAttribute("aria-pressed", "false");
    oeil.setAttribute("aria-label", "Afficher le mot de passe");
    oeil.innerHTML = OEIL;
    oeil.addEventListener("click", () => {
      const visible = oeil.getAttribute("aria-pressed") !== "true";
      cases.forEach((c) => { c.type = visible ? "text" : "password"; });
      oeil.setAttribute("aria-pressed", String(visible));
      oeil.setAttribute("aria-label", visible ? "Masquer le mot de passe" : "Afficher le mot de passe");
      oeil.innerHTML = visible ? OEIL_BARRE : OEIL;
    });
    zone.appendChild(oeil);
  }
  const valeur = () => cases.map((c) => c.value).join("");
  const remplir = (chiffres, depuis = 0) => {
    chiffres.split("").slice(0, cases.length - depuis).forEach((c, i) => { cases[depuis + i].value = c; });
    const suivant = cases.find((c) => !c.value);
    (suivant || cases[cases.length - 1]).focus();
    if (valeur().length === cases.length) surComplet?.(valeur());
  };
  cases.forEach((c, i) => {
    c.addEventListener("input", () => {
      const chiffres = c.value.replace(/\D/g, "");
      c.value = "";
      if (chiffres) remplir(chiffres, i);
      conteneur.removeAttribute("data-invalide");
    });
    c.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !c.value && i > 0) { cases[i - 1].value = ""; cases[i - 1].focus(); e.preventDefault(); }
      if (e.key === "ArrowLeft" && i > 0) cases[i - 1].focus();
      if (e.key === "ArrowRight" && i < cases.length - 1) cases[i + 1].focus();
    });
    c.addEventListener("paste", (e) => {
      const chiffres = (e.clipboardData?.getData("text") || "").replace(/\D/g, "");
      if (!chiffres) return;
      e.preventDefault();
      cases.forEach((x) => { x.value = ""; });
      remplir(chiffres, 0);
    });
    c.addEventListener("focus", () => c.select());
  });
  return {
    valeur,
    vider() { cases.forEach((c) => { c.value = ""; }); },
    focus() { (cases.find((c) => !c.value) || cases[0]).focus(); },
    invalide(oui) { if (oui) conteneur.setAttribute("data-invalide", ""); else conteneur.removeAttribute("data-invalide"); },
  };
}
