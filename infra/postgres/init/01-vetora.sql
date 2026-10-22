-- Local bootstrap for the vetora database (spec 0001: "Primary database", "Database roles", "Tenancy").
-- Runs once as the postgres superuser when the compose volume is first created.
-- On DigitalOcean the same steps run as doadmin through infra/digitalocean.sh.
-- Passwords here are local development values only.

-- The three base roles. Per practice roles (p_<id>_role) arrive with the data model feature,
-- which is why the migrator may create roles.
CREATE ROLE vetora_migrator LOGIN PASSWORD 'vetora_migrator' CREATEROLE;
CREATE ROLE vetora_app LOGIN PASSWORD 'vetora_app';
CREATE ROLE vetora_backup LOGIN PASSWORD 'vetora_backup';

-- One database per country: UTF8 with the ICU root collation (und-x-icu).
-- Russian and Azerbaijani sort order is set per column later (az-x-icu, ru-x-icu, spec 0002).
CREATE DATABASE vetora
  ENCODING 'UTF8'
  LOCALE_PROVIDER icu
  ICU_LOCALE 'und'
  TEMPLATE template0;

ALTER DATABASE vetora SET timezone TO 'UTC';

-- Least privilege: nobody connects by default; the migrator owns schemas, the app and backup roles only use them.
REVOKE CONNECT ON DATABASE vetora FROM PUBLIC;
GRANT CONNECT ON DATABASE vetora TO vetora_migrator, vetora_app, vetora_backup;
GRANT CREATE ON DATABASE vetora TO vetora_migrator;

\connect vetora

-- Nothing practice specific lives in public (spec 0002); the schemas control, ext, and p_<id> are created by migrations.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO vetora_migrator, vetora_app, vetora_backup;
