// Menu mobile du site public : nav.mainnav (Téléphones/Ordinateurs/...) est
// masqué sous 900px par le CSS (client.css) sans aucun moyen d'y accéder —
// ce script ajoute le bouton ☰ (à gauche de l'en-tête) qui l'affiche en
// tiroir déroulant, et le referme au clic sur un lien ou en dehors.
(function () {
  const hdrRow = document.querySelector(".hdr-row");
  const nav = document.querySelector("nav.mainnav");
  if (!hdrRow || !nav) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nav-toggle";
  btn.setAttribute("aria-label", "Ouvrir le menu");
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = '<i class="ph-bold ph-list" style="font-size:18px"></i>';
  hdrRow.insertBefore(btn, hdrRow.firstChild);

  function closeMenu() {
    nav.classList.remove("mobile-open");
    btn.setAttribute("aria-expanded", "false");
  }
  function toggleMenu() {
    const open = nav.classList.toggle("mobile-open");
    btn.setAttribute("aria-expanded", String(open));
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMenu));
  document.addEventListener("click", (e) => {
    if (nav.classList.contains("mobile-open") && !nav.contains(e.target) && e.target !== btn) closeMenu();
  });
})();
