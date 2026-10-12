// Prepara um PostgreSQL local (PGlite) parecido com o Supabase: papéis anon/authenticated,
// schema auth com users e auth.uid() (lido de teste.uid), e então aplica o SQL do projeto.
async function prepararBanco(PGlite, sql) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
  `);
  // Como no Supabase: objetos novos do schema public já nascem acessíveis a anon/authenticated
  await db.exec(`
    grant usage on schema public, auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `);
  await db.exec(sql);
  return db;
}

module.exports = { prepararBanco };
