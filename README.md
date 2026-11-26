# RESTO-HUB

Plateforme SaaS multi-établissements de gestion pour restaurants et bars (Togo / Afrique de
l'Ouest). Devise par défaut **XOF**, langues **FR + EN**, interface web gérant/super-admin,
application client en PWA, et 13 services métier faiblement couplés.

> Source de vérité fonctionnelle : [`docs/cahier-des-charges.pdf`](docs/cahier-des-charges.pdf).
> Architecture et contrats : [`docs/architecture.md`](docs/architecture.md).

## Structure du monorepo

```
apps/
  web/                 Back-office gérant, super-admin et vitrine (Vite + React + TS)
  client/              Application client PWA (scan QR, menu, panier, paiement, suivi)
  mobile/              Thème Flutter (design system mobile)
packages/
  design-tokens/       Jetons de design (CSS, TS, JSON, thème Flutter)
  design-system/       Bibliothèque de composants React accessibles
  shared-contracts/    Événements métier, DTO et énumérations partagés
  service-kit/         Kit HTTP interne des prototypes de services
services/
  identity-service/ … platform-admin-service/   13 services métier (ports 4001–4013)
templates/
  nestjs-service/      Gabarit NestJS des futurs services (config, RLS, audit, événements)
infra/
  postgres/            Initialisation PostgreSQL : rôles, RLS, audit immuable
docs/                  Architecture, workflow Git, OpenAPI généré, guide de test
scripts/               Outillage (db, openapi, dev-services)
```

## Prérequis

- Node.js ≥ 22 et npm ≥ 10
- Docker (PostgreSQL 16, Redis 7, MinIO) — optionnel pour les tests : `db:test` utilise
  PostgreSQL embarqué (PGlite)
- Flutter SDK pour `apps/mobile` (thème uniquement pour l'instant)

## Démarrage

```bash
npm install
cp .env.example .env            # renseigner les mots de passe locaux
npm run db:start                # PostgreSQL + Redis + MinIO (si Docker)
npm run build:services          # 13 services + kit
npm run dev:services            # ports 4001 → 4013
npm run dev:web                 # back-office (5176 par défaut)
npm run dev:client              # PWA client (5175 par défaut)
```

Comptes de démonstration et parcours de recette : [`docs/guide-test-acceptation.md`](docs/guide-test-acceptation.md).

## Qualité

```bash
npm run lint          # ESLint (0 erreur)
npm run format:check  # Prettier
npm run typecheck     # TypeScript web + PWA
npm run test          # contrats + jetons + 13 services avec seuils de couverture
npm run db:test       # 10 tests RLS sur PostgreSQL embarqué
npm run openapi:check # 13 services / 318 routes synchronisées
npm run verify        # enchaînement complet proche de la CI
```

## Règles du projet

- Un service possède ses données : aucun accès direct à la base d'un autre service.
- `tenant_id` obligatoire + Row-Level Security + tests d'isolation croisée.
- Aucun secret versionné, aucun numéro de carte stocké ; webhooks signés et idempotents.
- Design system obligatoire (tokens, mode clair/sombre, AA, cibles 44 px).
- Workflow Git et convention de commits : [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md).
