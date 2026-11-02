// Lanceur des hooks Firebase (predeploy / postdeploy de firebase.json).
// L'outil firebase « autonome » exécute les hooks avec son propre Node
// embarqué, qui ne sait pas charger un module ES (prerender.mjs) : on
// relance donc le script avec le vrai Node de la machine.
//   node scripts/prerender-deploy.cjs            → pré-rendu
//   node scripts/prerender-deploy.cjs nettoyer   → index.html remis à l'état git
//   node scripts/prerender-deploy.cjs tests      → tests du parcours d'achat
//     (tests/parcours.mjs) sur les pages pré-rendues ; en cas d'échec le
//     déploiement est bloqué et le pré-rendu nettoyé. Urgence seulement :
//     BOKKI_SANS_TESTS=1 firebase deploy … saute les tests.
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join, delimiter } = require("node:path");

const candidats = [
  ...(process.env.PATH || "").split(delimiter).map((d) => join(d, "node")),
  "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node",
];
const node = candidats.find((n) => n !== process.execPath && existsSync(n) &&
  spawnSync(n, ["-e", "import('node:fs').then(()=>process.exit(0))"], { stdio: "ignore" }).status === 0);
if (!node) {
  console.error("✗ Pré-rendu : aucun Node capable de lancer scripts/prerender.mjs.");
  process.exit(1);
}
const env = { ...process.env, NODE_NO_WARNINGS: "1" };
if (process.argv[2] === "tests") {
  if (process.env.BOKKI_SANS_TESTS === "1") {
    console.warn("⚠ Tests du parcours d'achat sautés (BOKKI_SANS_TESTS=1).");
    process.exit(0);
  }
  const t = spawnSync(node, [join(__dirname, "..", "tests", "parcours.mjs")], { stdio: "inherit", env });
  if (t.status !== 0) {
    console.error("✗ Déploiement bloqué : le parcours d'achat ne passe plus (voir ci-dessus).");
    spawnSync(node, [join(__dirname, "prerender.mjs"), "--nettoyer"], { stdio: "inherit", env });
  }
  process.exit(t.status ?? 1);
}
const args = [join(__dirname, "prerender.mjs"), ...(process.argv[2] === "nettoyer" ? ["--nettoyer"] : [])];
const r = spawnSync(node, args, { stdio: "inherit", env });
process.exit(r.status ?? 1);
