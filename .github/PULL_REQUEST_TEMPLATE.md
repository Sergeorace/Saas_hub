## Objet

<!-- Décrire le périmètre : service/domaine, problème, solution retenue. -->

## Type de changement

- [ ] `feat` — nouvelle fonctionnalité
- [ ] `fix` — correction
- [ ] `design` — design system / interface
- [ ] `refactor` — refactorisation sans changement fonctionnel
- [ ] `test` — tests
- [ ] `docs` — documentation
- [ ] `chore` — outillage, infrastructure

## Branche et commits

- Branche : `feature/…`
- Commits : liste des messages Conventional Commits inclus.

## Vérifications exécutées

- [ ] `npm run format:check`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test` (contrats, jetons, services + couverture)
- [ ] `npm run db:test` (RLS multi-tenant)
- [ ] `npm run openapi:check`
- [ ] `npm run build`

## Impacts

- **Multi-tenant / RLS** : routes ou tables touchées, tests d'isolation croisée ajoutés ?
- **Sécurité** : secrets, webhooks, audit, données personnelles.
- **Contrats** : événements publiés/consommés, DTO modifiés.
- **Design** : tokens/composants utilisés, mode sombre et accessibilité vérifiés.
- **Documentation** : `docs/architecture.md`, OpenAPI, `docs/GIT_WORKFLOW.md` mis à jour.

## Captures / preuves

<!-- Captures clair/sombre, sorties de tests, mesures de couverture. -->

## Limites connues

<!-- Ce qui n'est pas couvert, dépendances externes, suivi planifié. -->
