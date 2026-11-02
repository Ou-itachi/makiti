// Connexion par passkey (WebAuthn) : Face ID / Touch ID sur iPhone et Mac,
// empreinte ou verrouillage de l'écran sur Android, Windows Hello.
// Écrit à la main (pas de bibliothèque : la CSP n'autorise que nos scripts
// et ceux de Google). Les options viennent de @simplewebauthn/server (JSON,
// binaires en base64url) ; ce module les convertit pour
// navigator.credentials, puis renvoie les réponses au même format JSON
// (RegistrationResponseJSON / AuthenticationResponseJSON).
// Serveur : functions/src/index.ts, section « Connexion par passkey ».
import { appelPublic, erreurReseau, messageErreurAppel } from "./fonctions.js";
import { EMULATOR } from "./firebase-appli.js";
import { connexionJeton } from "./session-client.js";

const optionsEnregistrementAppel = appelPublic("optionsEnregistrementPasskey");
const enregistrerAppel = appelPublic("enregistrerPasskey", { idempotente: false });
const optionsConnexionAppel = appelPublic("optionsConnexionPasskey");
const connexionAppel = appelPublic("connexionPasskey", { idempotente: false });
const listerAppel = appelPublic("listerPasskeys");
const supprimerAppel = appelPublic("supprimerPasskey");

// Une passkey est liée au domaine bokki.shop (rpID côté serveur) : sur
// makiti-gn.web.app elle ne peut pas marcher, le bouton n'y est pas montré.
// localhost : tests avec l'émulateur Functions uniquement (?emulator=1) ;
// les fonctions de production refusent l'origine localhost.
const DOMAINES = ["bokki.shop", "www.bokki.shop", ...(EMULATOR ? ["localhost"] : [])];
const RP_ID = location.hostname === "localhost" ? "localhost" : "bokki.shop";

// ---------- Libellés selon l'appareil ----------
const UA = navigator.userAgent;
const IPAD = /iPad/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const IPHONE = /iPhone|iPod/.test(UA);
const MAC = !IPAD && /Macintosh/.test(UA);
const WINDOWS = /Windows/.test(UA);
// court : titres (« Connexion par … ») ; long : phrases ; avec : bouton
// « Se connecter avec … ».
export const LIBELLE_PASSKEY = IPHONE ? { court: "Face ID", long: "Face ID", avec: "Face ID" }
  : IPAD ? { court: "Face ID / Touch ID", long: "Face ID ou Touch ID", avec: "Face ID / Touch ID" }
  : MAC ? { court: "Touch ID", long: "Touch ID", avec: "Touch ID" }
  : WINDOWS ? { court: "Windows Hello", long: "Windows Hello", avec: "Windows Hello" }
  : { court: "empreinte", long: "empreinte ou verrouillage du téléphone", avec: "l’empreinte" };

// ---------- Disponibilité ----------
let disponible = null;
// true si ce navigateur peut créer et utiliser une passkey de l'appareil
// lui-même (capteur ou code de verrouillage). Ne lève jamais.
// Connexion par Face ID / empreinte DÉSACTIVÉE (décision du propriétaire :
// numéro + code suffisent, plus simple). Le code reste en place : repasser
// à true pour la réactiver (boutons, proposition et carte Mon compte).
export const PASSKEYS_ACTIVES = false;

