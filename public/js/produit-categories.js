// Source de vérité unique pour les catégories de produits : quels champs
// existent par catégorie (essentiel = filtre client futur + affiché,
// secondaire = affiché seulement, constant = jamais demandé à l'admin),
// et quelles dimensions forment les variantes (chaque variante porte son
// propre prix + stock, jamais un prix générique du produit).
//
// marque, prix, état, garantie ne sont volontairement PAS répétés ici même
// s'ils apparaissent dans la liste "essentiel/secondaire" du cahier des
// charges par catégorie : ils vivent respectivement dans infosGenerales
// (marque, etat, garantie) et dans le bloc prix dédié (caracteristiques.prix
// ou variantes[].prix), pour éviter un champ dupliqué à deux endroits.
// Utilisé par l'admin (rendu dynamique du formulaire produit) et par la
// fiche produit publique (labels des caractéristiques + sélecteur de
// variante).

// Couleur -> hex, pour les pastilles de variante (fiche produit) et les
// cartes produit (aperçu couleur avant ouverture de la fiche). Partagé pour
// éviter deux mappings divergents entre les deux endroits qui les affichent.
export const COULEUR_HEX = {
  noir: "#000000",
  blanc: "#ffffff",
  bleu: "#1e40af",
  "bleu marine": "#1e3a5f",
  "bleu nuit": "#1e293b",
  rouge: "#dc2626",
  vert: "#16a34a",
  gris: "#6b7280",
  "gris sidéral": "#4b5563",
  or: "#d4af37",
  doré: "#d4af37",
  argent: "#c0c0c0",
  argenté: "#c0c0c0",
  rose: "#ec4899",
  "rose gold": "#e8b4b8",
  jaune: "#eab308",
  violet: "#7c3aed",
  marron: "#78350f",
  orange: "#f97316",
  beige: "#d6c7a1",
  turquoise: "#14b8a6",
  kaki: "#5c6b3f",
  bordeaux: "#7f1d1d",
  champagne: "#f0dfc0",
};

export function couleurHex(nom) {
  return COULEUR_HEX[(nom || "").trim().toLowerCase()] || null;
}

