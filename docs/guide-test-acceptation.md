# RESTO-HUB — Guide de test des critères d'acceptation

Ce guide vérifie le périmètre des 13 services, la sécurité multi-tenant, le design system et
les parcours clés. Il combine tests automatisés et contrôles manuels au navigateur.

## 1. Prérequis et démarrage

```bash
export PATH="/c/Users/serge/tools/node:$PATH"   # Git Bash, poste de développement
npm install
npm run build:services       # 13 services + service-kit
npm run dev:services         # ports 4001 → 4013
npm run dev:web              # http://localhost:5176
npm run dev:client           # PWA client http://localhost:5175
```

Comptes de démonstration :

| Compte                    | Mot de passe     | Périmètre                                 |
| ------------------------- | ---------------- | ----------------------------------------- |
| `admin@resto-hub.tg`      | `Admin#2026`     | Super-administrateur plateforme, sans MFA |
| `gerant@sahelgrill.tg`    | `Gerant#2026`    | Gérant Sahel Grill (MFA TOTP exigée)      |
| `serveur@sahelgrill.tg`   | `Serveur#2026`   | Serveur, accès salle/commandes            |
| `comptable@sahelgrill.tg` | `Comptable#2026` | Comptable, consultation et exports        |

Établissements de démonstration : `tnt_sahelgrill` (Sahel Grill, Pro), `tnt_baobab`
(Baobab Lounge, Starter), `tnt_akwaba` (Akwaba Maquis, Entreprise, suspendu).

## 2. Tests automatisés

```bash
npm run typecheck
npm run build -w @resto-hub/web
npm run test:services
```

Critères d'acceptation :

- [ ] `typecheck` et build web sans erreur.
- [ ] `test:services` se termine avec le code 0 et **159 tests** :
      identity 15, tenant 17, catalog 13, floor 13, order 15, loyalty 9, payment 17, staff 10,
      payroll 12, inventory 12, notification 9, reporting 8, platform-admin 9.
- [ ] Chaque service possède des tests d'isolation croisée : un utilisateur d'un établissement
      reçoit `403` sur toute route d'un autre établissement, y compris en lecture et en export.
- [ ] platform-admin : un gérant reçoit `403 platform_scope_denied` sur toutes les routes
      `/api/v1/platform/*` ; un accès anonyme reçoit `401`.
- [ ] Chaîne d'audit platform-admin : la falsification d'une entrée est détectée (`chain.valid=false`).
- [ ] Limitation de débit : la 4e requête d'un quota de test (3/min) reçoit `429 rate_limited`,
      tandis que `/health` reste disponible.

## 3. Socle technique (contrats, jetons, RLS, CI, OpenAPI)

```bash
npm run lint             # 0 erreur attendue (5 avertissements exhaustive-deps tolérés)
npm run test:packages    # contrats 5/5 + jetons 8/8
npm run test:coverage    # 159 tests + seuils c8 (lignes 83,86 %)
npm run db:test          # 10 tests RLS sur PostgreSQL embarqué (sans Docker)
npm run openapi:check    # 13 services / 318 routes synchronisées
npm run tokens:check     # tokens.json et src/tokens.ts à jour vs tokens.css
npm run db:start         # Docker Compose : PostgreSQL 16 + Redis 7 + MinIO
```

Critères d'acceptation :

- [ ] `lint` : 0 erreur ; `typecheck` et `build` web/PWA sans erreur.
- [ ] `test:packages` : les 9 événements imposés sont réellement émis par les services ;
      les 6 statuts de table sont identiques dans le contrat et le code.
- [ ] Jetons : 123 couleurs identiques dans les deux thèmes ; contraste AA vérifié
      automatiquement (minimum 4,70:1) ; cible tactile 44 px ; échelle 12 → 56 px.
- [ ] `test:coverage` : 159/159 et seuils c8 respectés (lignes ≥ 70 %, fonctions ≥ 70 %,
      branches ≥ 60 %).
- [ ] `db:test` : 10/10 (rôle sans BYPASSRLS, RLS forcée, fail-closed, écriture croisée refusée,
      audit immuable, DDL interdit, contournement superutilisateur démontré).
- [ ] `openapi:check` : 318 routes réparties sur les 13 services, à jour avec les tables de routes.
- [ ] Avec Docker : `cp infra/.env.example .env`, `npm run db:start`, puis `npm run db:psql`
      (base `resto_identity`) et `docker compose ps` (postgres/redis/minio « healthy »).
- [ ] CI GitHub Actions verte sur `develop` (`.github/workflows/ci.yml`).

## 4. Sécurité — contrôles manuels

