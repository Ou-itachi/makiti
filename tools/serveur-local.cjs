// Serveur de test local du site client (sans Firebase CLI) :
//   npm run local   →   http://localhost:5055
// Reproduit les réécritures et les URL propres de firebase.json
// (fichiers statiques d'abord — pages pré-rendues comprises — puis
// /categorie/*, /produit/*, /commande/identification, /commande/livraison, « .html »
// facultatif, page 404). Le site lit les VRAIES données Firestore de
// production (lecture seule). Ne rien commander en vrai depuis localhost :
// creerCommande écrirait une vraie commande.
const http = require("node:http");
const { readFile, stat } = require("node:fs/promises");
const { join, extname, normalize } = require("node:path");
const zlib = require("node:zlib");
const { createHash } = require("node:crypto");

const RACINE = join(__dirname, "..", "public");
const PORT = Number(process.env.PORT) || 5055;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const REECRITURES = { "/": "/index.html", "/commande/identification": "/commande-identification.html", "/commande/livraison": "/commande-livraison.html" };

async function fichier(p) {
  try { return (await stat(p)).isFile() ? p : null; } catch { return null; }
}

http.createServer(async (req, res) => {
  let chemin = decodeURIComponent(new URL(req.url, "http://local").pathname);
  chemin = REECRITURES[chemin] || chemin;
  const sur = normalize(join(RACINE, chemin));
  if (!sur.startsWith(RACINE) || chemin.startsWith("/_partials")) { res.writeHead(403); return res.end(); }
  // Comme Firebase Hosting : le fichier statique s'il existe, sinon la réécriture.
  const modele = chemin.startsWith("/categorie/") ? "/catalogue.html" : chemin.startsWith("/produit/") ? "/produit.html" : null;
  const trouve = (await fichier(sur)) || (await fichier(sur + ".html")) || (modele && (await fichier(join(RACINE, modele))));
  if (!trouve) {
    res.writeHead(404, { "content-type": TYPES[".html"] });
    return res.end(await readFile(join(RACINE, "404.html")));
  }
  // Compression gzip des fichiers texte, comme Firebase Hosting : les poids
  // mesurés en local correspondent alors à ceux de la production.
  const type = TYPES[extname(trouve)] || "application/octet-stream";
  let corps = await readFile(trouve);
  // « no-cache » + ETag comme Firebase Hosting : le navigateur revalide et
  // reçoit un 304 (sans corps) si le fichier n'a pas changé.
  const etag = `"${createHash("sha1").update(corps).digest("base64url").slice(0, 20)}"`;
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, { etag, "cache-control": "no-cache" }); return res.end(); }
  const entetes = { "content-type": type, "cache-control": "no-cache", etag };
  if (/text|javascript|json|svg/.test(type) && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    corps = zlib.gzipSync(corps);
    entetes["content-encoding"] = "gzip";
    entetes["vary"] = "Accept-Encoding";
  }
  res.writeHead(200, entetes);
  res.end(corps);
}).listen(PORT, () => console.log(`Bokki en local : http://localhost:${PORT}  (Ctrl+C pour arrêter)`));
