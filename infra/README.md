# Infra locale — RESTO-HUB

## Démarrage

```bash
cp infra/.env.example .env     # renseigner des valeurs locales, jamais commitées
npm run db:start               # PostgreSQL 16 + Redis 7 + MinIO (+ bucket resto-hub-media)
npm run db:logs                # suivre les journaux
npm run db:psql                # psql sur resto_identity
npm run db:stop                # arrêt sans perte de volumes
npm run db:reset               # ⚠ supprime les volumes locaux
```

Docker Desktop (ou Docker Engine + Compose v2) est requis pour `db:start`. Sans Docker,
`npm run db:test` reste exécutable : il utilise PostgreSQL compilé en WebAssembly (PGlite)
pour valider la même `init.sql`.

## Contenu

| Élément | Rôle |
| --- | --- |
| `docker-compose.yml` (racine) | postgres:16, redis:7, minio + initialisation idempotente du bucket |
| `infra/postgres/init.sql` | pilote identity-service : rôles, schéma `identity`, RLS forcée, audit append-only |
| `infra/postgres/20-role-password.sh` | fixe le mot de passe `resto_app` depuis `RESTO_APP_PASSWORD` |
| `infra/postgres/rls-test.mjs` | 10 tests d’isolation multi-tenant sur le moteur PostgreSQL réel |

## Modèle d’isolation retenu

- Un rôle applicatif **par service** (`resto_app` pour le pilote) : `NOSUPERUSER`, `NOBYPASSRLS`,
  aucun privilège DDL.
- Toutes les tables métier portent `tenant_id`; `ENABLE` **et** `FORCE ROW LEVEL SECURITY`.
- Politique unique `USING` + `WITH CHECK` sur `identity.current_tenant()`, alimentée par
  `set_config('app.tenant_id', …, false)` au début de chaque transaction applicative.
- Sans contexte tenant, aucune ligne n’est visible ni inscriptible (fail-closed).
- `identity.audit_log` : insertion contextualisée autorisée, `UPDATE`/`DELETE` refusés par
  privilèges **et** par trigger — l’historique reste immuable même pour le propriétaire.

## Passage à l’échelle

Chaque service disposera de sa propre base (`resto_identity`, `resto_catalog`, …) et de son rôle
applicatif. Le pilote sert de modèle : copier `init.sql`, adapter le schéma métier et conserver
le rôle dédié. Les tests `infra/postgres/rls-test.mjs` seront dupliqués par service lors de la
migration PostgreSQL.
