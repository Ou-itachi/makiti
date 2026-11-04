// Reçus de paiement : libellés, montant en lettres, PDF du reçu et de la fiche du
// mois, fenêtre de suppression. Le dû et le reste à payer ne dépendent jamais des
// reçus : supprimer un reçu retire seulement le document.
import { computed, ref } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { functions } from "../firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { creerPdf, couperTexte, largeurTexte, telechargerPdf } from "./pdf-texte.js";
import { enDate, fmt } from "./livraison-commun.js";
import { parLots } from "./selection-lot.js";

const supprimerRecus = httpsCallable(functions, "supprimerRecus");
// Conakry : les dates restent les mêmes quel que soit l'appareil.
const FUSEAU = "Africa/Conakry";

export const libelleMode = (mode) => (mode === "orange_money" ? "Orange Money" : "Espèces");
export const dateCourte = (t) => enDate(t)?.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: FUSEAU }) || "—";
export const dateLongue = (t) => enDate(t)?.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: FUSEAU }) || "—";
export const libelleBeneficiaire = (type) => (type === "livreur" ? "Livreur" : "Fournisseur");
export const moisCourant = () => new Date().toISOString().slice(0, 7);
export function libelleMoisCle(cle) {
  const [annee, mois] = String(cle).split("-").map(Number);
  const texte = new Date(Date.UTC(annee, mois - 1, 15)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}
export const totalRecus = (recus) => recus.reduce((t, r) => t + (Number(r.montant) || 0), 0);
export const collationNoms = new Intl.Collator("fr", { sensitivity: "base", ignorePunctuation: true });
export const parPrenom = (a, b) => collationNoms.compare(a.prenom || a.nom || "", b.prenom || b.nom || "");

const UNITES = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"];
const DIZAINES = { 2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante", 8: "quatre-vingt" };
function moinsDeCent(n) {
  if (n <= 16) return UNITES[n];
  if (n < 20) return `dix-${UNITES[n - 10]}`;
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 7 || d === 9) {
    const base = DIZAINES[d - 1];
    const reste = moinsDeCent(10 + u);
    return d === 7 && u === 1 ? `${base} et ${reste}` : `${base}-${reste}`;
  }
  if (u === 0) return d === 8 ? "quatre-vingts" : DIZAINES[d];
  return u === 1 && d !== 8 ? `${DIZAINES[d]} et un` : `${DIZAINES[d]}-${UNITES[u]}`;
}
function moinsDeMille(n, final = true) {
  const c = Math.floor(n / 100);
  const r = n % 100;
  const fin = r === 0 ? "" : moinsDeCent(r);
  const finale = !final && fin === "quatre-vingts" ? "quatre-vingt" : fin;
  if (c === 0) return finale;
  if (c === 1) return finale ? `cent ${finale}` : "cent";
  if (r === 0) return `${UNITES[c]} ${final ? "cents" : "cent"}`;
  return `${UNITES[c]} cent ${finale}`;
}
export function nombreEnLettres(valeur) {
  const n = Math.abs(Math.trunc(Number(valeur) || 0));
  if (n === 0) return "zéro";
  const groupes = [];
  let reste = n;
  while (reste > 0) { groupes.push(reste % 1000); reste = Math.floor(reste / 1000); }
  const noms = ["", "mille", "million", "milliard", "billion", "billiard"];
  const mots = groupes.map((g, i) => {
    if (!g) return "";
    if (i === 1) return g === 1 ? "mille" : `${moinsDeMille(g, false)} mille`;
    if (i === 0) return moinsDeMille(g);
    return `${moinsDeMille(g)} ${noms[i]}${g > 1 ? "s" : ""}`;
  }).reverse().filter(Boolean);
  return mots.join(" ");
}
export function montantEnLettres(montant) {
  const n = Math.abs(Math.trunc(Number(montant) || 0));
  return `${Number(montant) < 0 ? "moins " : ""}${nombreEnLettres(n)} franc${n > 1 ? "s" : ""} guinéen${n > 1 ? "s" : ""}`;
}

const NOIR = [10, 10, 10];
const GRIS = [99, 99, 107];
const MARGE = 56;

function tailleTenant(texte, tailleMax, largeur, gras) {
  let taille = tailleMax;
  while (taille > 10 && largeurTexte(texte, taille, gras) > largeur) taille -= 1;
  return taille;
}
function enTete(pdf, titre) {
  pdf.texte(MARGE, 76, "Bokki.", { taille: 24, gras: true });
  pdf.texte(MARGE, 96, titre, { taille: 11, couleur: GRIS });
  pdf.ligne(MARGE, 110, pdf.largeur - MARGE, 110);
}
const nomFichier = (texte) => String(texte).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export function pdfRecu(recu) {
  const pdf = creerPdf({ titre: `Reçu ${recu.numero}` });
  const droite = pdf.largeur - MARGE;
  const utile = droite - MARGE;
  enTete(pdf, "Reçu de paiement");
  pdf.texte(droite, 76, recu.numero, { taille: 14, gras: true, align: "droite" });

  let y = 150;
  pdf.texte(MARGE, y, Number(recu.montant) < 0 ? "Correction" : "Montant versé", { taille: 11, couleur: GRIS });
  y += 34;
  const montant = `${fmt(recu.montant)} GNF`;
  pdf.texte(MARGE, y, montant, { taille: tailleTenant(montant, 30, utile, true), gras: true });
  y += 20;
  for (const ligne of couperTexte(montantEnLettres(recu.montant), 11, utile)) {
    pdf.texte(MARGE, y, ligne, { taille: 11, couleur: GRIS });
    y += 15;
  }
  y += 14;
  const lignes = [
    [libelleBeneficiaire(recu.type), recu.nom || "—"],
    ["Date", dateLongue(recu.date)],
    ["Mode", libelleMode(recu.mode)],
    ["Payé par", recu.payePar || "—"],
    ...(recu.note ? [["Note", recu.note]] : []),
  ];
  for (const [libelle, valeur] of lignes) {
    pdf.ligne(MARGE, y, droite, y);
    y += 22;
    pdf.texte(MARGE, y, libelle, { taille: 11, couleur: GRIS });
    for (const morceau of couperTexte(valeur, 11, utile - 110, true)) {
      pdf.texte(droite, y, morceau, { taille: 11, gras: true, align: "droite" });
      y += 15;
    }
    y += 3;
  }
  pdf.ligne(MARGE, y, droite, y);
  y += 26;
  const pied = [recu.resteApres != null ? `${recu.type === "livreur" ? "Reste à payer" : "Reste dû"} après ce paiement : ${fmt(recu.resteApres)} GNF.` : "", "Document interne Bokki."].filter(Boolean).join(" ");
  for (const ligne of couperTexte(pied, 10, utile)) {
    pdf.texte(MARGE, y, ligne, { taille: 10, couleur: GRIS });
    y += 14;
  }
  return pdf.octets();
}
export const telechargerRecu = (recu) => telechargerPdf(pdfRecu(recu), `recu-${nomFichier(recu.numero)}.pdf`);

export function pdfFiche({ nom, type, mois, recus }) {
  const pdf = creerPdf({ titre: `Fiche ${libelleMoisCle(mois)} ${nom}` });
  const droite = pdf.largeur - MARGE;
  const COLS = { recu: MARGE, date: MARGE + 90, mode: MARGE + 200 };
  const entetes = (y) => {
    pdf.rectangle(MARGE, y - 13, droite - MARGE, 20, [247, 247, 248]);
    pdf.texte(COLS.recu + 6, y, "Reçu", { taille: 10, gras: true });
    pdf.texte(COLS.date, y, "Date", { taille: 10, gras: true });
    pdf.texte(COLS.mode, y, "Mode", { taille: 10, gras: true });
    pdf.texte(droite - 6, y, "Montant", { taille: 10, gras: true, align: "droite" });
    return y + 24;
  };
  enTete(pdf, `Fiche du mois · ${libelleMoisCle(mois)}`);
  let y = 140;
  const taille = tailleTenant(nom, 18, droite - MARGE, true);
  for (const ligne of couperTexte(nom, taille, droite - MARGE, true)) {
    pdf.texte(MARGE, y, ligne, { taille, gras: true });
    y += taille + 5;
  }
  pdf.texte(MARGE, y, libelleBeneficiaire(type), { taille: 11, couleur: GRIS });
  y = entetes(y + 30);
  if (!recus.length) {
    pdf.texte(MARGE + 6, y, "Aucun reçu ce mois-ci.", { taille: 11, couleur: GRIS });
    y += 22;
  }
  for (const r of recus) {
    if (y > pdf.hauteur - 90) {
      pdf.page();
      y = entetes(70);
    }
    pdf.texte(COLS.recu + 6, y, r.numero, { taille: 10.5, gras: true });
    pdf.texte(COLS.date, y, dateCourte(r.date), { taille: 10.5 });
    pdf.texte(COLS.mode, y, libelleMode(r.mode), { taille: 10.5 });
    pdf.texte(droite - 6, y, `${fmt(r.montant)} GNF`, { taille: 10.5, gras: true, align: "droite" });
    pdf.ligne(MARGE, y + 8, droite, y + 8);
    y += 24;
  }
  pdf.texte(COLS.recu + 6, y + 6, "Total du mois", { taille: 12, gras: true, couleur: NOIR });
  const total = `${fmt(totalRecus(recus))} GNF`;
  pdf.texte(droite - 6, y + 6, total, { taille: tailleTenant(total, 12, 240, true), gras: true, align: "droite" });
  return pdf.octets();
}
export const telechargerFiche = (fiche) => telechargerPdf(pdfFiche(fiche), `fiche-${fiche.mois}-${nomFichier(fiche.nom)}.pdf`);

// Fenêtre de suppression de reçus, commune aux fournisseurs et aux livreurs.
export function suppressionRecus(motDu, apres = () => {}) {
  const liste = ref([]);
  const envoi = ref(false);
  const erreur = ref("");
  const ouverte = computed(() => liste.value.length > 0);
  const titre = computed(() => `Supprimer ${liste.value.length} reçu${liste.value.length > 1 ? "s" : ""} ?`);
  const texte = computed(() => {
    const noms = liste.value.map((r) => r.numero);
    const vus = noms.length > 4 ? `${noms.slice(0, 3).join(", ")} et ${noms.length - 3} autres` : noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0];
    return `${vus}, soit ${fmt(totalRecus(liste.value))} GNF.`;
  });
  const note = computed(() => (liste.value.length > 1
    ? `Les reçus disparaissent de l'application. Les paiements restent faits et ${motDu} ne change pas. Une ligne courte reste au journal.`
    : `Le reçu disparaît de l'application. Le paiement reste fait et ${motDu} ne change pas. Une ligne courte reste au journal.`));
  const libelle = computed(() => `Supprimer ${liste.value.length} reçu${liste.value.length > 1 ? "s" : ""}`);
  const demander = (recus) => { erreur.value = ""; liste.value = recus; };
  const annuler = () => { if (!envoi.value) liste.value = []; };
  async function confirmer() {
    envoi.value = true;
    erreur.value = "";
    try {
      await parLots(liste.value.map((r) => r.id), (ids) => supprimerRecus({ ids }));
      liste.value = [];
      apres();
    } catch (err) {
      console.error(err);
      erreur.value = err.message || "Suppression impossible, réessayez.";
    } finally {
      envoi.value = false;
    }
  }
  return { ouverte, titre, texte, note, libelle, envoi, erreur, demander, annuler, confirmer };
}
