-- ============================================================
-- ATÉ AMANHÃ — Schema Supabase
-- Execute no SQL Editor do seu projeto Supabase
-- ============================================================

-- ── Saves dos jogadores ──────────────────────────────────────
create table if not exists saves (
  user_id    uuid references auth.users(id) on delete cascade primary key,
  data       jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table saves enable row level security;

create policy "Leitura própria" on saves
  for select using (auth.uid() = user_id);

create policy "Inserção própria" on saves
  for insert with check (auth.uid() = user_id);

create policy "Atualização própria" on saves
  for update using (auth.uid() = user_id);


-- ── Bazar global entre jogadores ─────────────────────────────
create table if not exists bazar (
  id            uuid default gen_random_uuid() primary key,
  vendedor_id   uuid references auth.users(id) on delete cascade not null,
  vendedor_nome text not null default 'Anônimo',
  item_id       text not null,
  item_nome     text not null,
  item_icone    text not null default '📦',
  qtd           int  not null default 1 check (qtd > 0),
  preco         int  not null check (preco > 0),
  criado_em     timestamptz default now()
);

alter table bazar enable row level security;

create policy "Qualquer autenticado pode ler o bazar" on bazar
  for select to authenticated using (true);

create policy "Vendedor insere próprio anúncio" on bazar
  for insert to authenticated with check (auth.uid() = vendedor_id);

create policy "Vendedor remove próprio anúncio" on bazar
  for delete to authenticated using (auth.uid() = vendedor_id);


-- ── Função atômica de compra ──────────────────────────────────
-- Garante que compra e crédito ao vendedor sejam uma única operação.
create or replace function comprar_do_bazar(
  p_listing_id  uuid,
  p_buyer_id    uuid,
  p_preco       int
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_item bazar%rowtype;
begin
  -- Bloquear e buscar o anúncio
  select * into v_item from bazar where id = p_listing_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'erro', 'Anúncio não encontrado ou já vendido.');
  end if;

  if v_item.vendedor_id = p_buyer_id then
    return jsonb_build_object('ok', false, 'erro', 'Você não pode comprar seu próprio anúncio.');
  end if;

  if v_item.preco != p_preco then
    return jsonb_build_object('ok', false, 'erro', 'Preço inválido.');
  end if;

  -- Remover anúncio
  delete from bazar where id = p_listing_id;

  -- Creditar pilhas ao vendedor no próximo login
  insert into saves (user_id, data)
    values (v_item.vendedor_id, jsonb_build_object('pilhas_pendentes', v_item.preco))
  on conflict (user_id) do update
    set data = jsonb_set(
      saves.data,
      '{pilhas_pendentes}',
      to_jsonb(coalesce((saves.data->>'pilhas_pendentes')::int, 0) + v_item.preco)
    ),
    updated_at = now();

  return jsonb_build_object(
    'ok',         true,
    'item_id',    v_item.item_id,
    'item_nome',  v_item.item_nome,
    'item_icone', v_item.item_icone,
    'qtd',        v_item.qtd
  );
end;
$$;
