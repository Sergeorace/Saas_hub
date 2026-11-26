# Contribuer à RESTO-HUB

Merci de respecter ces règles : elles garantissent l'isolation multi-tenant, la qualité et la
traçabilité exigées par le cahier des charges.

## 1. Environnement

```bash
npm install
cp .env.example .env
npm run verify
```

Node.js ≥ 22. Docker est nécessaire uniquement pour PostgreSQL/Redis/MinIO locaux.

## 2. Branches

| Préfixe                                        | Usage                     | Depuis    |
| ---------------------------------------------- | ------------------------- | --------- |
| `feature/<domaine>/<fonctionnalité>`           | fonctionnalité transverse | `develop` |
| `service/<nom>`                                | évolution d'un service    | `develop` |
| `space/<super-admin\|gerant\|employe\|client>` | espace fonctionnel        | `develop` |
| `design/<nom>`                                 | design system / thèmes    | `develop` |
| `fix/<service>/<description>`                  | correction ciblée         | `develop` |
| `docs/<sujet>`                                 | documentation             | `develop` |

- Jamais de commit direct sur `main` ni `develop`.
- Une branche = une fonctionnalité ; un commit = une unité logique.
- `git status` propre avant tout changement de branche.

## 3. Commits

```
<type>(<service-ou-espace>): <fonctionnalité> - <description>
```

Types : `feat`, `fix`, `design`, `refactor`, `test`, `docs`, `chore`.

Exemple : `feat(floor-service): qr-tables - génération d'un QR unique par place`

## 4. Avant d'ouvrir une Pull Request

1. `npm run format:check`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test:packages`
5. `npm run test:coverage` (lignes ≥ 70 %, fonctions ≥ 70 %, branches ≥ 60 %)
6. `npm run db:test`
7. `npm run openapi:check`

La PR cible `develop`, utilise le modèle `.github/PULL_REQUEST_TEMPLATE.md` et décrit le
périmètre, les tests exécutés et les éventuelles limites.

## 5. Règles techniques

- **Multi-tenant** : `tenant_id` sur toute entité métier, filtre côté serveur, RLS PostgreSQL ;
  tout test d'isolation croisée est obligatoire (403 attendu).
- **Contrats** : événements et DTO dans `packages/shared-contracts` ; aucun accès direct à la base
  d'un autre service (API ou événements uniquement).
- **Sécurité** : aucun secret en dur (`.env.example` uniquement), aucun numéro de carte stocké,
  webhooks signés et idempotents, journal d'audit immuable.
- **Design** : uniquement les tokens de `packages/design-tokens` et les composants de
  `packages/design-system` ; clair + sombre, contraste AA, cible tactile ≥ 44 px.
- **UI** : chaque écran couvre chargement (skeleton), état vide et erreur avec reprise.
- **API** : documentée OpenAPI (`npm run openapi` après toute route ajoutée), p95 < 500 ms visé.

## 6. Revue

Deux relectures recommandées pour les services financiers (`payment-service`, `payroll-service`) :
revue fonctionnelle + revue sécurité. Toute action sensible doit produire une entrée d'audit.