export const PRODUIT_CATEGORIES = {
  "Téléphones": {
    essentiel: [
      { key: "stockage", label: "Stockage", type: "text", placeholder: "Ex. 128 Go" },
      { key: "couleur", label: "Couleur", type: "text", placeholder: "Ex. Noir" },
      { key: "ram", label: "RAM", type: "text", placeholder: "Ex. 8 Go" },
      { key: "reseau", label: "Réseau", type: "select", options: ["4G", "5G"] },
    ],
    secondaire: [
      { key: "batterie", label: "Batterie", type: "text", placeholder: "Ex. 5000 mAh" },
      { key: "camera", label: "Caméra", type: "text", placeholder: "Ex. 50 MP" },
      { key: "ecran", label: "Écran", type: "text", placeholder: "Ex. 6.5 pouces AMOLED" },
    ],
    // RAM rejoint stockage/couleur comme dimension de variante : le client
    // doit pouvoir cliquer pour la changer (prix propre à chaque combinaison),
    // pas juste la lire en caractéristique fixe.
    variantes: { dimensions: [
      { key: "stockage", label: "Stockage", options: [] },
      { key: "couleur", label: "Couleur", options: [] },
      { key: "ram", label: "RAM", options: [] },
    ] },
  },

  "Ordinateurs": {
    essentiel: [
      { key: "ram", label: "RAM", type: "text", placeholder: "Ex. 16 Go" },
      { key: "stockage", label: "Stockage", type: "text", placeholder: "Ex. 512 Go SSD" },
      { key: "type", label: "Type", type: "select", options: ["Portable", "Bureau"] },
    ],
    secondaire: [
      { key: "typeStockage", label: "Type de stockage", type: "select", options: ["SSD", "HDD", "SSD + HDD"] },
      { key: "processeur", label: "Processeur", type: "text", placeholder: "Ex. Intel Core i5" },
      { key: "ecran", label: "Écran", type: "text", placeholder: "Ex. 15.6 pouces" },
      { key: "os", label: "Système d'exploitation", type: "text", placeholder: "Ex. Windows 11" },
    ],
    variantes: { dimensions: [
      { key: "ram", label: "RAM", options: [] },
      { key: "stockage", label: "Stockage", options: [] },
    ] },
  },

  "Chaussures": {
    essentiel: [
      { key: "pointure", label: "Pointure", type: "number" },
      { key: "couleur", label: "Couleur", type: "text", placeholder: "Ex. Blanc" },
    ],
    secondaire: [
      { key: "matiere", label: "Matière", type: "text", placeholder: "Ex. Cuir" },
      { key: "type", label: "Type", type: "select", options: ["Ville", "Sport", "Sandale"] },
    ],
    constant: [
      { key: "semelle", label: "Semelle", valeur: "Semelle caoutchouc antidérapante" },
      { key: "doublure", label: "Doublure", valeur: "Doublure textile respirante" },
      { key: "entretien", label: "Entretien", valeur: "Nettoyer avec un chiffon humide, éviter l'eau chaude" },
    ],
    variantes: { dimensions: [
      { key: "pointure", label: "Pointure", options: [] },
      { key: "couleur", label: "Couleur", options: [] },
    ] },
  },

  "Télévisions": {
    essentiel: [
      { key: "taille", label: "Taille", type: "text", placeholder: "Ex. 55 pouces" },
      { key: "resolution", label: "Résolution", type: "select", options: ["HD", "Full HD", "4K", "8K"] },
      { key: "smartTv", label: "Smart TV", type: "select", options: ["Oui", "Non"] },
    ],
    secondaire: [],
    variantes: { dimensions: [
      { key: "taille", label: "Taille d'écran", options: [] },
    ] },
  },

  "Solaire": {
    essentiel: [
      { key: "puissance", label: "Puissance (W)", type: "number" },
    ],
    secondaire: [
      { key: "type", label: "Type", type: "select", options: ["Monocristallin", "Polycristallin"] },
      { key: "tension", label: "Tension", type: "text", placeholder: "Ex. 18V" },
      { key: "dimensions", label: "Dimensions", type: "text", placeholder: "Ex. 102 × 66 × 3 cm" },
    ],
    // Un même panneau se vend souvent en plusieurs puissances (100W/200W/300W)
    // à prix différents — variante cliquable, pas un champ fixe.
    variantes: { dimensions: [
      { key: "puissance", label: "Puissance", options: [] },
    ] },
  },

  "Batteries": {
    essentiel: [
      { key: "tension", label: "Tension", type: "select", options: ["12V", "24V", "48V"] },
      { key: "capacite", label: "Capacité (Ah)", type: "number" },
    ],
    secondaire: [
      { key: "technologie", label: "Technologie", type: "select", options: ["Lithium", "Plomb-acide", "Gel", "AGM"] },
    ],
    // Tension et capacité varient toutes les deux le prix pour une même
    // gamme de batterie (12V/50Ah, 12V/100Ah, 24V/100Ah…) — variantes.
    variantes: { dimensions: [
      { key: "tension", label: "Tension", options: [] },
      { key: "capacite", label: "Capacité", options: [] },
    ] },
  },

  "Onduleurs": {
    essentiel: [
      { key: "puissance", label: "Puissance (W/VA)", type: "text", placeholder: "Ex. 1000W / 1600VA" },
      { key: "type", label: "Type", type: "text" },
    ],
    secondaire: [
      { key: "tensionBatterie", label: "Tension batterie", type: "text", placeholder: "Ex. 12V" },
    ],
    // "type" distingue des produits différents (pas un choix de prix sur la
    // même fiche) — reste fixe. Puissance, elle, varie le prix (500VA/1000VA/
    // 1600VA) — variante cliquable.
    variantes: { dimensions: [
      { key: "puissance", label: "Puissance", options: [] },
    ] },
  },

  "Câbles électriques": {
    essentiel: [
      { key: "section", label: "Section (mm²)", type: "number" },
      { key: "longueur", label: "Longueur", type: "text", placeholder: "Ex. 100 m" },
      { key: "utilisation", label: "Utilisation", type: "text", placeholder: "Ex. Installation domestique" },
    ],
    // Le cahier des charges place marque et prix en secondaire pour cette
    // catégorie (contrairement à toutes les autres où prix est essentiel) —
    // conservé tel quel, signalé comme particularité à l'utilisateur.
    secondaire: [
      { key: "typeCable", label: "Type de câble", type: "text", placeholder: "Ex. Souple H07V-K" },
    ],
    variantes: { dimensions: [
      { key: "longueur", label: "Longueur", options: [] },
      { key: "section", label: "Section", options: [] },
    ] },
  },

  "Ventilateurs": {
    essentiel: [
      { key: "type", label: "Type", type: "text", placeholder: "Ex. Sur pied" },
    ],
    secondaire: [
      { key: "diametre", label: "Diamètre", type: "text", placeholder: "Ex. 40 cm" },
      { key: "puissance", label: "Puissance", type: "text", placeholder: "Ex. 60W" },
    ],
    variantes: null,
  },

  "Climatiseurs": {
    essentiel: [
      { key: "btu", label: "BTU", type: "number" },
      { key: "inverter", label: "Inverter", type: "select", options: ["Oui", "Non"] },
    ],
    secondaire: [
      { key: "type", label: "Type", type: "select", options: ["Split", "Portable"] },
    ],
    variantes: { dimensions: [
      { key: "btu", label: "Capacité BTU", options: [] },
    ] },
  },

  "Machines à laver": {
    essentiel: [
      { key: "capacite", label: "Capacité (kg)", type: "number" },
    ],
    secondaire: [
      { key: "type", label: "Type", type: "text", placeholder: "Ex. Chargement frontal" },
      { key: "classeEnergetique", label: "Classe énergétique", type: "select", options: ["A+++", "A++", "A+", "A", "B", "C"] },
    ],
    // Une même gamme se vend souvent en plusieurs capacités (6kg/8kg/10kg)
    // à prix différents — variante cliquable.
    variantes: { dimensions: [
      { key: "capacite", label: "Capacité", options: [] },
    ] },
  },
};

