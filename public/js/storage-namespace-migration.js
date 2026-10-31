// Préserve les préférences et données locales créées avant le rebranding.
// Cette migration est exécutée avant les scripts qui lisent les nouvelles clés.
(function () {
  try {
    const localKeys = [
      ["makiti-theme", "bokki-theme"],
      ["makiti-panier", "bokki-panier"],
      ["makiti-mes-commandes", "bokki-mes-commandes"],
      ["makiti-ios-install-dismissed", "bokki-ios-install-dismissed"],
      ["makiti-emulator", "bokki-emulator"],
    ];
    for (const [oldKey, newKey] of localKeys) {
      const previous = localStorage.getItem(oldKey);
      if (previous !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, previous);
      }
      if (previous !== null) localStorage.removeItem(oldKey);
    }

    const oldPrefill = sessionStorage.getItem("makiti-prefill-produit");
    if (oldPrefill !== null && sessionStorage.getItem("bokki-prefill-produit") === null) {
      sessionStorage.setItem("bokki-prefill-produit", oldPrefill);
    }
    if (oldPrefill !== null) sessionStorage.removeItem("makiti-prefill-produit");
  } catch (error) {
    // Le site reste utilisable si le navigateur bloque son stockage local.
  }
})();
