-- Evolução dos combatentes do Bando: limites novos para os lutadores do online.
-- Pior caso: Elite nível 5 com Machado, Capacete Tático e Colete Balístico
-- (⚔️ 9+4+8 = 21, 🛡️ 6+4+5+7 = 22, ❤️ 70+20 = 90).
-- Rode no SQL Editor do Supabase ANTES de publicar a versão do jogo com a evolução.
-- O "create or replace" mantém as permissões da função; o revoke abaixo só reforça.

begin;

create or replace function _lutador_valido(l jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(l) = 'object'
     and coalesce(char_length(l ->> 'id'), 0) between 1 and 40
     and coalesce(char_length(l ->> 'nome'), 0) between 1 and 24
     and (l ->> 'nome') !~ '[<>]'
     and case when jsonb_typeof(l -> 'atq') = 'number' and (l ->> 'atq') ~ '^\d{1,3}$'
              then (l ->> 'atq')::int <= 21 else false end
     and case when jsonb_typeof(l -> 'def') = 'number' and (l ->> 'def') ~ '^\d{1,3}$'
              then (l ->> 'def')::int <= 22 else false end
     and case when jsonb_typeof(l -> 'vida') = 'number' and (l ->> 'vida') ~ '^\d{1,3}$'
              then (l ->> 'vida')::int between 1 and 90 else false end;
$$;

revoke execute on function _lutador_valido(jsonb) from public, anon, authenticated;

commit;
