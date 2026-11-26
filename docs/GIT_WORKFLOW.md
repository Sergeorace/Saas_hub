# RESTO-HUB — Workflow Git

Règles obligatoires du projet. Ce document est mis à jour à chaque étape.

## 1. État du dépôt

- Dépôt initialisé : `main` (commit d'amorçage `e82770f`, étapes 1–8 importées en une fois) et
  `develop` au même commit. Exception d'amorçage documentée : ce commit unique est le seul à ne pas
  être passé par `develop`.
- Le socle technique est développé sur `feature/infra/socle`, puis fusionné dans `develop`.
- Les étiquettes d'étapes 1–8 pointent toutes sur `e82770f` : l'historique détaillé n'a pas été
  reconstitué (import consolidé). Les étapes suivantes sont taguées normalement.
- Identité de commit utilisée par l'outillage : `Qoder <qoder@localhost>` via variables
  d'environnement de commande (aucune configuration Git globale modifiée).
- **Étape socle (branches dédiées)** : `feature/platform/monorepo-scaffold`,
  `design/design-system`, `feature/platform/prettier-baseline`,
  `feature/shared/service-template`, `feature/shared/shared-contracts`, `feature/platform/git-attributes`, `feature/platform/docs-socle`, `feature/platform/docs-journal` — toutes
  fusionnées dans `develop` par `--no-ff` (voir §7).
- **Pas de remote configuré et `gh` indisponible sur la machine de développement** : les pushes et
  Pull Requests ne peuvent pas être exécutés depuis cet environnement. Les titres/descriptions de
  PR sont préparés dans le journal (§7) pour être ouverts dès qu'un remote est ajouté ; ce
  contournement est explicite et ne modifie pas la règle « PR vers `develop` ».

## 2. Branches

| Préfixe                                        | Usage                                                  | Créée depuis |
| ---------------------------------------------- | ------------------------------------------------------ | ------------ |
| `main`                                         | code stable, versionné                                 | —            |
| `develop`                                      | intégration continue                                   | `main`       |
| `service/<nom>`                                | évolution d'un service (ex. `service/payment-service`) | `develop`    |
| `space/<super-admin\|gerant\|employe\|client>` | espace fonctionnel                                     | `develop`    |
| `design/<nom>`                                 | design system et thèmes                                | `develop`    |
| `feature/<service>/<fonctionnalité>`           | fonctionnalité isolée                                  | `develop`    |
| `fix/<service>/<description>`                  | correction ciblée                                      | `develop`    |

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

| Tag                      | Périmètre                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `v0.1.0-socle`           | monorepo outillé, design system (web + Flutter + vitrine), gabarit NestJS, contrats typés, docs      |
| `v0.2.0-identity-tenant` | identity-service, tenant-service                                                                     |
| `v0.3.0-catalog-floor`   | catalog-service, floor-service                                                                       |
| `v0.4.0-order`           | order-service                                                                                        |
| `v0.5.0-client-pwa`      | application client                                                                                   |
| `v0.6.0-payment`         | payment-service                                                                                      |
| `v0.7.0-staff-payroll`   | staff-service, payroll-service                                                                       |
| `v0.8.0-operations`      | inventory, loyalty-marketing, notification, reporting                                                |
| `v0.9.0-platform-admin`  | platform-admin-service, sécurité et finition                                                         |
| `v0.1.1-infra`           | incrément technique (hors étape produit) : contrats partagés, jetons, infra locale, RLS, CI, OpenAPI |
| `v0.1.2-vitrine`         | incrément de design : refonte de la vitrine marketing selon la direction artistique Cravk            |

`v0.9.0-platform-admin` clôt le commit d'amorçage. `v0.1.1-infra` étiquette le merge du socle dans
`develop`; les étapes 1–8 n'ont pas d'étiquette individuelle (import consolidé, voir §1).
`v0.1.2-vitrine` étiquette la refonte Cravk de la page marketing (voir §8).

## 6. Hygiène

- `.env.example` uniquement ; aucun secret ni identifiant réel versionné.
- `node_modules/`, `dist/`, journaux et artefacts de build exclus.
- Mise à jour de ce document et de `docs/architecture.md` à chaque étape.
- CI GitHub Actions opérationnelle : `.github/workflows/ci.yml` (lint, typecheck, build, contrats,
  tests services + couverture ≥ 70 % lignes, RLS, OpenAPI).
- `npm run verify` rejoue localement l'essentiel de la CI ; `npm run openapi:check` et
  `npm run test:tokens` gardent la documentation et les jetons alignés sur le code.

## 7. Journal de l'étape « socle » (v0.1.0-socle)

Chaque fonctionnalité a une branche dédiée, issue de `develop`, fusionnée par `--no-ff`.
Les commits ci-dessous sont ceux de la branche (le merge correspondant est indiqué).

| Branche                              | Commits (message)                                                                                                                                                                                                                                                                                                                                                                | Merge dans `develop` | Titre de PR préparé                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `feature/platform/monorepo-scaffold` | `3f194db` chore(platform): outillage - prettier, env d exemple, readme et contribution · `93fd337` chore(platform): monorepo-scaffold - formatage initial et modele de pull request                                                                                                                                                                                              | `31fbc7b`            | `chore(platform): monorepo-scaffold - outillage du monorepo`                       |
| `design/design-system`               | `dda978e` design(designSystem): tokens - contrat visuel, palette, statuts et echelle typographique · `e4945c9` design(designSystem): composants - catalogue des composants web accessibles · `7c30131` design(designSystem): flutter-theme - theme Material 3 genere depuis les jetons · `253eef8` design(designSystem): page-design - vitrine des composants en clair et sombre | `983da4a`            | `design(designSystem): design system - jetons, composants, thème Flutter, vitrine` |
| `feature/platform/prettier-baseline` | `a747f84` chore(platform): prettier - aligner le formatage du dépôt sur la configuration commune                                                                                                                                                                                                                                                                                 | `f643f9d`            | `chore(platform): prettier - aligner le formatage du dépôt`                        |
| `feature/shared/service-template`    | `105ae8d` feat(shared): service-template - gabarit NestJS sécurisé pour les 13 microservices                                                                                                                                                                                                                                                                                     | `d191fba`            | `feat(shared): service-template - gabarit NestJS sécurisé`                         |
| `feature/shared/shared-contracts`    | `c09326f` feat(shared): contrats - charges utiles typées des neuf événements obligatoires                                                                                                                                                                                                                                                                                        | `49b0455`            | `feat(shared): contrats - charges utiles typées des événements`                    |
| `feature/platform/docs-socle`        | `docs(platform): socle - architecture des services, gabarit et workflow Git`                                                                                                                                                                                                                                                                                                     | `2218ce5`            | `docs: socle - architecture et workflow Git`                                       |
| `feature/platform/git-attributes`    | `82e5c00` chore(platform): git-attributes - normaliser les fins de ligne en LF sur tous les postes                                                                                                                                                                                                                                                                               | `2287b88`            | `chore(platform): git-attributes - normaliser les fins de ligne`                   |

- Tag de clôture : **`v0.1.0-socle`** (annoté) posé sur `develop` après la fusion de `feature/platform/docs-socle`.
- Les PR ne peuvent pas être ouvertes depuis cette machine (aucun remote, pas de `gh`) : les titres
  ci-dessus et les descriptions du modèle `.github/PULL_REQUEST_TEMPLATE.md` sont prêts à l'emploi.
- Les branches fusionnées sont supprimées après merge (`git branch -d`), conformément au §4 ; les
  branches de service sont conservées uniquement pour les étapes suivantes.
- Aucun commit direct sur `main` ni `develop` : les commits de merge de chaque branche sont les seuls objets
  créés sur `develop`, et `main` reste sur `e82770f`.

## 8. Journal de l'étape « vitrine Cravk »

Refonte de la page marketing à partir de la référence Dribbble
« Cravk – Food Delivery App Landing Page » (Sheikh Elias / uixelias).

| Branche                | Commits (message)                                                                                                                                          | Merge dans `develop` | Titre de PR préparé                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| `design/landing-cravk` | `3b155bb` design(landing): cravk - direction artistique, navigation et héros · `eeaa649` feat(landing): cravk - récit, preuves sociales et CTA application | `fcb0d52`            | `design(landing): cravk - refonte de la vitrine marketing` |

- Périmètre : navigation noire flottante, héros avec aperçu téléphone du parcours client,
  bandeau de confiance, récit d'établissement, témoignages et bandeau application ; les sections
  produit existantes (cockpit, services, parcours, paiements, design system, tarifs) sont conservées.
- i18n FR/EN (`landing.*`), thème clair et sombre, cibles tactiles ≥ 44 px, animation désactivée
  avec `prefers-reduced-motion` ; menu mobile refermable au clavier (`Échap`).
- Les contenus de la section paiements sont rétablis via le namespace `paymentsShowcase`, le
  namespace `payments` restant réservé à l'espace gérant.
- Vérifications : `format:check`, `lint` (0 erreur), `typecheck` et `build` web ; captures clair,
  sombre, mobile 390 px et anglais ; aucun débordement horizontal à 1440 px ni 390 px.
