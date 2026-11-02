// Lanceur des hooks Firebase (predeploy / postdeploy de firebase.json).
// L'outil firebase « autonome » exécute les hooks avec son propre Node
// embarqué, qui ne sait pas charger un module ES (prerender.mjs) : on
// relance donc le script avec le vrai Node de la machine.
//   node scripts/prerender-deploy.cjs            → pré-rendu
//   node scripts/prerender-deploy.cjs nettoyer   → index.html remis à l'état git
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
const args = [join(__dirname, "prerender.mjs"), ...(process.argv[2] === "nettoyer" ? ["--nettoyer"] : [])];
const r = spawnSync(node, args, { stdio: "inherit", env: { ...process.env, NODE_NO_WARNINGS: "1" } });
process.exit(r.status ?? 1);