| Contrôle               | Procédure                                                                                           | Résultat attendu                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Isolation multi-tenant | Connecté `serveur@sahelgrill.tg`, appeler `/api/v1/tenants/tnt_baobab/...` (console ou client HTTP) | `403 tenant_scope_denied`, aucune donnée retournée                   |
| Périmètre plateforme   | Connecté gérant, ouvrir `#/admin`                                                                   | Écran « Accès restreint » ; appels API `403`                         |
| RBAC fine              | Comptable : onglets Stocks/Rapports visibles, actions d'écriture masquées ; Marketing absent        | Boutons désactivés/masqués, API `403` en écriture                    |
| Audit immuable         | Admin → Paramètres globaux : modifier un taux puis enregistrer                                      | Entrée `platform.settings.updated` visible, badge « Chaîne intègre » |
| Webhooks signés        | POST `/api/v1/webhooks/payments/...` sans en-tête `x-restohub-signature`                            | `401 invalid_signature`                                              |
| Aucune donnée carte    | Rechercher `cardNumber`, `cvv`, `pan` dans `services/`                                              | Aucun stockage ; seuls jetons de prestataire                         |
| Secrets                | Vérifier que les clés proviennent de `process.env` (`INTERNAL_API_KEY`, secrets prestataires)       | Aucun secret en dur hors valeurs de démo                             |
| Limitation de débit    | Script : 601 appels `GET /api/v1/platform/dashboard` en < 1 min                                     | `429` avec `retryAfterSeconds`                                       |
| En-têtes de sécurité   | `curl -I http://localhost:4013/health`                                                              | `x-content-type-options`, `x-frame-options`, `referrer-policy`       |

## 5. Back-office plateforme (Étape 8)

Connexion `admin@resto-hub.tg` → `#/admin`.

| Écran              | Vérifications                                                       | Critère                                                                   |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Vue d'ensemble     | Demandes, établissements, MRR, audit                                | Données cohérentes, états vide/erreur/chargement                          |
| Demandes           | Filtres, recherche, ouverture dossier, approbation/refus/complément | Action journalisée, toast de confirmation                                 |
| Établissements     | Liste, suspension avec motif, réactivation                          | Statut mis à jour, motif obligatoire                                      |
| Paiements          | Résumé, reversements, litiges, grand livre                          | Approbation/rejet et ouverture de litige fonctionnels                     |
| Commissions        | Périodes 7/30/90 j, graphique, regroupements, transactions          | Totaux cohérents entre résumé et groupes                                  |
| Supervision        | 13 services, latence, disponibilité, alertes, journaux              | « Vérifier maintenant » met à jour les états ; acquitter/résoudre         |
| Paramètres globaux | Langues, pays, taxes, fournisseurs, support                         | Validation serveur (400/422) sur entrée invalide, événement publié, audit |

## 6. Parcours clés

### Client final (PWA)

- [ ] Scanner un QR de table → la carte s'ouvre sur l'établissement et la table corrects.
- [ ] Parcours complet en **5 écrans maximum** : menu → panier → paiement → suivi temps réel.
- [ ] Devise XOF, formats locaux, FR par défaut, bascule EN.
- [ ] Statuts de table : libre, réservée, occupée, addition demandée, à nettoyer, hors service
      (couleurs distinctes et libellés accessibles).

### Serveur

- [ ] Depuis la connexion, le plan de salle est accessible en un geste.
- [ ] Ajout d'un article à une table en **deux touches** (sélection table → produit).
- [ ] Les statuts de table se mettent à jour en temps réel (room `floor`).

### Gérant

- [ ] Inscription multi-étapes → demande « en attente ».
- [ ] Validation super-admin → espace créé (identifiant, paramètres, équipe, catalogue vide).
- [ ] Configuration sans intervention technique : équipe, catalogue, salle, paiements.

## 7. Design system et accessibilité

- [ ] Mode clair et sombre sur tous les écrans ; contraste AA (texte ≥ 4,5:1).
- [ ] Responsive : smartphone 390 px, tablette 768 px, bureau 1280 px.
  - Barre inférieure mobile sur `#/espace` et `#/admin`, navigation latérale en bureau.
- [ ] Cibles tactiles ≥ 44 px, utilisable à une main (client/serveur).
- [ ] Focus visible au clavier, labels associés à chaque champ, boutons icône avec `aria-label`.
- [ ] Étendues : squelettes de chargement, états vides explicites, erreurs avec action de reprise.
- [ ] Personnalisation établissement : logo et couleurs surchargent le thème de l'espace client.
- [ ] Animations discrètes, sans blocage de l'interaction ; `prefers-reduced-motion` respecté.

## 8. Limites connues de la démonstration

- Les données sont **en mémoire** (réinitialisées au redémarrage) ; les prestataires de paiement
  sont simulés.
- L'onglet **Marketing** n'a pas de compte sans MFA disposant de `loyalty:view` ; il est couvert
  par les tests de service (9 cas).
- Le COGS de démonstration ne couvre que les produits avec fiche technique : la marge affichée
  sur les rapports est volontairement optimiste.
- Le gérant exige une MFA : les tests navigateur utilisent le compte comptable ou l'admin
  plateforme, sans contourner la MFA.
- **Docker n'est pas installé** sur le poste de développement actuel : `db:start`/`db:psql`
  n'ont pas pu être exécutés ici. Les scripts RLS, en revanche, tournent sur un vrai moteur
  PostgreSQL embarqué (PGlite) et sont couverts par la CI.
- Les services restent sur le kit HTTP maison et des stores en mémoire ; la migration
  NestJS/Next.js/Flutter/PostgreSQL par service est la prochaine étape, non engagée sans instruction.
