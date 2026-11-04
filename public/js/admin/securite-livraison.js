// Sécurité de celui qui livre : position et vidéo. Tout est d'abord gardé sur
// le téléphone (IndexedDB) puis envoyé : une coupure de réseau ne perd rien, et
// un identifiant par point ou morceau évite tout doublon.
import { functions } from "../firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { nouvelIdAction } from "./photo-incident.js";

const enregistrerPositions = httpsCallable(functions, "enregistrerPositions");
const demarrerEnregistrement = httpsCallable(functions, "demarrerEnregistrement");
const envoyerMorceau = httpsCallable(functions, "envoyerMorceau", { timeout: 60000 });
const terminerEnregistrement = httpsCallable(functions, "terminerEnregistrement");

const BASE = "bokki-securite";
const INTERVALLE_MS = 60000;
const DEPLACEMENT_M = 30;
const DUREE_MORCEAU_MS = 4000;
// Vidéo de sécurité, pensée pour une 3G chère et lente. Le débit vidéo est de
// 280 kbit/s, soit ≈ 2,1 Mo/min de fichier et ≈ 2,8 Mo/min envoyés (base64 du
// transfert par fonction) : c'est sous le débit montant d'une 3G lente, alors
// que 800 kbit/s (≈ 8 Mo/min envoyés) accumulait du retard sur le téléphone.
// Contraintes en « ideal » seulement : un appareil qui ne sait pas les tenir
// filme au plus proche au lieu de refuser la caméra.
const CONTRAINTES_VIDEO = { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } };
const DEBIT_VIDEO = 280000;

function ouvrir() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("points", { keyPath: "id" });
      r.result.createObjectStore("morceaux", { keyPath: "cle" });
      r.result.createObjectStore("fins", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function dansBase(store, mode, action) {
  const base = await ouvrir();
  return new Promise((resolve, reject) => {
    const tx = base.transaction(store, mode);
    const r = action(tx.objectStore(store));
    tx.oncomplete = () => { base.close(); resolve(r?.result); };
    tx.onerror = () => { base.close(); reject(tx.error); };
  });
}
const ajouter = (store, valeur) => dansBase(store, "readwrite", (s) => s.put(valeur));
const lister = (store) => dansBase(store, "readonly", (s) => s.getAll());
const retirer = (store, cle) => dansBase(store, "readwrite", (s) => s.delete(cle));

export const dansLesHeures = (d = new Date()) => d.getUTCHours() >= 8 && d.getUTCHours() < 18;

export function lirePosition(delaiMs = 5000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: delaiMs, maximumAge: 15000 },
    );
  });
}

let envoiPoints = null;
export function envoyerPoints() {
  envoiPoints ||= (async () => {
    const points = await lister("points");
    for (let i = 0; i < points.length; i += 50) {
      const lot = points.slice(i, i + 50);
      await enregistrerPositions({ points: lot });
      await Promise.all(lot.map((p) => retirer("points", p.id)));
    }
  })().catch(() => undefined).finally(() => { envoiPoints = null; });
  return envoiPoints;
}

// Envoie un point. source : suivi, statut ou sos. Rien hors de 8 h – 18 h, sauf SOS.
export async function noterPosition(commandeId, source, alerteId = null, position = null) {
  if (source !== "sos" && !dansLesHeures()) return null;
  const lieu = position || (await lirePosition());
  if (!lieu) return null;
  const point = { id: nouvelIdAction(), ...lieu, date: Date.now(), commandeId, source, alerteId };
  await ajouter("points", point);
  await envoyerPoints();
  return point;
}

const distanceM = (a, b) => {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  return Math.hypot(x, (b.lat - a.lat) * r) * 6371000;
};

// Position activée : un point à l'activation, puis au plus un toutes les 60 s
// si la personne s'est déplacée, tant que l'écran est allumé.
export class SuiviPosition {
  constructor(surEnvoi) {
    this.surEnvoi = surEnvoi;
    this.veille = null;
    this.dernier = null;
  }
  async activer(commandeId) {
    this.commandeId = commandeId;
    const point = await noterPosition(commandeId, "suivi");
    if (!point) return false;
    this.dernier = point;
    this.surEnvoi(point);
    this.veille = navigator.geolocation.watchPosition((p) => {
      const lieu = { lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy) };
      if (Date.now() - this.dernier.date < INTERVALLE_MS || distanceM(this.dernier, lieu) < DEPLACEMENT_M) return;
      this.dernier = { ...lieu, date: Date.now() };
      noterPosition(this.commandeId, "suivi", null, lieu).then((envoye) => { if (envoye) this.surEnvoi(envoye); });
    }, () => undefined, { enableHighAccuracy: true, maximumAge: 15000 });
    return true;
  }
  desactiver() {
    if (this.veille != null) navigator.geolocation.clearWatch(this.veille);
    this.veille = null;
  }
  get active() { return this.veille != null; }
}

function enBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Envoi par morceaux : chaque morceau reste sur le téléphone jusqu'à sa réception.
let envoiMorceaux = null;
// Enregistrements connus du serveur : un seul appel de démarrage par vidéo, et
// non un à chaque morceau.
const demarres = new Set();
export function envoyerMorceaux(surMorceau = () => undefined) {
  envoiMorceaux ||= (async () => {
    // On relit la file tant qu'elle n'est pas vide : sur réseau lent, des
    // morceaux arrivent pendant l'envoi des précédents.
    for (;;) {
      const morceaux = (await lister("morceaux")).sort((a, b) => a.index - b.index);
      if (!morceaux.length) break;
      for (const m of morceaux) {
        if (!demarres.has(m.id)) {
          await demarrerEnregistrement({ id: m.id, commandeId: m.commandeId, mime: m.mime });
          demarres.add(m.id);
        }
        await envoyerMorceau({ id: m.id, index: m.index, base64: await enBase64(m.blob) });
        await retirer("morceaux", m.cle);
        surMorceau(m);
      }
    }
    const restants = await lister("morceaux");
    for (const fin of await lister("fins")) {
      if (restants.some((m) => m.id === fin.id)) continue;
      await terminerEnregistrement({ id: fin.id, etat: fin.etat, raison: fin.raison });
      await retirer("fins", fin.id);
    }
  })().catch((err) => console.warn("Envoi vidéo en attente :", err?.message)).finally(() => { envoiMorceaux = null; });
  return envoiMorceaux;
}

const FORMATS = ["video/webm;codecs=vp8", "video/webm", "video/mp4"];

export class Enregistreur {
  constructor({ surChangement }) {
    this.surChangement = surChangement;
    this.actif = false;
    this.envoyes = 0;
  }
  async demarrer(commandeId) {
    this.flux = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: CONTRAINTES_VIDEO,
    });
    const mime = FORMATS.find((f) => MediaRecorder.isTypeSupported(f));
    if (!mime) throw new Error("Vidéo non prise en charge sur cet appareil.");
    this.id = nouvelIdAction();
    this.commandeId = commandeId;
    this.index = 0;
    this.envoyes = 0;
    this.mime = mime;
    this.recorder = new MediaRecorder(this.flux, { mimeType: mime, videoBitsPerSecond: DEBIT_VIDEO });
    this.recorder.ondataavailable = (e) => { if (e.data?.size) this.garderMorceau(e.data); };
    this.recorder.onerror = () => this.arreter("interrompu", "Erreur de la caméra");
    const piste = this.flux.getVideoTracks()[0];
    this.surCoupure = () => this.arreter("interrompu", "Appel entrant ou caméra coupée");
    piste.addEventListener("ended", this.surCoupure);
    piste.addEventListener("mute", this.surCoupure);
    this.surMasque = () => { if (document.visibilityState === "hidden") this.arreter("interrompu", "Écran verrouillé ou application quittée"); };
    document.addEventListener("visibilitychange", this.surMasque);
    addEventListener("pagehide", this.surMasque);
    this.ecranAllume = await navigator.wakeLock?.request("screen").catch(() => null);
    await demarrerEnregistrement({ id: this.id, commandeId, mime }).then(() => demarres.add(this.id)).catch(() => undefined);
    this.recorder.start(DUREE_MORCEAU_MS);
    this.actif = true;
    this.debut = Date.now();
    this.surChangement();
  }
  async garderMorceau(blob) {
    const index = this.index++;
    await ajouter("morceaux", { cle: `${this.id}_${index}`, id: this.id, index, commandeId: this.commandeId, mime: this.mime.split(";")[0], blob });
    await envoyerMorceaux(() => { this.envoyes++; this.surChangement(); });
  }
  async arreter(etat = "termine", raison = null) {
    if (!this.actif) return;
    this.actif = false;
    document.removeEventListener("visibilitychange", this.surMasque);
    removeEventListener("pagehide", this.surMasque);
    const fin = new Promise((resolve) => { this.recorder.addEventListener("stop", resolve, { once: true }); });
    if (this.recorder.state !== "inactive") this.recorder.stop();
    await Promise.race([fin, new Promise((r) => setTimeout(r, 1500))]);
    this.flux.getTracks().forEach((t) => t.stop());
    this.ecranAllume?.release().catch(() => undefined);
    await ajouter("fins", { id: this.id, etat, raison });
    this.surChangement(etat === "interrompu" ? raison : null);
    await envoyerMorceaux(() => { this.envoyes++; this.surChangement(); });
  }
}

export const reprendreEnvois = () => Promise.all([envoyerPoints(), envoyerMorceaux()]);
