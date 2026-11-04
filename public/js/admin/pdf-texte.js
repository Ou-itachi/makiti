// Petit générateur de PDF texte, sans dépendance : polices Helvetica intégrées à
// tout lecteur PDF, codage WinAnsi (accents français, guillemets, tirets).
// Coordonnées en points, origine en haut à gauche d'une page A4.
const LARGEUR_A4 = 595.28;
const HAUTEUR_A4 = 841.89;

// Largeurs Helvetica (Adobe AFM), caractères 32 à 126, pour aligner à droite.
const LARGEURS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const LARGEURS_GRAS = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// Caractères de la plage 0x80-0x9F de WinAnsi (cp1252).
const WIN_ANSI = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f };
const LARGEUR_SPECIALE = { "€": 556, "«": 556, "»": 556, "œ": 944, "Œ": 1000, "’": 222, "‘": 222, "“": 333, "”": 333, "–": 556, "—": 1000, "…": 1000, "•": 350, "·": 278 };

// Espaces fines et insécables : une espace ordinaire. Une lettre hors WinAnsi
// perd son accent si elle en a un, sinon elle devient « ? » : jamais de PDF cassé.
function codeWinAnsi(c) {
  if (/\s/.test(c)) return 0x20;
  if (WIN_ANSI[c]) return WIN_ANSI[c];
  const code = c.codePointAt(0);
  if (code >= 0x20 && code < 0x7f) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  const base = c.normalize("NFD")[0];
  return base !== c ? codeWinAnsi(base) : 0x3f;
}
const hexa = (texte) => [...String(texte)].map((c) => codeWinAnsi(c).toString(16).padStart(2, "0")).join("");

export function largeurTexte(texte, taille, gras = false) {
  const table = gras ? LARGEURS_GRAS : LARGEURS;
  let total = 0;
  for (const c of String(texte)) {
    const base = /\s/.test(c) ? " " : c.normalize("NFD")[0];
    const code = base.charCodeAt(0);
    total += LARGEUR_SPECIALE[c] ?? (code >= 32 && code <= 126 ? table[code - 32] : 556);
  }
  return (total / 1000) * taille;
}

// Découpe en lignes tenant dans la largeur ; un mot trop long est coupé.
export function couperTexte(texte, taille, largeurMax, gras = false) {
  const lignes = [];
  let ligne = "";
  for (const mot of String(texte).split(/\s+/).filter(Boolean)) {
    let reste = mot;
    let essai = ligne ? `${ligne} ${reste}` : reste;
    if (largeurTexte(essai, taille, gras) <= largeurMax) { ligne = essai; continue; }
    if (ligne) lignes.push(ligne);
    ligne = "";
    while (largeurTexte(reste, taille, gras) > largeurMax) {
      let n = reste.length - 1;
      while (n > 1 && largeurTexte(reste.slice(0, n), taille, gras) > largeurMax) n--;
      lignes.push(reste.slice(0, n));
      reste = reste.slice(n);
    }
    ligne = reste;
  }
  if (ligne) lignes.push(ligne);
  return lignes.length ? lignes : [""];
}

const nb = (n) => (Math.round(n * 100) / 100).toString();
const couleurPdf = ([r, v, b]) => `${nb(r / 255)} ${nb(v / 255)} ${nb(b / 255)}`;

export function creerPdf({ titre = "Document" } = {}) {
  const pages = [];
  let courante = null;
  const page = () => { courante = []; pages.push(courante); };
  page();
  return {
    largeur: LARGEUR_A4,
    hauteur: HAUTEUR_A4,
    page,
    // align : "gauche" (par défaut), "droite" ou "centre", par rapport à x.
    texte(x, y, contenu, { taille = 11, gras = false, couleur = [10, 10, 10], align = "gauche" } = {}) {
      const l = largeurTexte(contenu, taille, gras);
      const debut = align === "droite" ? x - l : align === "centre" ? x - l / 2 : x;
      courante.push(`BT /${gras ? "F2" : "F1"} ${nb(taille)} Tf ${couleurPdf(couleur)} rg ${nb(debut)} ${nb(HAUTEUR_A4 - y)} Td <${hexa(contenu)}> Tj ET`);
    },
    ligne(x1, y1, x2, y2, { couleur = [228, 228, 231], epaisseur = 1 } = {}) {
      courante.push(`${couleurPdf(couleur)} RG ${nb(epaisseur)} w ${nb(x1)} ${nb(HAUTEUR_A4 - y1)} m ${nb(x2)} ${nb(HAUTEUR_A4 - y2)} l S`);
    },
    rectangle(x, y, l, h, couleur) {
      courante.push(`${couleurPdf(couleur)} rg ${nb(x)} ${nb(HAUTEUR_A4 - y - h)} ${nb(l)} ${nb(h)} re f`);
    },
    // Fichier entier : tout est ASCII (textes en hexadécimal), un caractère = un octet.
    octets() {
      const objets = [];
      const ajouter = (corps) => { objets.push(corps); return objets.length; };
      ajouter("<< /Type /Catalog /Pages 2 0 R >>");
      ajouter(""); // Pages : rempli quand les numéros des pages sont connus.
      const police = (nom) => `<< /Type /Font /Subtype /Type1 /BaseFont /${nom} /Encoding /WinAnsiEncoding >>`;
      ajouter(police("Helvetica"));
      ajouter(police("Helvetica-Bold"));
      const utf16 = "feff" + [...titre].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
      const infos = ajouter(`<< /Title <${utf16}> /Producer (Bokki) >>`);
      const numeros = pages.map((p) => {
        const flux = p.join("\n");
        const contenu = ajouter(`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`);
        return ajouter(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGEUR_A4} ${HAUTEUR_A4}] /Contents ${contenu} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`);
      });
      objets[1] = `<< /Type /Pages /Count ${numeros.length} /Kids [${numeros.map((n) => `${n} 0 R`).join(" ")}] >>`;
      let sortie = "%PDF-1.4\n";
      const positions = objets.map((corps, i) => {
        const position = sortie.length;
        sortie += `${i + 1} 0 obj\n${corps}\nendobj\n`;
        return position;
      });
      const xref = sortie.length;
      sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
      sortie += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R /Info ${infos} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      return Uint8Array.from(sortie, (c) => c.charCodeAt(0));
    },
  };
}

export function telechargerPdf(octets, nomFichier) {
  const url = URL.createObjectURL(new Blob([octets], { type: "application/pdf" }));
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