export function passkeyDisponible() {
  disponible ||= (async () => {
    try {
      if (!PASSKEYS_ACTIVES) return false;
      if (!DOMAINES.includes(location.hostname) || !window.isSecureContext) return false;
      const PKC = window.PublicKeyCredential;
      if (!PKC?.isUserVerifyingPlatformAuthenticatorAvailable || !navigator.credentials?.get) return false;
      return await PKC.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  })();
  return disponible;
}

// Saisie automatique (« conditional UI ») : le clavier ou la liste de
// remplissage du champ propose la passkey. Facultatif.
export async function conditionnelleDisponible() {
  try {
    return (await passkeyDisponible()) && Boolean(await window.PublicKeyCredential.isConditionalMediationAvailable?.());
  } catch {
    return false;
  }
}

// ---------- Passkeys connues de CET appareil ----------
// Indice local (identifiants des clés créées ou utilisées ici) : sert à
// préparer la saisie automatique et à marquer « cet appareil ». Jamais une
// preuve : le serveur vérifie tout.
const CLE_LOCALE = "bokki-passkeys";
export function passkeysLocales() {
  try { return JSON.parse(localStorage.getItem(CLE_LOCALE) || "[]"); } catch { return []; }
}
function memoriser(id) {
  try { localStorage.setItem(CLE_LOCALE, JSON.stringify([id, ...passkeysLocales().filter((x) => x !== id)].slice(0, 10))); } catch { /* ignore */ }
}
function oublier(id) {
  try { localStorage.setItem(CLE_LOCALE, JSON.stringify(passkeysLocales().filter((x) => x !== id))); } catch { /* ignore */ }
}

// ---------- base64url <-> octets ----------
function versB64url(buf) {
  const octets = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < octets.length; i++) s += String.fromCharCode(octets[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function depuisB64url(texte) {
  const b64 = String(texte).replace(/-/g, "+").replace(/_/g, "/");
  const s = atob(b64 + "===".slice((b64.length + 3) % 4));
  const octets = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) octets[i] = s.charCodeAt(i);
  return octets.buffer;
}
export const _test = { versB64url, depuisB64url };

const listeCles = (l) => (l || []).map((c) => ({ ...c, id: depuisB64url(c.id) }));
function resultatsExtensions(cred) {
  try { return JSON.parse(JSON.stringify(cred.getClientExtensionResults?.() || {})); } catch { return {}; }
}

// ---------- Défis préparés à l'avance ----------
// Safari n'autorise WebAuthn que pendant un geste de l'utilisateur : si on
// attendait le serveur APRÈS le toucher (démarrage à froid : 2 à 5 s), le
// geste serait « expiré » et la fenêtre Face ID refusée. Le défi est donc
// demandé dès l'affichage du bouton, et renouvelé avant ses 5 minutes.
// Il reste réutilisable tant qu'il n'a pas été envoyé au serveur (après une
// annulation par exemple).
function preparateur(appel) {
  let promesse = null;
  let date = 0;
  return {
    obtenir() {
      if (!promesse || Date.now() - date > 4 * 60 * 1000) {
        date = Date.now();
        const p = appel({}).then(({ data }) => data);
        p.catch(() => { if (promesse === p) promesse = null; });
        promesse = p;
      }
      return promesse;
    },
    // Défi présenté au serveur : il ne servira plus (usage unique).
    consommer() { promesse = null; },
  };
}
const defiConnexion = preparateur(optionsConnexionAppel);
const defiEnregistrement = preparateur(optionsEnregistrementAppel);
export const preparerConnexionPasskey = () => defiConnexion.obtenir().catch(() => null);
export const preparerActivationPasskey = () => defiEnregistrement.obtenir().catch(() => null);

// ---------- Activation (client connecté) ----------
// Crée la passkey sur l'appareil et l'enregistre côté serveur.
// Renvoie { id, appareil }. Lève une erreur (voir messagePasskey).
export async function activerPasskey() {
  const { idDefi, options: o } = await defiEnregistrement.obtenir();
  const publicKey = {
    ...o,
    challenge: depuisB64url(o.challenge),
    user: { ...o.user, id: depuisB64url(o.user.id) },
    excludeCredentials: listeCles(o.excludeCredentials),
  };
  const cred = await navigator.credentials.create({ publicKey });
  if (!cred) throw Object.assign(new Error("Annulé"), { name: "NotAllowedError" });
  const r = cred.response;
  const reponse = {
    id: cred.id,
    rawId: versB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: versB64url(r.clientDataJSON),
      attestationObject: versB64url(r.attestationObject),
      transports: (() => { try { return r.getTransports?.() || []; } catch { return []; } })(),
    },
    clientExtensionResults: resultatsExtensions(cred),
    ...(cred.authenticatorAttachment ? { authenticatorAttachment: cred.authenticatorAttachment } : {}),
  };
  try { if (r.getPublicKeyAlgorithm) reponse.response.publicKeyAlgorithm = r.getPublicKeyAlgorithm(); } catch { /* facultatif */ }
  try { const pk = r.getPublicKey?.(); if (pk) reponse.response.publicKey = versB64url(pk); } catch { /* facultatif */ }
  try { if (r.getAuthenticatorData) reponse.response.authenticatorData = versB64url(r.getAuthenticatorData()); } catch { /* facultatif */ }
  defiEnregistrement.consommer();
  const { data } = await enregistrerAppel({ idDefi, reponse });
  memoriser(data.id);
  return data;
}

// ---------- Connexion ----------
let controleur = null;
// Arrête une demande en cours (saisie automatique) : une seule demande
// WebAuthn à la fois par page.
export function arreterPasskey() {
  if (controleur) {
    const c = controleur;
    controleur = null;
    try { c.abort(); } catch { /* ignore */ }
  }
}

// Connexion par passkey. conditionnelle : attend en silence que la personne
// choisisse sa passkey dans la saisie automatique du champ (autocomplete
// « webauthn »). Renvoie true si la session est ouverte, false si la demande
// a été interrompue (arreterPasskey). Lève une erreur sinon.
export async function connexionPasskey({ conditionnelle = false } = {}) {
  arreterPasskey();
  const ctrl = new AbortController();
  controleur = ctrl;
  const { idDefi, options: o } = await defiConnexion.obtenir();
  if (ctrl.signal.aborted) return false;
  const publicKey = { ...o, challenge: depuisB64url(o.challenge), allowCredentials: listeCles(o.allowCredentials) };
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey, signal: ctrl.signal, ...(conditionnelle ? { mediation: "conditional" } : {}) });
  } catch (err) {
    if (err?.name === "AbortError" || ctrl.signal.aborted) return false;
    throw err;
  } finally {
    if (controleur === ctrl) controleur = null;
  }
  if (!cred) return false;
  const r = cred.response;
  const reponse = {
    id: cred.id,
    rawId: versB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: versB64url(r.clientDataJSON),
      authenticatorData: versB64url(r.authenticatorData),
      signature: versB64url(r.signature),
      ...(r.userHandle ? { userHandle: versB64url(r.userHandle) } : {}),
    },
    clientExtensionResults: resultatsExtensions(cred),
    ...(cred.authenticatorAttachment ? { authenticatorAttachment: cred.authenticatorAttachment } : {}),
  };
  defiConnexion.consommer();
  try {
    const { data } = await connexionAppel({ idDefi, reponse });
    await connexionJeton(data.jeton);
  } catch (err) {
    // Clé supprimée dans « Mon compte » : le téléphone peut l'oublier.
    if (err?.code === "functions/not-found") {
      oublier(cred.id);
      try { await window.PublicKeyCredential.signalUnknownCredential?.({ rpId: RP_ID, credentialId: cred.id }); } catch { /* facultatif */ }
    }
    throw err;
  }
  memoriser(cred.id);
  return true;
}

