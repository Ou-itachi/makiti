// Photo « Endommagée » : réduite sur le téléphone, le serveur refuse au-delà de 700 Ko.
export async function compresserPhotoIncident(fichier) {
  const image = await createImageBitmap(fichier).catch(() => { throw new Error("Cette photo ne peut pas être lue."); });
  const echelle = Math.min(1, 1280 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * echelle);
  canvas.height = Math.round(image.height * echelle);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  return { mimeType: "image/jpeg", base64: dataUrl.split(",")[1] };
}

// Identifiant d'une action de statut : le serveur ne l'applique qu'une fois.
export function nouvelIdAction() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return [...crypto.getRandomValues(new Uint8Array(16))].map((o) => o.toString(16).padStart(2, "0")).join("");
}
