-- ============================================================
-- ATÉ AMANHÃ — Feedback dos testadores
-- Colar inteiro no SQL Editor do Supabase e clicar em Run.
-- Os jogadores só conseguem ENVIAR; ninguém lê pelo jogo.
-- Para ler: Table Editor → feedback (ordenar por criado_em).
-- ============================================================

begin;

create table if not exists feedback (
  id        uuid default gen_random_uuid() primary key,
  user_id   uuid references auth.users(id) on delete set null default auth.uid(),
  email     text check (email is null or char_length(email) <= 120),
  tipo      text not null check (tipo in ('bug', 'sugestao', 'outro')),
  mensagem  text not null check (char_length(mensagem) between 3 and 2000),
  contexto  jsonb not null default '{}' check (pg_column_size(contexto) < 16000),
  criado_em timestamptz default now()
);

alter table feedback enable row level security;

-- Qualquer jogador pode enviar, inclusive quem joga sem conta (user_id vazio).
-- Quem está logado só pode enviar em seu próprio nome.
drop policy if exists "Jogadores enviam feedback" on feedback;
create policy "Jogadores enviam feedback" on feedback
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- Sem policy de select/update/delete: pelo jogo ninguém lê nem altera.

commit;
