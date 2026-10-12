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
  await db.exec(sql);
  return db;
}

module.exports = { prepararBanco };
