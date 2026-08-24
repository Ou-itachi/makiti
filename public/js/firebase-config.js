import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

const firebaseConfig = {
  projectId: "makiti-gn",
  appId: "1:356366688451:web:c4351a7c64f06a670e0276",
  storageBucket: "makiti-gn.firebasestorage.app",
  apiKey: "AIzaSyCHhy110KU7a9YUcqI2MOEuobodrhlUuTk",
  authDomain: "makiti-gn.firebaseapp.com",
  messagingSenderId: "356366688451",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "europe-west1");

// TEMP QA HARNESS (KAN-41 color-swatch testing) — connects to the local
// Firestore emulator instead of prod when ?emu=1 is on the URL. Must be
// reverted before this file is committed.
if (new URLSearchParams(location.search).get("emu") === "1") {
  connectFirestoreEmulator(db, location.hostname, 8080);
}
