// Serveur de test local du site client (sans Firebase CLI) :
//   npm run local   →   http://localhost:5055
// Reproduit les réécritures et les URL propres de firebase.json
// (/categorie/*, /commande/identification, /commande/livraison, « .html »
// facultatif, page 404). Le site lit les VRAIES données Firestore de
// production (lecture seule). Ne rien commander en vrai depuis localhost :
// creerCommande écrirait une vraie commande.
const http = require("node:http");
const { readFile, stat } = require("node:fs/promises");
const { join, extname, normalize } = require("node:path");

const RACINE = join(__dirname, "..", "public");
const PORT = Number(process.env.PORT) || 5055;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const REECRITURES = { "/": "/index.html", "/commande/identification": "/commande-identification.html", "/commande/livraison": "/commande-livraison.html" };

async function fichier(p) {
  try { return (await stat(p)).isFile() ? p : null; } catch { return null; }
}

http.createServer(async (req, res) => {
  let chemin = decodeURIComponent(new URL(req.url, "http://local").pathname);
  if (chemin.startsWith("/categorie/")) chemin = "/catalogue.html";
  chemin = REECRITURES[chemin] || chemin;
  const sur = normalize(join(RACINE, chemin));
  if (!sur.startsWith(RACINE) || chemin.startsWith("/_partials")) { res.writeHead(403); return res.end(); }
  const trouve = (await fichier(sur)) || (await fichier(sur + ".html"));
  if (!trouve) {
    res.writeHead(404, { "content-type": TYPES[".html"] });
    return res.end(await readFile(join(RACINE, "404.html")));
  }
  res.writeHead(200, { "content-type": TYPES[extname(trouve)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(await readFile(trouve));
}).listen(PORT, () => console.log(`Bokki en local : http://localhost:${PORT}  (Ctrl+C pour arrêter)`));
