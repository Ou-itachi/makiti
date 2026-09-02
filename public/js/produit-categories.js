// Source de vérité unique pour les catégories de produits : quels champs
// existent par catégorie (essentiel = filtre client + affiché, secondaire =
// affiché seulement, constant = jamais demandé à l'admin), et quelles
// dimensions forment les variantes (chaque variante porte son propre prix,
// jamais un prix générique du produit).
//
// marque, prix, état, garantie ne sont PAS répétés ici : ils vivent dans
// infosGenerales (marque, etat, garantie) et dans le bloc prix dédié
// (caracteristiques.prix ou variantes[].prix).
//
// Utilisé par l'admin (rendu dynamique du formulaire produit) et par la
// fiche produit publique (labels des caractéristiques + sélecteur de
// variante). 8 catégories visibles côté client, mêmes valeurs côté admin :
// Téléphones · Ordinateurs · Tablettes · Télévisions · Électronique ·
// Vêtements · Chaussures · Voitures.

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

  "Tablettes": {
    essentiel: [
      { key: "stockage", label: "Stockage", type: "text", placeholder: "Ex. 128 Go" },
      { key: "couleur", label: "Couleur", type: "text", placeholder: "Ex. Gris sidéral" },
      { key: "ram", label: "RAM", type: "text", placeholder: "Ex. 6 Go" },
    ],
    secondaire: [
      { key: "ecran", label: "Écran", type: "text", placeholder: "Ex. 10.9 pouces" },
      { key: "batterie", label: "Batterie", type: "text", placeholder: "Ex. 7040 mAh" },
      { key: "connectivite", label: "Connectivité", type: "select", options: ["Wi-Fi", "Wi-Fi + Cellulaire"] },
    ],
    variantes: { dimensions: [
      { key: "stockage", label: "Stockage", options: [] },
      { key: "couleur", label: "Couleur", options: [] },
      { key: "ram", label: "RAM", options: [] },
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

  // Fourre-tout : tout appareil électronique/électrique qui n'a pas sa
  // propre catégorie (panneau solaire, batterie, onduleur, câble, ventilateur,
  // climatiseur, électroménager…). Aucun champ imposé — l'admin décrit
  // librement dans la description et remplit ce qui est pertinent. Pas de
  // variantes cliquables : un article = un prix.
  "Électronique": {
    essentiel: [],
    secondaire: [
      { key: "typeAppareil", label: "Type d'appareil", type: "text", placeholder: "Ex. Panneau solaire, batterie, onduleur, câble, ventilateur…" },
      { key: "puissance", label: "Puissance / Capacité", type: "text", placeholder: "Ex. 200 W · 100 Ah · 1600 VA" },
      { key: "specifs", label: "Autres caractéristiques", type: "text", placeholder: "Tension, dimensions, longueur, section…" },
    ],
    variantes: null,
  },

  "Vêtements": {
    essentiel: [
      { key: "taille", label: "Taille", type: "text", placeholder: "Ex. M, L, XL, 42" },
      { key: "couleur", label: "Couleur", type: "text", placeholder: "Ex. Noir" },
    ],
    secondaire: [
      { key: "matiere", label: "Matière", type: "text", placeholder: "Ex. Coton" },
      { key: "genre", label: "Genre", type: "select", options: ["Homme", "Femme", "Enfant", "Mixte"] },
    ],
    variantes: { dimensions: [
      { key: "taille", label: "Taille", options: [] },
      { key: "couleur", label: "Couleur", options: [] },
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

  "Voitures": {
    essentiel: [
      { key: "annee", label: "Année", type: "number" },
      { key: "kilometrage", label: "Kilométrage (km)", type: "number" },
      { key: "carburant", label: "Carburant", type: "select", options: ["Essence", "Diesel", "Électrique", "Hybride", "GPL"] },
      { key: "boite", label: "Boîte de vitesses", type: "select", options: ["Manuelle", "Automatique"] },
    ],
    secondaire: [
      { key: "couleur", label: "Couleur", type: "text", placeholder: "Ex. Gris" },
      { key: "portes", label: "Nombre de portes", type: "select", options: ["2", "3", "4", "5"] },
      { key: "places", label: "Nombre de places", type: "number" },
    ],
    // Chaque voiture est un exemplaire unique : pas de variantes cliquables.
    variantes: null,
  },
};

export const CATEGORIE_NOMS = Object.keys(PRODUIT_CATEGORIES);

export function categorieConfig(categorie) {
  return PRODUIT_CATEGORIES[categorie] || null;
}

// Champs d'en-tête (nom, marque, modèle, garantie) : lesquels afficher et
// avec quel exemple, selon la catégorie. « Modèle » n'a de sens que pour un
// produit industriel décliné en références (téléphone, ordi, TV, voiture) —
// pas pour un vêtement ou une paire de chaussures. « Garantie » ne concerne
// que l'électronique. Les exemples (placeholder) parlent le vocabulaire de
// la catégorie plutôt qu'un « Ex. Samsung / Galaxy A54 » générique.
const INFOS_GENERIQUE = {
  modele: true,
  garantie: true,
  exemples: { nom: "Ex. Nom du produit", marque: "Ex. Marque", modele: "Ex. Référence / modèle", garantie: "Ex. 12 mois" },
};

export const INFOS_PAR_CATEGORIE = {
  "Téléphones": { modele: true, garantie: true, exemples: { nom: "Ex. Samsung Galaxy A55 128 Go", marque: "Ex. Samsung", modele: "Ex. Galaxy A55", garantie: "Ex. 12 mois" } },
  "Ordinateurs": { modele: true, garantie: true, exemples: { nom: "Ex. HP Pavilion 15 — i5 16 Go", marque: "Ex. HP", modele: "Ex. Pavilion 15-eh2000", garantie: "Ex. 12 mois" } },
  "Tablettes": { modele: true, garantie: true, exemples: { nom: "Ex. iPad 10e génération 64 Go", marque: "Ex. Apple", modele: "Ex. iPad 10,9 pouces", garantie: "Ex. 12 mois" } },
  "Télévisions": { modele: true, garantie: true, exemples: { nom: 'Ex. Samsung 55" Crystal UHD 4K', marque: "Ex. Samsung", modele: "Ex. UE55AU7020", garantie: "Ex. 24 mois" } },
  "Électronique": { modele: false, garantie: true, exemples: { nom: "Ex. Panneau solaire 200W monocristallin", marque: "Ex. Jinko, Felicity… (optionnel)", garantie: "Ex. 6 mois (optionnel)" } },
  "Vêtements": { modele: false, garantie: false, exemples: { nom: "Ex. Chemise en lin manches longues", marque: "Ex. Zara (optionnel)" } },
  "Chaussures": { modele: false, garantie: false, exemples: { nom: "Ex. Baskets running homme", marque: "Ex. Nike (optionnel)" } },
  "Voitures": { modele: true, garantie: false, exemples: { nom: "Ex. Toyota Corolla 2018 essence", marque: "Ex. Toyota", modele: "Ex. Corolla" } },
};

export function infosConfig(categorie) {
  return INFOS_PAR_CATEGORIE[categorie] || INFOS_GENERIQUE;
}

export function categorieADesVariantes(categorie) {
  return !!categorieConfig(categorie)?.variantes;
}

// Filtres client (essentiel = filtre) par catégorie — 4 à 6 maximum.
// marque/prix/état sont des champs spéciaux (voir CHAMPS_SPECIAUX), listés
// ici même s'ils vivent dans infosGenerales / le bloc prix.
export const FILTRES_CLIENT = {
  "Téléphones": ["marque", "prix", "stockage", "couleur", "reseau", "etat"],
  "Ordinateurs": ["marque", "prix", "ram", "stockage", "type"],
  "Tablettes": ["marque", "prix", "stockage", "couleur", "etat"],
  "Télévisions": ["marque", "prix", "taille", "resolution", "smartTv"],
  "Électronique": ["marque", "prix", "etat"],
  "Vêtements": ["marque", "prix", "taille", "couleur", "genre"],
  "Chaussures": ["marque", "prix", "pointure", "couleur", "etat"],
  "Voitures": ["marque", "prix", "carburant", "boite", "annee"],
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
