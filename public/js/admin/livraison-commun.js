// Outils partagés par les écrans de livraison et de gestion des livreurs.
export const STATUTS = {
  nouvelle: { label: "Nouvelle", cls: "gris" },
  confirmee: { label: "Confirmée", cls: "bleu" },
  en_preparation: { label: "En préparation", cls: "bleu" },
  en_livraison: { label: "En livraison", cls: "ambre" },
  livree: { label: "Livrée", cls: "vert" },
  en_negociation: { label: "En négociation", cls: "gris" },
  non_joignable: { label: "Non joignable", cls: "gris" },
  retournee: { label: "Retournée", cls: "rouge" },
  endommagee: { label: "Endommagée", cls: "rouge" },
  annulee_client: { label: "Annulée", cls: "rouge" },
};
export const LIBELLES_RAISON = {
  client_refuse: "Client a refusé",
  client_non_paye: "Client n'a pas payé",
  client_absent: "Client absent",
  autre: "Autre problème",
  refus: "Client a refusé",
  code_valide: "Code validé",
};
export const libelleRaison = (r) => LIBELLES_RAISON[r] || r || "";
export const infoStatut = (s) => STATUTS[s] || { label: s || "—", cls: "gris" };
export const fmt = (n) => Math.round(n || 0).toLocaleString("fr-FR").replace(/[\s, ]/g, " ");
export const initiales = (nom) => String(nom || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0].toUpperCase()).join("") || "?";
export const enDate = (t) => (t?.toDate ? t.toDate() : t ? new Date(t) : null);
export const dateHeure = (t) => enDate(t)?.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) || "—";
export const heure = (t) => enDate(t)?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) || "—";
export const cleMois = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const libelleMois = (d = new Date()) => d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
export const genererMotDePasse = () => {
  const lettres = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(10))].map((n) => lettres[n % lettres.length]).join("");
};
// Reste à payer d'un livreur : courses gagnées moins paiements enregistrés.
export function soldeLivreur(courses, paiements) {
  const gains = courses.reduce((t, c) => t + (Number(c.montantCourse) || 0), 0);
  const paye = paiements.reduce((t, p) => t + (Number(p.montant) || 0), 0);
  return { gains, paye, reste: gains - paye };
}
export const argentARemettre = (courses) => courses.filter((c) => !c.remiseId).reduce((t, c) => t + (Number(c.encaisse) || 0), 0);
