#!/bin/sh
# Fixe le mot de passe du rôle applicatif depuis l'environnement (jamais versionné).
set -eu

: "${RESTO_APP_PASSWORD:?RESTO_APP_PASSWORD est requis (voir infra/.env.example)}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v app_password="$RESTO_APP_PASSWORD" <<'SQL'
ALTER ROLE resto_app WITH LOGIN PASSWORD :'app_password';
SQL
