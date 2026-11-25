# RESTO-HUB — Workflow Git

Règles obligatoires du projet. Ce document est mis à jour à chaque étape.

## 1. État du dépôt

- Le dossier de travail **n'est pas encore un dépôt Git** (`git init` à faire).
- Tant que l'initialisation n'est pas faite, aucun branchement ni tag ne peut être appliqué.
- Séquence d'amorçage proposée, à valider : `git init` → commit initial sur `main` (exception
  unique d'amorçage) → création de `develop` → travail exclusif depuis `develop`.

## 2. Branches

| Préfixe | Usage | Créée depuis |
|---|---|---|
| `main` | code stable, versionné | — |
| `develop` | intégration continue | `main` |
| `service/<nom>` | évolution d'un service (ex. `service/payment-service`) | `develop` |
| `space/<super-admin\|gerant\|employe\|client>` | espace fonctionnel | `develop` |
| `design/<nom>` | design system et thèmes | `develop` |
| `feature/<service>/<fonctionnalité>` | fonctionnalité isolée | `develop` |
| `fix/<service>/<description>` | correction ciblée | `develop` |

- Jamais de commit direct sur `main` ni `develop` (hors amorçage initial).
- Une branche = une seule fonctionnalité ; un commit = une unité logique.
- Avant tout changement de branche : `git status` doit être propre (sinon commit ou stash dédié).

## 3. Commits

Format Conventional Commits avec le service ou l'espace concerné :

```
<type>(<service-ou-espace>): <fonctionnalité> - <description>
```

Types autorisés : `feat`, `fix`, `design`, `refactor`, `test`, `docs`, `chore`.

Exemples :

- `feat(floor-service): unique-table-numbering - contrainte d'unicité ETAB-ZONE-NUMERO`
- `design(designSystem): dark-mode-audit - contraste AA sur les statuts de table`
- `docs(architecture): etape-8 - platform-admin, securite et finition`

## 4. Fin de fonctionnalité

1. Push de la branche.
2. Pull Request vers `develop` (titre = nom de la fonctionnalité).
3. Revue puis merge dans la branche `service/*` ou `space/*` concernée.
4. Suppression de la branche de fonctionnalité.

## 5. Tags d'étape

Un tag annoté clôt chaque étape validée :

| Tag | Périmètre |
|---|---|
| `v0.1.0-socle` | architecture, design system, accueil de démonstration |
| `v0.2.0-identity-tenant` | identity-service, tenant-service |
| `v0.3.0-catalog-floor` | catalog-service, floor-service |
| `v0.4.0-order` | order-service |
| `v0.5.0-client-pwa` | application client |
| `v0.6.0-payment` | payment-service |
| `v0.7.0-staff-payroll` | staff-service, payroll-service |
| `v0.8.0-operations` | inventory, loyalty-marketing, notification, reporting |
| `v0.9.0-platform-admin` | platform-admin-service, sécurité et finition |

Les tags des étapes 1 à 8 restent à poser une fois le dépôt initialisé.

## 6. Hygiène

- `.env.example` uniquement ; aucun secret ni identifiant réel versionné.
- `node_modules/`, `dist/`, journaux et artefacts de build exclus.
- Mise à jour de ce document et de `docs/architecture.md` à chaque étape.
- CI (lint, typecheck, tests, couverture ≥ 70 %) à brancher dès la mise en place du dépôt.