// ---------- Gestion (Mon compte) ----------
// → { passkeys: [{ id, appareil, dateCreation, derniereUtilisation }], userHandle }
export async function listerPasskeys() {
  const { data } = await listerAppel({});
  return data;
}

export async function supprimerPasskey(id, { restantes = [], userHandle = "" } = {}) {
  await supprimerAppel({ id });
  oublier(id);
  // Le téléphone retire (ou masque) la clé supprimée de sa liste, s'il sait
  // le faire (Signal API, navigateurs récents).
  if (userHandle) {
    try {
      await window.PublicKeyCredential.signalAllAcceptedCredentials?.({ rpId: RP_ID, userId: userHandle, allAcceptedCredentialIds: restantes });
    } catch { /* facultatif */ }
  }
}

// ---------- Messages ----------
// Message clair pour une erreur WebAuthn ou serveur. "" : rien à afficher
// (demande interrompue). action : "connexion", "activation" ou "suppression".
export function messagePasskey(err, action = "connexion") {
  const nom = err?.name || "";
  const { court, long } = LIBELLE_PASSKEY;
  if (nom === "AbortError") return "";
  if (nom === "NotAllowedError") {
    return action === "activation"
      ? "Activation annulée. Vous pourrez l’activer plus tard depuis « Mon compte »."
      : `Connexion par ${court} annulée, ou aucune clé Bokki sur cet appareil. Connectez-vous avec votre numéro et votre code, puis activez la connexion par ${court} dans « Mon compte ».`;
  }
  if (nom === "InvalidStateError") return `La connexion par ${court} est déjà activée pour Bokki sur cet appareil.`;
  if (nom === "NotSupportedError") return `Cet appareil ne permet pas la connexion par ${long}.`;
  if (nom === "SecurityError") return "Connexion par passkey impossible depuis cette adresse. Ouvrez bokki.shop.";
  const code = err?.code || "";
  if (code === "functions/resource-exhausted" || code === "functions/failed-precondition" || code === "functions/not-found" || code === "functions/permission-denied" || code === "functions/invalid-argument") {
    return err.message;
  }
  if (erreurReseau(err)) return "Le réseau est trop lent ou coupé. Vérifiez votre connexion puis réessayez.";
  const defauts = {
    activation: "Activation impossible pour le moment. Réessayez.",
    suppression: "Suppression impossible pour le moment. Réessayez.",
    connexion: "Connexion impossible. Réessayez ou connectez-vous autrement.",
  };
  return messageErreurAppel(err, defauts[action] || defauts.connexion);
}