export const CATEGORIE_NOMS = Object.keys(PRODUIT_CATEGORIES);

export function categorieConfig(categorie) {
  return PRODUIT_CATEGORIES[categorie] || null;
}

export function categorieADesVariantes(categorie) {
  return !!categorieConfig(categorie)?.variantes;
}

// Filtres client (essentiel = filtre) par catégorie — 4 à 6 maximum, jamais
// plus. marque/prix/état vivent dans infosGenerales (pas dans caracteristiques,
// voir commentaire en tête de fichier) donc listés ici séparément plutôt que
// dans essentiel/secondaire. Câbles électriques n'a ni marque ni prix en
// essentiel dans le cahier des charges (les deux sont secondaire pour cette
// catégorie précise) — particularité conservée telle quelle.
export const FILTRES_CLIENT = {
  "Téléphones": ["marque", "prix", "stockage", "couleur", "reseau", "etat"],
  "Ordinateurs": ["marque", "prix", "ram", "stockage", "type"],
  "Chaussures": ["marque", "prix", "pointure", "couleur", "etat"],
  "Télévisions": ["marque", "prix", "taille", "resolution", "smartTv"],
  "Solaire": ["marque", "prix", "puissance"],
  "Batteries": ["marque", "prix", "tension", "capacite"],
  "Onduleurs": ["marque", "prix", "puissance", "type"],
  "Câbles électriques": ["section", "longueur", "utilisation"],
  "Ventilateurs": ["marque", "prix", "type"],
  "Climatiseurs": ["marque", "prix", "btu", "inverter"],
  "Machines à laver": ["marque", "prix", "capacite"],
};

const CHAMPS_SPECIAUX = {
  marque: { label: "Marque", source: "infosGenerales" },
  etat: { label: "État", source: "infosGenerales", options: ["Neuf", "Reconditionné", "Occasion"] },
  prix: { label: "Prix", source: "caracteristiques", range: true },
};

export function filtresClient(categorie) {
  return FILTRES_CLIENT[categorie] || [];
}

// Décrit comment lire/afficher un filtre donné : où trouver sa valeur
// (infosGenerales vs caracteristiques), son libellé, et ses options fixes si
// la catégorie en définit (sinon les valeurs possibles se déduisent des
// produits chargés — voir produits-list.js).
export function descripteurFiltre(categorie, key) {
  if (CHAMPS_SPECIAUX[key]) return { key, ...CHAMPS_SPECIAUX[key] };
  const config = categorieConfig(categorie);
  const field = [...(config?.essentiel || []), ...(config?.secondaire || [])].find((f) => f.key === key);
  return {
    key,
    label: field?.label || key,
    source: "caracteristiques",
    options: field?.type === "select" ? field.options : null,
  };
}
