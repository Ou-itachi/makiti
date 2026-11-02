// Livraison : ville libre → région → frais affichés au client.
//
// Le client écrit sa VILLE (champ libre, plus de liste de régions). On en
// déduit la région administrative grâce à VILLES_PAR_REGION, puis les frais
// de la région (FRAIS_LIVRAISON). Ville non reconnue : frais « annoncés par
// l'agent avant la livraison » (jamais « gratuit »).
//
// ⚠ TABLES DUPLIQUÉES : FRAIS_LIVRAISON et VILLES_PAR_REGION existent aussi
// dans functions/src/index.ts (FRAIS_LIVRAISON_PAR_REGION, VILLES_PAR_REGION,
// regionDeVille) — le serveur fait foi : il enregistre fraisLivraison (ou
// fraisAConfirmer) sur la commande. GARDER LES DEUX ALIGNÉES. Un frais saisi
// dans l'admin (collection « zones », champ « frais », zone = ville tapée ou
// région déduite) prime côté serveur.
//
// ⚠ Montants PROVISOIRES (à fournir par le propriétaire, voir le brief §5.3).
export const REGIONS = ["Conakry", "Boké", "Faranah", "Kankan", "Kindia", "Labé", "Mamou", "Nzérékoré"];

export const FRAIS_LIVRAISON = {
  Conakry: 0,
  Kindia: 50000,
  Boké: 75000,
  Mamou: 75000,
  Labé: 100000,
  Faranah: 100000,
  Kankan: 125000,
  Nzérékoré: 150000,
};

// Villes, préfectures, sous-préfectures et (pour Conakry) communes et
// quartiers connus → région. Écriture libre : la comparaison ignore
// accents, majuscules, espaces, tirets et apostrophes.
export const VILLES_PAR_REGION = {
  Conakry: [
    "Conakry", "Kaloum", "Dixinn", "Matam", "Ratoma", "Matoto", "Kipé", "Kipe Dadia", "Lambanyi", "Lambandji",
    "Sonfonia", "Sonfonia Gare", "Kagbélen", "Nongo", "Taouyah", "Koloma", "Hamdallaye", "Bambeto", "Cosa",
    "Kaporo", "Kaporo Rails", "Kobaya", "Yattayah", "Simbaya", "Gbessia", "Tombo", "Coronthie", "Boulbinet",
    "Almamya", "Sandervalia", "Coléah", "Landréah", "Dabompa", "Enta", "Yimbaya", "Sangoyah",
    "Kakimbo", "Wanindara", "Tombolia", "Lansanaya", "Dabondy", "Kissosso", "Bonfi",
    "Camayenne", "Kenien", "Hermakono", "Démoudoula", "Koléah", "Dixinn Port",
  ],
  Kindia: ["Kindia", "Coyah", "Dubréka", "Forécariah", "Télimélé", "Friguiagbé", "Maneah", "Kouria", "Mambia", "Wonkifong", "Benty", "Kolenté", "Sinta", "Tanéné"],
  Boké: ["Boké", "Kamsar", "Sangarédi", "Boffa", "Fria", "Gaoual", "Koundara", "Kolaboui", "Tougnifili", "Dabiss", "Kanfarandé", "Tormelin"],
  Mamou: ["Mamou", "Dalaba", "Pita", "Timbo", "Ouré Kaba", "Soyah", "Téliko", "Bodié", "Kankalabé", "Timbi Madina", "Ditinn"],
  Labé: ["Labé", "Koubia", "Lélouma", "Mali", "Mali Ville", "Tougué", "Popodara", "Dara Labé", "Kouramangui", "Yembéring", "Sannou"],
  Faranah: ["Faranah", "Dabola", "Dinguiraye", "Kissidougou", "Banian", "Tiro", "Marela", "Banko", "Selouma"],
  Kankan: ["Kankan", "Kérouané", "Kouroussa", "Mandiana", "Siguiri", "Kintinian", "Baro", "Norassoba", "Banankoro", "Doko", "Niandankoro", "Tokounou"],
  Nzérékoré: ["Nzérékoré", "Beyla", "Guéckédou", "Lola", "Macenta", "Yomou", "Diécké", "Bossou", "Sérédou", "Bounouma", "Koropara", "Sinko"],
};

// Suggestions discrètes (<datalist>) : la saisie reste libre.
export const VILLES_SUGGEREES = [
  "Conakry", "Kindia", "Boké", "Labé", "Mamou", "Kankan", "Nzérékoré", "Faranah", "Siguiri", "Kamsar",
  "Coyah", "Dubréka", "Kissidougou", "Guéckédou", "Macenta", "Fria", "Dalaba", "Pita", "Forécariah",
  "Télimélé", "Boffa", "Kouroussa", "Dabola", "Lola", "Beyla", "Kérouané", "Mandiana", "Koundara",
  "Gaoual", "Tougué", "Lélouma", "Koubia", "Mali", "Dinguiraye", "Yomou", "Sangarédi",
];

// « Nzérékoré », « N'ZEREKORE », « nzerekore » → « nzerekore ».
export function cleVille(texte) {
  return String(texte || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const INDEX_VILLES = new Map();
for (const [region, villes] of Object.entries(VILLES_PAR_REGION)) {
  for (const v of villes) INDEX_VILLES.set(cleVille(v), region);
}

// Région déduite d'une ville tapée, ou null si inconnue. Essaie le texte
// entier (« Sonfonia gare »), puis chaque mot en partant du DERNIER
// (« Kipé, Conakry », « Centre Kankan » : la ville vient souvent en fin).
// Noms de quartiers ambigus (Madina, Hafia, Minière… existent dans
// plusieurs villes) volontairement absents de la table.
export function regionDeVille(ville) {
  const entiere = cleVille(ville);
  if (!entiere) return null;
  if (INDEX_VILLES.has(entiere)) return INDEX_VILLES.get(entiere);
  for (const mot of String(ville).split(/[\s,;/()]+/).reverse()) {
    const r = INDEX_VILLES.get(cleVille(mot));
    if (r) return r;
  }
  return null;
}

// { region, frais } : frais null = « annoncés par l'agent avant la
// livraison » (ville non reconnue, ou région sans montant).
export function livraisonPourVille(ville) {
  const region = regionDeVille(ville);
  const f = region ? FRAIS_LIVRAISON[region] : undefined;
  return { region, frais: typeof f === "number" ? f : null };
}

// Message unique (brief §3) — à réutiliser tel quel partout.
export const MESSAGE_LIVRAISON = "Gratuite à Conakry ; autres régions : frais selon la région, annoncés avant la livraison";

export function fraisPour(region) {
  const f = FRAIS_LIVRAISON[region];
  return typeof f === "number" ? f : null;
}
