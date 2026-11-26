-- Gabarit RESTO-HUB — isolation multi-tenant PostgreSQL
-- À copier dans les migrations du service généré, puis à adapter aux tables métier.
-- Exécuté par `npm run db:test` côté infra et par les tests du gabarit (PGlite).

CREATE ROLE resto_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO resto_app;

CREATE TABLE app.records (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.records FORCE ROW LEVEL SECURITY;

CREATE POLICY records_tenant_isolation ON app.records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON app.records TO resto_app;

-- Journal d'audit : insertion seule, aucune modification ni suppression possible.
CREATE TABLE app.audit_log (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_id text,
  action text NOT NULL,
  payload jsonb NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_tenant_read ON app.audit_log FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY audit_tenant_insert ON app.audit_log FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE OR REPLACE FUNCTION app.deny_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_immutable : le journal ne peut être modifié ni supprimé';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.deny_audit_mutation();

REVOKE UPDATE, DELETE ON app.audit_log FROM resto_app;
GRANT SELECT, INSERT ON app.audit_log TO resto_app;
GRANT USAGE, SELECT ON SEQUENCE app.audit_log_id_seq TO resto_app;

-- Fail-closed : sans app.tenant_id, current_setting() renvoie NULL et aucune ligne ne correspond.
