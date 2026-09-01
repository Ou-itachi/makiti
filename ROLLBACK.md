# Revenir en arrière (rollback) — Makitti Hosting

**Si un déploiement casse le site, on revient à la version précédente en < 1 minute.**
Firebase Hosting garde toutes les versions déployées. Un rollback = republier une
ancienne version telle quelle (aucun fichier n'est perdu, rien à reconstruire).

---

## Méthode 1 — Console Firebase (la plus simple, à faire en panique)

1. Ouvrir <https://console.firebase.google.com/project/makiti-gn/hosting/sites>
2. Onglet **« Historique des versions »** (Release history).
3. Trouver la dernière version qui marchait (avant le déploiement fautif),
   cliquer le menu **⋮** à droite de sa ligne → **« Restaurer »** (Rollback) → confirmer.

Le site repart sur cette version **immédiatement** (pas de propagation DNS, pas de cache CDN
à attendre — vérifié en conditions réelles le 01/09/2026, le changement était visible en
moins de 3 secondes).

> Astuce : garder cet onglet « Historique des versions » ouvert pendant chaque
> déploiement risqué, pour avoir le bouton Restaurer à portée de clic.

## Méthode 2 — Ligne de commande (si pas d'accès console)

```bash
# 1. lister les versions récentes (les plus récentes en haut)
firebase hosting:channel:list --project makiti-gn        # canaux
# OU, pour la liste complète des versions déployées :
#   Console > Hosting > Historique des versions
#   (le CLI n'a plus de commande "versions:list" en v15)

# 2. redéployer depuis le code d'une version qui marchait
git log --oneline                      # trouver le commit d'avant
git stash                              # mettre de côté le travail en cours
git checkout <commit-qui-marchait>
firebase deploy --only hosting --project makiti-gn
git checkout -   &&  git stash pop     # revenir au travail en cours
```

La méthode 2 prend ~30-40 s (le temps d'un `firebase deploy`) + le temps de
retrouver le bon commit. **La méthode 1 (console) est plus rapide et plus sûre**
parce qu'elle republie exactement les fichiers déjà en ligne, sans rebuild.

---

## Test réel effectué (KAN-64, 01/09/2026)

| Étape | Durée mesurée |
|---|---|
| Déploiement d'une modif test (`firebase deploy --only hosting`) | ~17 s |
| Rollback via la console / l'API Hosting | **1,3 s** (appel) |
| Propagation visible sur `makiti-gn.web.app` | **immédiate** (< 3 s) |
| Restauration confirmée | ✅ la modif test avait bien disparu |

Conclusion : en cas de problème après un déploiement, on est de retour sur la
version stable en **moins d'une minute**, sans perte de données.

---

## Ce qu'un rollback Hosting NE couvre PAS

- **Les règles Firestore/Storage** (`firestore.rules`, `storage.rules`) : elles se
  déploient à part (`firebase deploy --only firestore:rules`). Pour revenir en arrière :
  remettre l'ancien fichier `.rules` et le redéployer. Garde une copie de la version
  qui marche.
- **Les Cloud Functions** : `firebase deploy --only functions` avec l'ancien code.
- **Les données Firestore** (produits, commandes…) : un rollback Hosting ne les touche
  pas. Pour ça, il faut les sauvegardes Firestore (export planifié dans la console).
