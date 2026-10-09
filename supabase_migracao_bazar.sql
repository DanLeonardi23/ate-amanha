-- ============================================================
-- ATÉ AMANHÃ — Migração de segurança do Bazar (2026-10-08)
-- Colar inteiro no SQL Editor do Supabase e clicar em Run.
-- Tudo roda numa transação: se der erro, nada é aplicado.
-- ============================================================

begin;

-- Validação dos campos de texto (defesa contra HTML/JS injetado por clientes).
-- Remove anúncios antigos que violariam as regras antes de aplicá-las.
delete from bazar
 where item_id !~ '^[a-z0-9_]{1,40}$'
    or char_length(vendedor_nome) > 30 or vendedor_nome ~ '[<>]'
    or char_length(item_nome)     > 60 or item_nome     ~ '[<>]'
    or char_length(item_icone)    > 16 or item_icone    ~ '[<>]';

alter table bazar drop constraint if exists bazar_item_id_formato;
alter table bazar add  constraint bazar_item_id_formato
  check (item_id ~ '^[a-z0-9_]{1,40}$');

alter table bazar drop constraint if exists bazar_vendedor_nome_seguro;
alter table bazar add  constraint bazar_vendedor_nome_seguro
  check (char_length(vendedor_nome) <= 30 and vendedor_nome !~ '[<>]');

alter table bazar drop constraint if exists bazar_item_nome_seguro;
alter table bazar add  constraint bazar_item_nome_seguro
  check (char_length(item_nome) <= 60 and item_nome !~ '[<>]');

alter table bazar drop constraint if exists bazar_item_icone_seguro;
alter table bazar add  constraint bazar_item_icone_seguro
  check (char_length(item_icone) <= 16 and item_icone !~ '[<>]');


-- ── Créditos de vendas a resgatar ────────────────────────────
-- Fora de saves.data para que o upsert do save não apague créditos recebidos
-- enquanto o vendedor está jogando. Clientes só leem; escrita apenas via funções.
create table if not exists creditos_bazar (
  user_id       uuid references auth.users(id) on delete cascade primary key,
  pilhas        int  not null default 0 check (pilhas >= 0),
  atualizado_em timestamptz default now()
);

alter table creditos_bazar enable row level security;

drop policy if exists "Leitura própria dos créditos" on creditos_bazar;
create policy "Leitura própria dos créditos" on creditos_bazar
  for select to authenticated using (auth.uid() = user_id);


-- ── Função atômica de compra ──────────────────────────────────
-- Garante que compra e crédito ao vendedor sejam uma única operação.
-- O comprador é sempre auth.uid(). p_buyer_id é mantido só por compatibilidade
-- de assinatura com clientes antigos e é IGNORADO.
create or replace function comprar_do_bazar(
  p_listing_id  uuid,
  p_buyer_id    uuid,
  p_preco       int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item  bazar%rowtype;
  v_buyer uuid := auth.uid();
begin
  if v_buyer is null then
    return jsonb_build_object('ok', false, 'erro', 'Faça login para comprar.');
  end if;

  -- Bloquear e buscar o anúncio
  select * into v_item from bazar where id = p_listing_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'erro', 'Anúncio não encontrado ou já vendido.');
  end if;

  if v_item.vendedor_id = v_buyer then
    return jsonb_build_object('ok', false, 'erro', 'Você não pode comprar seu próprio anúncio.');
  end if;

  if v_item.preco != p_preco then
    return jsonb_build_object('ok', false, 'erro', 'Preço inválido.');
  end if;

  -- Remover anúncio
  delete from bazar where id = p_listing_id;

  -- Creditar pilhas ao vendedor (tabela separada: o autosave do cliente não sobrescreve)
  insert into creditos_bazar (user_id, pilhas)
    values (v_item.vendedor_id, v_item.preco)
  on conflict (user_id) do update
    set pilhas        = creditos_bazar.pilhas + excluded.pilhas,
        atualizado_em = now();

  return jsonb_build_object(
    'ok',         true,
    'item_id',    v_item.item_id,
    'item_nome',  v_item.item_nome,
    'item_icone', v_item.item_icone,
    'qtd',        v_item.qtd
  );
end;
$$;

revoke all on function comprar_do_bazar(uuid, uuid, int) from public, anon;
grant execute on function comprar_do_bazar(uuid, uuid, int) to authenticated;


-- ── Resgate atômico de créditos ──────────────────────────────
-- Apaga e devolve o saldo numa única operação: dois resgates simultâneos
-- nunca recebem o mesmo crédito. Retorna 0 se não houver nada.
create or replace function resgatar_creditos_bazar()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilhas int;
begin
  delete from creditos_bazar
   where user_id = auth.uid()
  returning pilhas into v_pilhas;
  return coalesce(v_pilhas, 0);
end;
$$;

revoke all on function resgatar_creditos_bazar() from public, anon;
grant execute on function resgatar_creditos_bazar() to authenticated;


-- ── Migração: pilhas_pendentes (formato antigo) → creditos_bazar ──
-- Seguro rodar mais de uma vez.
insert into creditos_bazar (user_id, pilhas)
  select user_id, (data->>'pilhas_pendentes')::int
    from saves
   where coalesce((data->>'pilhas_pendentes')::int, 0) > 0
on conflict (user_id) do update
  set pilhas = creditos_bazar.pilhas + excluded.pilhas;

update saves set data = data - 'pilhas_pendentes'
 where data ? 'pilhas_pendentes';


commit;
