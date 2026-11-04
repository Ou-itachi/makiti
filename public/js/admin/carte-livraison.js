// Carte des positions (Leaflet + tuiles OpenStreetMap). Leaflet n'est chargé
// que sur les pages qui montrent une carte. Sans tuiles (réseau coupé), les
// points et le tracé restent visibles.
const DOSSIER = "/vendor/leaflet-1.9.4";
let chargement = null;

function chargerLeaflet() {
  chargement ||= new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${DOSSIER}/leaflet.css`;
    document.head.append(css);
    const js = document.createElement("script");
    js.src = `${DOSSIER}/leaflet.js`;
    js.onload = () => resolve(window.L);
    js.onerror = () => reject(new Error("Carte indisponible."));
    document.head.append(js);
  });
  return chargement;
}

const cartes = new WeakMap();

export async function afficherCarte(element, points) {
  if (!element) return;
  const L = await chargerLeaflet();
  const lieux = points.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)).map((p) => [p.lat, p.lng]);
  let etat = cartes.get(element);
  if (!etat) {
    const carte = L.map(element, { attributionControl: true }).setView([9.6412, -13.5784], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(carte);
    etat = { carte, calque: L.layerGroup().addTo(carte) };
    cartes.set(element, etat);
  }
  etat.calque.clearLayers();
  if (lieux.length > 1) L.polyline(lieux, { color: "#1d5f8f", weight: 3 }).addTo(etat.calque);
  lieux.forEach((lieu, i) => {
    const dernier = i === lieux.length - 1;
    L.circleMarker(lieu, { radius: dernier ? 8 : 5, color: "#fff", weight: 2, fillColor: dernier ? "#dc2626" : "#1d5f8f", fillOpacity: 1 }).addTo(etat.calque);
  });
  etat.carte.invalidateSize();
  if (lieux.length === 1) etat.carte.setView(lieux[0], 16);
  else if (lieux.length) etat.carte.fitBounds(lieux, { padding: [24, 24], maxZoom: 17 });
}
