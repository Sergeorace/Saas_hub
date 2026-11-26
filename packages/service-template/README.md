# @resto-hub/service-template

Gabarit officiel des microservices RESTO-HUB (NestJS + TypeScript). Les 13 services de la
plateforme en sont dérivés : même socle de configuration, de sécurité et d'observabilité.

> Ce paquet n'est pas déployé. Il sert de base de copie pour générer un nouveau service.

## Ce que le gabarit fournit

| Brique        | Emplacement                               | Rôle                                                                                         |
| ------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| Configuration | `src/config.ts`                           | Variables d'environnement typées, échec explicite en production si `INTERNAL_API_KEY` manque |
| Santé         | `src/health.controller.ts`                | `GET /health` (liveness) et `GET /ready` (ping base)                                         |
| OpenAPI       | `src/openapi.ts`, `src/export-openapi.ts` | Swagger sur `/docs` hors production, export `openapi.json` pour la CI                        |
| Tenant        | `src/tenant/*`                            | En-tête `x-tenant-id`, `AsyncLocalStorage`, guard anti-fuite, base scopée par transaction    |
| RLS           | `src/tenant/rls.sql`                      | Rôle `resto_app` sans BYPASSRLS, `ENABLE + FORCE ROW LEVEL SECURITY`, journaux immuables     |
| Audit         | `src/audit/audit.service.ts`              | Chaîne de hachage append-only, vérification d'intégrité                                      |
| Événements    | `src/events/*`                            | Enveloppe métier, outbox, consommation idempotente, endpoint interne protégé par clé         |
| Exemple       | `src/example/ping.controller.ts`          | Route `GET /api/v1/ping` protégée par le guard tenant                                        |
| Tests         | `test/*.test.ts`                          | Isolation croisée, chaîne d'audit, événements, RLS réelle via PGlite                         |

## Générer un nouveau service

1. Copier le paquet : `cp -r packages/service-template services/<nom>-service`.
2. Dans `services/<nom>-service/package.json` : renommer en `@resto-hub/<nom>-service`,
   retirer `private` ou l'adapter, conserver les scripts `build`, `test`, `openapi`.
3. Renseigner le nom et le port dans `src/config.ts` (via les variables d'environnement du
   service, ports 4001–4013 réservés dans `docs/architecture.md`).
4. Remplacer `src/example/` par les modules métier du service (entités, services, contrôleurs).
5. Ajouter les tables du service dans `src/tenant/rls.sql` : `tenant_id NOT NULL`, index
   `(tenant_id, …)`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy
   `tenant_id = current_setting('app.tenant_id', true)`, `GRANT` au rôle `resto_app`.
6. Déclarer les événements publiés/consommés dans `SERVICE_EVENT_ALLOWLIST` et dans
   `packages/shared-contracts` ; documenter le contrat dans `docs/architecture.md`.
7. Ajouter le service aux scripts racine (`build:services`, `test:services`, `scripts/openapi.mjs`)
   et à `docker-compose` / `infra` si nécessaire.

## Règles non négociables

- **Aucun accès direct à la base d'un autre service** : API ou événements uniquement.
- **Toute requête métier passe par `TenantGuard`** et par `TenantDatabase.withTenant()` qui
  positionne `app.tenant_id` avant la requête SQL (RLS forcée).
- **Aucune donnée sensible dans les logs** : ni numéro de carte, ni secret, ni token.
- **Écritures sensibles** (annulation, remise, remboursement, prix, paie) : entrée d'audit.
- **Événements** : enveloppe validée, livraison idempotente, endpoint interne signé par clé.
- **Contrats** : entrées/sorties documentées (OpenAPI + `packages/shared-contracts`).

## Commandes

```bash
npm run build -w @resto-hub/service-template
npm run test -w @resto-hub/service-template
npm run openapi -w @resto-hub/service-template
```

Les tests RLS s'exécutent sur PGlite (PostgreSQL compilé en WASM) : ils appliquent réellement
`src/tenant/rls.sql` et vérifient qu'un établissement ne peut ni lire ni écrire les données
d'un autre, que le journal d'audit refuse `UPDATE`/`DELETE` et que le rôle applicatif ne peut
pas modifier le schéma.
