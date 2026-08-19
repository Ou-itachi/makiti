# Makiti

Makiti est une web app e-commerce pour la Guinée — HTML, CSS, JS et Firebase.

## Workflow Git

- `main` — branche de production, stable et vérifiée.
- `dev` — branche d'intégration, chaque fonctionnalité y est mergée après test.
- `feature/*` — une branche par fonctionnalité, créée depuis `dev`, mergée dans `dev` une fois terminée.

Flux : `feature/xxx` → `dev` (après vérification) → `main`.
