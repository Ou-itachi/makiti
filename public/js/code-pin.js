// Saisie du code personnel à 4 chiffres (maquettes Connexion / Identification) :
// 4 cases, passage automatique à la suivante, retour arrière, collage d'un
// code entier. Les cases sont des <input> masqués (type password).
export function brancherPin(conteneur, { surComplet } = {}) {
  const cases = [...conteneur.querySelectorAll("input")];
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
