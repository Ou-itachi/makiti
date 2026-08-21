import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
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
