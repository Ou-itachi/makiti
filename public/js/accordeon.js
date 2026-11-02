// Accordéon des questions (.acc-q / .acc-a) hors de la page FAQ, qui a le
// sien (js/faq.js, avec recherche et filtres). Le texte des réponses est
// dans le HTML : il reste lisible par les moteurs et sert au FAQPage.
document.addEventListener("click", (e) => {
  const q = e.target.closest(".acc-q");
  if (!q || q.closest("#faqListe")) return;
  const ouvert = q.getAttribute("aria-expanded") !== "true";
  q.setAttribute("aria-expanded", String(ouvert));
  const r = document.getElementById(q.getAttribute("aria-controls"));
  if (r) r.hidden = !ouvert;
});
