// Pré-rendu sur de fausses données, sans aucun accès réseau :
//   node tests/prerendu-fiches.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const texte = (s) => ({ stringValue: s });
const fiche = (id, nom, extra = {}) => ({
  name: `projects/x/databases/(default)/documents/produits/${id}`,
  fields: {
    infosGenerales: { mapValue: { fields: { nom: texte(nom), categorie: texte("telephones"), description: texte("Test $& $1") } } },
    prix: { mapValue: { fields: { prix: { integerValue: "500000" } } } },
    dateCreation: { timestampValue: "2026-01-01T00:00:00Z" },
    images: { arrayValue: { values: [] } },
    ...extra,
  },
});
const produits = [
  fiche("bon1", "Dollar $& et $1 et $'"),
  fiche("bon2", "Produit normal"),
  fiche("bon3", "Autre produit"),
  fiche("bon4", "Encore un"),
  fiche("casse", "Fiche cassée", { images: texte("pas-un-tableau") }), // hd.map n'existe pas sur un texte
];
globalThis.fetch = async (url) => {
  if (/\/produits\?pageSize/.test(url)) return Response.json({ documents: produits });
  if (/\/variantes\?/.test(url)) return Response.json({});
  if (/:runQuery/.test(url)) return Response.json([]);
  return new Response("", { status: 404 });
};
const { prerendre } = await import("../functions/prerender/coeur.mjs");
const r = await prerendre({ lire: async (f) => readFileSync(PUBLIC + f, "utf8"), dossierJS: PUBLIC + "js" });
const pages = Object.keys(r.fichiers).filter((c) => c.startsWith("/produit/"));
const dollar = r.fichiers[pages.find((c) => c.includes("bon1"))] ?? r.fichiers[pages.find((c) => /dollar/.test(c))];
const controles = [
  ["une fiche en erreur n'annule pas les autres", pages.length === 4 && r.fichesEnErreur.join() === "casse", `${pages.length} fiches, en erreur : ${r.fichesEnErreur}`],
  ["« $ » du nom gardé tel quel", Boolean(dollar?.includes("Dollar $&amp; et $1 et $&#39;") || dollar?.includes("Dollar $&amp; et $1 et $'")), String(dollar?.match(/<title>.*<\/title>/)?.[0])],
  ["accueil généré", Boolean(r.fichiers["/index.html"]), ""],
];
let echecs = 0;
for (const [nom, ok, detail] of controles) {
  if (!ok) echecs += 1;
  console.log(`${ok ? "OK   " : "ÉCHEC"} L. ${nom}${detail ? ` : ${detail}` : ""}`);
}
process.exit(echecs ? 1 : 0);
