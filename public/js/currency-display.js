// Les prix catalogue sont stockés en GNF. Cette couche ne modifie que leur
// affichage : le serveur continue à recalculer et enregistrer les commandes en GNF.
const COUNTRY_CURRENCY = { FR: "EUR", GN: "GNF", SN: "XOF", US: "USD" };
const STORAGE_KEY = "bokki-currency-display-v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const listeners = new Set();

let countryCode = "";
let currencyCode = "GNF";
let rates = { GNF: 1 };

try {
  const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  if (cached && cached.countryExpiresAt > Date.now()) {
    countryCode = cached.countryCode || "";
    currencyCode = COUNTRY_CURRENCY[countryCode] || "GNF";
  }
  if (cached?.rates && cached.ratesExpiresAt > Date.now()) rates = cached.rates;
} catch {
  // La devise par défaut est GNF si le stockage du navigateur est indisponible.
}

export function activeCurrency() {
  return currencyCode;
}

export function formatCurrencyFromGNF(value) {
  const amount = Number(value) || 0;
  const rate = Number(rates[currencyCode]);
  if (currencyCode !== "GNF" && (!Number.isFinite(rate) || rate <= 0)) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "GNF", maximumFractionDigits: 0 }).format(amount);
  }
  const converted = currencyCode === "GNF" ? amount : amount * rate;
  const fractionDigits = currencyCode === "EUR" || currencyCode === "USD" ? 2 : 0;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(converted);
}

export function moneyHTML(value) {
  const amount = Number(value) || 0;
  return `<span data-currency-gnf="${amount}">${formatCurrencyFromGNF(amount)}</span>`;
}

export function refreshCurrencyPrices(root = document) {
  root.querySelectorAll("[data-currency-gnf]").forEach((node) => {
    node.textContent = formatCurrencyFromGNF(node.dataset.currencyGnf);
  });
}

export function onCurrencyChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function publishCurrency() {
  for (const callback of listeners) callback(currencyCode);
  refreshCurrencyPrices();
  updateDisclosure();
}

function updateDisclosure() {
  let note = document.getElementById("currencyDisclosure");
  if (currencyCode === "GNF") {
    note?.remove();
    return;
  }
  if (!note) {
    note = document.createElement("p");
    note.id = "currencyDisclosure";
    note.className = "currency-disclosure";
    note.style.cssText = "padding:10px 16px;margin:0;text-align:center;font-size:11px;line-height:1.5;color:var(--muted,#64748b)";
    const checkout = document.querySelector("#pnForm, #orderForm");
    const submit = checkout?.querySelector('button[type="submit"]');
    if (submit) checkout.insertBefore(note, submit);
    else {
      const footer = document.querySelector("footer");
      if (footer) footer.append(note);
      else document.body.append(note);
    }
  }
  note.innerHTML = 'Prix convertis à titre indicatif. Les commandes restent enregistrées en GNF. Taux par <a href="https://www.exchangerate-api.com/" target="_blank" rel="noopener noreferrer">ExchangeRate-API</a>.';
}

async function lirePays() {
  const response = await fetch("https://ipwho.is/?fields=success,country_code", { cache: "no-store", signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error("Détection du pays indisponible");
  const data = await response.json();
  if (!data.success) throw new Error("Détection du pays indisponible");
  const code = String(data.country_code || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

async function lireTaux() {
  const response = await fetch("https://open.er-api.com/v6/latest/GNF", { cache: "no-store", signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error("Taux de change indisponibles");
  const data = await response.json();
  if (data.result !== "success" || data.base_code !== "GNF") throw new Error("Réponse de taux invalide");
  const nextRates = { GNF: 1 };
  for (const code of ["EUR", "XOF", "USD"]) {
    const rate = Number(data.rates?.[code]);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Taux ${code} indisponible`);
    nextRates[code] = rate;
  }
  return nextRates;
}

async function initialiserDevise() {
  let ratesExpiresAt = 0;
  try {
    const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    ratesExpiresAt = Number(cached?.ratesExpiresAt) || 0;
  } catch {
    // Stockage facultatif.
  }

  try {
    if (!countryCode) countryCode = await lirePays();
    currencyCode = COUNTRY_CURRENCY[countryCode] || "GNF";
    if (currencyCode !== "GNF" && ratesExpiresAt <= Date.now()) {
      rates = await lireTaux();
      ratesExpiresAt = Date.now() + DAY_MS;
    }
  } catch (error) {
    // En cas d'échec réseau, garder la dernière devise et les taux en cache.
    console.info("[Bokki] Affichage de devise locale indisponible :", error);
    if (currencyCode !== "GNF" && !rates[currencyCode]) currencyCode = "GNF";
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      countryCode,
      countryExpiresAt: Date.now() + DAY_MS,
      rates,
      ratesExpiresAt,
    }));
  } catch {
    // Aucun stockage persistant nécessaire au fonctionnement du site.
  }
  publishCurrency();
}

void initialiserDevise();
