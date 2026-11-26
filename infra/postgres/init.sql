-- ==========================================================================
-- RESTO-HUB — pilote PostgreSQL : isolation multi-tenant (identity-service)
-- Joué par docker-compose (docker-entrypoint-initdb.d) et par rls-test.mjs.
-- ==========================================================================

CREATE SCHEMA IF NOT EXISTS identity;

-- ---- Rôle applicatif : jamais superutilisateur, jamais BYPASSRLS ---------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resto_app') THEN
    CREATE ROLE resto_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA identity FROM PUBLIC;
GRANT USAGE ON SCHEMA identity TO resto_app;

-- ---- Établissements (tenant) et utilisateurs ------------------------------
CREATE TABLE IF NOT EXISTS identity.tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  country_code text NOT NULL DEFAULT 'TG',
  currency text NOT NULL DEFAULT 'XOF',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.users (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES identity.tenants(id),
  phone text NOT NULL,
  email text,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('gerant', 'manager', 'serveur', 'caissier', 'cuisinier', 'barman', 'livreur', 'comptable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

CREATE TABLE IF NOT EXISTS identity.audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash text,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---- Contexte tenant : GUC posé par la couche applicative ----------------
CREATE OR REPLACE FUNCTION identity.current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

GRANT EXECUTE ON FUNCTION identity.current_tenant() TO resto_app;

-- ---- Row-Level Security : fail-closed, forcée même pour le propriétaire --
ALTER TABLE identity.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.users FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_tenant_isolation ON identity.tenants;
CREATE POLICY tenants_tenant_isolation ON identity.tenants
  USING (id = identity.current_tenant())
  WITH CHECK (id = identity.current_tenant());

DROP POLICY IF EXISTS users_tenant_isolation ON identity.users;
CREATE POLICY users_tenant_isolation ON identity.users
  USING (tenant_id = identity.current_tenant())
  WITH CHECK (tenant_id = identity.current_tenant());

DROP POLICY IF EXISTS audit_log_tenant_isolation ON identity.audit_log;
CREATE POLICY audit_log_tenant_isolation ON identity.audit_log
  USING (tenant_id = identity.current_tenant())
  WITH CHECK (tenant_id = identity.current_tenant());

-- ---- Journal d'audit immuable --------------------------------------------
CREATE OR REPLACE FUNCTION identity.deny_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identity.audit_log est immuable (append-only)';
END
$$;

DROP TRIGGER IF EXISTS audit_log_immutable ON identity.audit_log;
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON identity.audit_log
  FOR EACH ROW EXECUTE FUNCTION identity.deny_audit_mutation();

-- ---- Privilèges applicatifs (aucun DDL, aucun DELETE) ---------------------
REVOKE ALL ON identity.tenants, identity.users, identity.audit_log FROM resto_app;
GRANT SELECT ON identity.tenants TO resto_app;
GRANT SELECT, INSERT, UPDATE ON identity.users TO resto_app;
GRANT SELECT, INSERT ON identity.audit_log TO resto_app;
GRANT USAGE, SELECT ON SEQUENCE identity.audit_log_id_seq TO resto_app;
