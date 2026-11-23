\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
SELECT format('CREATE ROLE gbrain_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
              trim(trailing E'\n' from pg_read_file('/run/gbrain-secrets/app'))) \gexec
REVOKE ALL ON DATABASE gbrain FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE gbrain TO gbrain_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE, USAGE ON SCHEMA public TO gbrain_app;
-- The v24 and v35 migrations check BYPASSRLS. The schema login is enabled only for the
-- explicit migration. Membership runs in this direction so the app cannot assume it.
CREATE ROLE gbrain_schema NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT gbrain_app TO gbrain_schema;
-- gbrain v35 requires this event trigger, which only the cluster administrator can create.
CREATE FUNCTION public.auto_enable_rls() RETURNS event_trigger LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF item.object_type IN ('table', 'partitioned table') AND item.schema_name = 'public' THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', item.objid::regclass);
    END IF;
  END LOOP;
END $$;
CREATE EVENT TRIGGER auto_rls_on_create_table
  ON ddl_command_end WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.auto_enable_rls();
