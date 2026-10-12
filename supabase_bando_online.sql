-- ============================================================
-- ATÉ AMANHÃ — Bando online (Etapa 2): perfis públicos, ataques e ranking
-- Colar inteiro no SQL Editor do Supabase e clicar em Run.
-- Tudo roda numa transação: se der erro, nada é aplicado.
-- O motor de combate abaixo espelha combate.js (testado por tests/servidor/paridade-sql.js).
-- ============================================================

begin;

-- ── Motor de combate (espelho exato de combate.js) ──────────────
-- Toda a aritmética de 32 bits do RNG é feita em bigint com máscara.

-- Multiplicação de 32 bits igual a Math.imul (sem estourar o bigint)
create or replace function _imul32(a bigint, b bigint)
returns bigint language sql immutable as $$
  select ((a & 65535) * (b & 65535)
          + ((((a >> 16) * (b & 65535) + (a & 65535) * (b >> 16)) & 65535) << 16)
         ) & 4294967295;
$$;

-- mulberry32: avança o estado (a) e devolve o novo estado
create or replace function _rng_avancar(a bigint)
returns bigint language sql immutable as $$
  select (a + 1831565813) & 4294967295;  -- 0x6D2B79F5
$$;

-- mulberry32: valor em [0, 1) para um estado já avançado
create or replace function _rng_valor(a bigint)
returns double precision language plpgsql immutable as $$
declare
  t bigint := a;
begin
  t := _imul32(t # (t >> 15), t | 1);
  t := t # ((t + _imul32(t # (t >> 7), t | 61)) & 4294967295);
  return ((t # (t >> 14)) & 4294967295)::double precision / 4294967296::double precision;
end;
$$;

-- Simulação completa. Devolve o mesmo formato de simularCombate (combate.js)
-- e, a mais, 'estado_rng' para continuar a sequência (sorteio do saque).
create or replace function _simular_combate(time_a jsonb, time_b jsonb, semente bigint)
returns jsonb language plpgsql immutable as $$
declare
  ids    text[] := '{}';
  nomes  text[] := '{}';
  atq    int[]  := '{}';
  def    int[]  := '{}';
  vida   int[]  := '{}';
  lado   text[] := '{}';
  n_a    int := coalesce(jsonb_array_length(time_a), 0);
  n_b    int := coalesce(jsonb_array_length(time_b), 0);
  n      int;
  ini_a  bigint := 0;
  ini_b  bigint := 0;
  est    bigint := semente & 4294967295;
  r      double precision;
  rel    text[] := '{}';
  rodadas int := 0;
  vencedor text := null;
  motivo text := null;
  i int; k int;
  va int[]; vb int[]; ordem int[]; inimigos int[];
  atac int; alvo int; dano int; mult int; base double precision;
  fa double precision; fb double precision;
  soma_a bigint; soma_b bigint;
  vivos_a int; vivos_b int;
  l jsonb;
  lutadores jsonb := '[]';
begin
  if est = 0 then est := 1; end if;

  for i in 0 .. n_a - 1 loop
    l := time_a -> i;
    ids := ids || (l ->> 'id'); nomes := nomes || (l ->> 'nome');
    atq := atq || (l ->> 'atq')::int; def := def || (l ->> 'def')::int;
    vida := vida || greatest(0, (l ->> 'vida')::int); lado := lado || 'A'::text;
  end loop;
  for i in 0 .. n_b - 1 loop
    l := time_b -> i;
    ids := ids || (l ->> 'id'); nomes := nomes || (l ->> 'nome');
    atq := atq || (l ->> 'atq')::int; def := def || (l ->> 'def')::int;
    vida := vida || greatest(0, (l ->> 'vida')::int); lado := lado || 'B'::text;
  end loop;
  n := n_a + n_b;
  for i in 1 .. n loop
    if lado[i] = 'A' then ini_a := ini_a + vida[i]; else ini_b := ini_b + vida[i]; end if;
  end loop;

  loop
    -- checar fim (também antes da 1ª rodada: time vazio decide na hora)
    soma_a := 0; soma_b := 0; vivos_a := 0; vivos_b := 0;
    for i in 1 .. n loop
      if lado[i] = 'A' then soma_a := soma_a + vida[i]; if vida[i] > 0 then vivos_a := vivos_a + 1; end if;
      else soma_b := soma_b + vida[i]; if vida[i] > 0 then vivos_b := vivos_b + 1; end if; end if;
    end loop;
    if vivos_a = 0 then vencedor := 'B'; motivo := 'derrota'; exit; end if;
    if vivos_b = 0 then vencedor := 'A'; motivo := 'derrota'; exit; end if;
    fa := case when ini_a > 0 then soma_a::double precision / ini_a::double precision else 0 end;
    fb := case when ini_b > 0 then soma_b::double precision / ini_b::double precision else 0 end;
    if fa < 0.25::double precision or fb < 0.25::double precision then
      vencedor := case when fa > fb then 'A' else 'B' end; motivo := 'recuo'; exit;
    end if;
    if rodadas >= 5 then
      vencedor := case when fa > fb then 'A' else 'B' end; motivo := 'tempo'; exit;
    end if;

    rodadas := rodadas + 1;
    rel := rel || ('— Rodada ' || rodadas || ' —');
    va := '{}'; vb := '{}'; ordem := '{}';
    for i in 1 .. n loop
      if vida[i] > 0 then
        if lado[i] = 'A' then va := va || i; else vb := vb || i; end if;
      end if;
    end loop;
    for k in 1 .. greatest(coalesce(array_length(va, 1), 0), coalesce(array_length(vb, 1), 0)) loop
      if k <= coalesce(array_length(va, 1), 0) then ordem := ordem || va[k]; end if;
      if k <= coalesce(array_length(vb, 1), 0) then ordem := ordem || vb[k]; end if;
    end loop;

    foreach atac in array ordem loop
      continue when vida[atac] <= 0;
      inimigos := '{}';
      for i in 1 .. n loop
        if vida[i] > 0 and lado[i] <> lado[atac] then inimigos := inimigos || i; end if;
      end loop;
      exit when coalesce(array_length(inimigos, 1), 0) = 0;
      est := _rng_avancar(est); r := _rng_valor(est);
      alvo := inimigos[floor(r * array_length(inimigos, 1))::int + 1];
      -- golpe: erro (20%), crítico (12%, ×2) ou normal
      est := _rng_avancar(est); r := _rng_valor(est);
      if r < 0.2::double precision then
        dano := 0;
        rel := rel || (nomes[atac] || ' erra ' || nomes[alvo] || '.');
      else
        mult := case when r > (1::double precision - 0.12::double precision) then 2 else 1 end;
        est := _rng_avancar(est); r := _rng_valor(est);
        base := atq[atac]::double precision * (0.6::double precision + 0.8::double precision * r)
                - def[alvo]::double precision * 0.5::double precision;
        dano := greatest(1, floor(base * mult + 0.5::double precision)::int);  -- Math.round
        vida[alvo] := greatest(0, vida[alvo] - dano);
        rel := rel || (nomes[atac] || ' acerta ' || nomes[alvo]
               || case when mult = 2 then ' (crítico!)' else '' end
               || ': ' || dano || ' de dano'
               || case when vida[alvo] = 0 then ' — caiu!' else '.' end);
      end if;
    end loop;
  end loop;

  for i in 1 .. n loop
    lutadores := lutadores || jsonb_build_object('id', ids[i], 'lado', lado[i], 'vida', vida[i]);
  end loop;
  return jsonb_build_object('vencedor', vencedor, 'motivo', motivo, 'rodadas', rodadas,
    'lutadores', lutadores, 'relatorio', to_jsonb(rel), 'estado_rng', est);
end;
$$;


-- ── Tabelas ──────────────────────────────────────────────────

create table if not exists assentamentos_publicos (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  nome        text not null default 'Assentamento' check (char_length(nome) between 1 and 24 and nome !~ '[<>]'),
  nivel       int  not null default 1 check (nivel between 1 and 8),
  xp          int  not null default 0 check (xp >= 0),
  pontos      int  not null default 0 check (pontos >= 0),
  vitorias    int  not null default 0,
  derrotas    int  not null default 0,
  visto_em    timestamptz not null default now(),
  defensores  jsonb not null default '[]',
  moradores   int  not null default 0,
  bonus_def   int  not null default 0,
  baterias    int  not null default 0,
  deposito    jsonb not null default '[]',
  escudo_ate  timestamptz,
  ataques_dia date,
  ataques_qtd int  not null default 0,
  alvos_dia   uuid[] not null default '{}'
);

alter table assentamentos_publicos enable row level security;
drop policy if exists "Logados leem os assentamentos" on assentamentos_publicos;
create policy "Logados leem os assentamentos" on assentamentos_publicos
  for select to authenticated using (true);
-- Sem insert/update/delete para clientes: só pelas funções abaixo.

create table if not exists ataques (
  id                uuid primary key default gen_random_uuid(),
  atacante          uuid not null references auth.users(id) on delete cascade,
  defensor          uuid not null references auth.users(id) on delete cascade,
  atacante_nome     text not null,
  defensor_nome     text not null,
  time_atacante     jsonb not null,
  semente           bigint not null,
  criado_em         timestamptz not null default now(),
  chegada           timestamptz not null,
  estado            text not null default 'a_caminho' check (estado in ('a_caminho', 'resolvido')),
  resultado         jsonb,
  aplicado_atacante boolean not null default false,
  aplicado_defensor boolean not null default false
);

create index if not exists ataques_defensor_idx on ataques (defensor, estado);
create index if not exists ataques_atacante_idx on ataques (atacante, estado);

alter table ataques enable row level security;
drop policy if exists "Envolvidos leem o ataque" on ataques;
create policy "Envolvidos leem o ataque" on ataques
  for select to authenticated using (auth.uid() = atacante or auth.uid() = defensor);


-- ── Regras (espelho de bando-regras.js) ──────────────────────

create or replace function _nivel_por_xp(xp int)
returns int language sql immutable as $$
  select 1 + (select count(*)::int from unnest(array[100, 250, 450, 700, 1000, 1350, 1750]) as t(limite) where xp >= limite);
$$;

-- Valida um lutador vindo do cliente (limites de um Elite com o melhor equipamento)
create or replace function _lutador_valido(l jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(l) = 'object'
     and coalesce(char_length(l ->> 'id'), 0) between 1 and 40
     and coalesce(char_length(l ->> 'nome'), 0) between 1 and 24
     and (l ->> 'nome') !~ '[<>]'
     and (l ->> 'atq') ~ '^\d+$' and (l ->> 'atq')::int <= 17
     and (l ->> 'def') ~ '^\d+$' and (l ->> 'def')::int <= 18
     and (l ->> 'vida') ~ '^\d+$' and (l ->> 'vida')::int between 1 and 70;
$$;

create or replace function _time_valido(t jsonb, maximo int)
returns boolean language sql immutable as $$
  select jsonb_typeof(t) = 'array'
     and jsonb_array_length(t) between 1 and maximo
     and not exists (select 1 from jsonb_array_elements(t) e where not _lutador_valido(e));
$$;

-- Dia de jogo para os limites diários (horário de Brasília)
create or replace function _hoje()
returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;


-- ── publicar_perfil ──────────────────────────────────────────
-- O jogo chama junto com cada salvamento na nuvem. Só grava os campos do próprio jogador;
-- pontos, escudo e controle de ataques são do servidor. Enquanto houver ataque sofrido ainda
-- não aplicado no save, Baterias e depósito do perfil não são sobrescritos (já descontam o saque).
create or replace function publicar_perfil(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_xp    int;
  v_nivel int;
  v_bloq  boolean;
begin
  if v_uid is null then raise exception 'Faça login para jogar online.'; end if;

  v_xp := (p ->> 'xp')::int;
  v_nivel := (p ->> 'nivel')::int;
  if coalesce(char_length(p ->> 'nome'), 0) not between 1 and 24 or (p ->> 'nome') ~ '[<>]' then raise exception 'Perfil inválido: nome.'; end if;
  if v_xp is null or v_xp < 0 or v_nivel is distinct from _nivel_por_xp(v_xp) then raise exception 'Perfil inválido: nível.'; end if;
  if jsonb_typeof(p -> 'defensores') <> 'array' or jsonb_array_length(p -> 'defensores') > 8
     or exists (select 1 from jsonb_array_elements(p -> 'defensores') e where not _lutador_valido(e)) then
    raise exception 'Perfil inválido: defensores.';
  end if;
  if (p ->> 'moradores')::int not between 0 and 8 then raise exception 'Perfil inválido: moradores.'; end if;
  if (p ->> 'bonus_def')::int not between 0 and 20 then raise exception 'Perfil inválido: bônus de defesa.'; end if;
  if (p ->> 'baterias')::int not between 0 and 100000 then raise exception 'Perfil inválido: Baterias.'; end if;
  if jsonb_typeof(p -> 'deposito') <> 'array' or jsonb_array_length(p -> 'deposito') > 20
     or exists (select 1 from jsonb_array_elements(p -> 'deposito') e
                where coalesce(e ->> 'id', '') !~ '^[a-z0-9_]{1,40}$'
                   or coalesce(e ->> 'qtd', '') !~ '^\d+$' or (e ->> 'qtd')::int not between 1 and 999) then
    raise exception 'Perfil inválido: depósito.';
  end if;

  select exists (select 1 from ataques where defensor = v_uid and estado = 'resolvido' and not aplicado_defensor)
    into v_bloq;

  insert into assentamentos_publicos (user_id, nome, nivel, xp, visto_em, defensores, moradores, bonus_def, baterias, deposito)
  values (v_uid, p ->> 'nome', v_nivel, v_xp, now(), p -> 'defensores', (p ->> 'moradores')::int,
          (p ->> 'bonus_def')::int, (p ->> 'baterias')::int, p -> 'deposito')
  on conflict (user_id) do update set
    nome       = excluded.nome,
    nivel      = excluded.nivel,
    xp         = excluded.xp,
    visto_em   = now(),
    defensores = excluded.defensores,
    moradores  = excluded.moradores,
    bonus_def  = excluded.bonus_def,
    baterias   = case when v_bloq then assentamentos_publicos.baterias else excluded.baterias end,
    deposito   = case when v_bloq then assentamentos_publicos.deposito else excluded.deposito end;
end;
$$;


-- ── iniciar_ataque ───────────────────────────────────────────
create or replace function iniciar_ataque(p_alvo uuid, p_time jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_atk  assentamentos_publicos%rowtype;
  v_def  assentamentos_publicos%rowtype;
  v_hoje date := _hoje();
  v_qtd  int;
  v_alvos uuid[];
  v_id   uuid;
  v_chegada timestamptz := now() + interval '5 minutes';
begin
  if v_uid is null then raise exception 'Faça login para jogar online.'; end if;
  select * into v_atk from assentamentos_publicos where user_id = v_uid for update;
  if not found then raise exception 'Seu assentamento ainda não foi publicado. Tente de novo em instantes.'; end if;
  if p_alvo = v_uid then raise exception 'Você não pode atacar o próprio assentamento.'; end if;
  select * into v_def from assentamentos_publicos where user_id = p_alvo;
  if not found then raise exception 'Assentamento não encontrado.'; end if;

  if abs(v_atk.nivel - v_def.nivel) > 2 then raise exception 'Fora da sua faixa de nível.'; end if;
  if v_def.escudo_ate is not null and v_def.escudo_ate > now() then
    raise exception 'Este assentamento está protegido até %.', to_char(v_def.escudo_ate at time zone 'America/Sao_Paulo', 'HH24:MI');
  end if;

  if v_atk.ataques_dia is distinct from v_hoje then v_qtd := 0; v_alvos := '{}';
  else v_qtd := v_atk.ataques_qtd; v_alvos := v_atk.alvos_dia; end if;
  if v_qtd >= 3 then raise exception 'Limite de 3 ataques por dia atingido.'; end if;
  if p_alvo = any(v_alvos) then raise exception 'Você já atacou este assentamento hoje.'; end if;

  if not _time_valido(p_time, least(8, 1 + v_atk.nivel)) then raise exception 'Grupo de ataque inválido.'; end if;

  insert into ataques (atacante, defensor, atacante_nome, defensor_nome, time_atacante, semente, chegada)
  values (v_uid, p_alvo, v_atk.nome, v_def.nome, p_time, floor(random() * 2147483646)::bigint + 1, v_chegada)
  returning id into v_id;

  update assentamentos_publicos
     set ataques_dia = v_hoje, ataques_qtd = v_qtd + 1, alvos_dia = v_alvos || p_alvo
   where user_id = v_uid;

  return jsonb_build_object('id', v_id, 'chegada', v_chegada, 'defensor_nome', v_def.nome);
end;
$$;


-- ── resolver_ataque ──────────────────────────────────────────
-- Atacante ou defensor chamam depois da chegada; se já resolvido, só devolve o resultado.
create or replace function resolver_ataque(p_ataque uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_atq   ataques%rowtype;
  v_def   assentamentos_publicos%rowtype;
  v_time_b jsonb := '[]';
  v_milicia boolean := false;
  v_res   jsonb;
  v_est   bigint;
  v_r     double precision;
  v_sq_bat int := 0;
  v_sq_itens jsonb := '[]';
  v_dep   jsonb;
  v_idx   int;
  v_item  jsonb;
  v_leva  int;
  i int;
begin
  if v_uid is null then raise exception 'Faça login para jogar online.'; end if;
  select * into v_atq from ataques where id = p_ataque for update;
  if not found then raise exception 'Ataque não encontrado.'; end if;
  if v_uid <> v_atq.atacante and v_uid <> v_atq.defensor then raise exception 'Ataque não encontrado.'; end if;
  if v_atq.estado = 'resolvido' then return to_jsonb(v_atq); end if;
  if now() < v_atq.chegada then raise exception 'O ataque ainda não chegou.'; end if;

  select * into v_def from assentamentos_publicos where user_id = v_atq.defensor for update;

  -- Time defensor: Bando pronto (+ bônus de defesa) ou, sem Bando, a milícia de moradores
  if jsonb_array_length(v_def.defensores) > 0 then
    select jsonb_agg(e || jsonb_build_object('def', (e ->> 'def')::int + v_def.bonus_def))
      into v_time_b from jsonb_array_elements(v_def.defensores) e;
  else
    v_milicia := true;
    for i in 1 .. greatest(1, v_def.moradores) loop
      v_time_b := v_time_b || jsonb_build_object('id', 'milicia-' || i, 'nome', 'Miliciano ' || i,
                                                 'atq', 2, 'def', 1 + v_def.bonus_def, 'vida', 25);
    end loop;
  end if;

  v_res := _simular_combate(v_atq.time_atacante, v_time_b, v_atq.semente);
  v_est := (v_res ->> 'estado_rng')::bigint;

  if v_res ->> 'vencedor' = 'A' then
    -- Saque: 15% das Baterias (máx. 200) e até 3 tipos do depósito, 25% de cada
    v_sq_bat := least(200, floor(v_def.baterias * 0.15)::int);
    v_dep := v_def.deposito;
    for i in 1 .. 3 loop
      exit when jsonb_array_length(v_dep) = 0;
      v_est := _rng_avancar(v_est); v_r := _rng_valor(v_est);
      v_idx := floor(v_r * jsonb_array_length(v_dep))::int;
      v_item := v_dep -> v_idx;
      v_leva := least((v_item ->> 'qtd')::int, greatest(1, floor((v_item ->> 'qtd')::int * 0.25)::int));
      v_sq_itens := v_sq_itens || jsonb_build_object('id', v_item ->> 'id', 'qtd', v_leva);
      v_dep := v_dep - v_idx;
    end loop;

    -- O perfil do defensor já desconta o saque (outro ataque não leva o mesmo valor)
    update assentamentos_publicos set
      baterias = baterias - v_sq_bat,
      deposito = coalesce((
        select jsonb_agg(case when s.qtd is null then d.e
                              else jsonb_build_object('id', d.e ->> 'id', 'qtd', (d.e ->> 'qtd')::int - s.qtd) end)
          from jsonb_array_elements(v_def.deposito) as d(e)
          left join (select x ->> 'id' as id, (x ->> 'qtd')::int as qtd from jsonb_array_elements(v_sq_itens) x) s
            on s.id = d.e ->> 'id'
         where s.qtd is null or (d.e ->> 'qtd')::int - s.qtd > 0), '[]'::jsonb),
      derrotas = derrotas + 1,
      escudo_ate = now() + interval '6 hours'
    where user_id = v_atq.defensor;
    update assentamentos_publicos set pontos = pontos + 10, vitorias = vitorias + 1 where user_id = v_atq.atacante;
  else
    update assentamentos_publicos set pontos = pontos + 5, vitorias = vitorias + 1,
           escudo_ate = now() + interval '6 hours' where user_id = v_atq.defensor;
    update assentamentos_publicos set pontos = greatest(0, pontos - 3), derrotas = derrotas + 1 where user_id = v_atq.atacante;
  end if;

  update ataques set
    estado = 'resolvido',
    resultado = (v_res - 'estado_rng') || jsonb_build_object(
      'saque', jsonb_build_object('baterias', v_sq_bat, 'itens', v_sq_itens),
      'milicia', v_milicia,
      'time_defensor', v_time_b)
  where id = p_ataque
  returning * into v_atq;

  return to_jsonb(v_atq);
end;
$$;


-- ── marcar_ataque_aplicado ───────────────────────────────────
create or replace function marcar_ataque_aplicado(p_ataque uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Faça login para jogar online.'; end if;
  update ataques set aplicado_atacante = true where id = p_ataque and atacante = v_uid and estado = 'resolvido';
  update ataques set aplicado_defensor = true where id = p_ataque and defensor = v_uid and estado = 'resolvido';
end;
$$;


-- ── Teste de paridade (só cálculo, sem acesso a dados) ───────
create or replace function simular_combate_publico(time_a jsonb, time_b jsonb, semente bigint)
returns jsonb language sql immutable as $$
  select _simular_combate(time_a, time_b, semente) - 'estado_rng';
$$;


-- ── Permissões ───────────────────────────────────────────────
revoke all on function publicar_perfil(jsonb) from public, anon;
revoke all on function iniciar_ataque(uuid, jsonb) from public, anon;
revoke all on function resolver_ataque(uuid) from public, anon;
revoke all on function marcar_ataque_aplicado(uuid) from public, anon;
grant execute on function publicar_perfil(jsonb) to authenticated;
grant execute on function iniciar_ataque(uuid, jsonb) to authenticated;
grant execute on function resolver_ataque(uuid) to authenticated;
grant execute on function marcar_ataque_aplicado(uuid) to authenticated;
grant execute on function simular_combate_publico(jsonb, jsonb, bigint) to anon, authenticated;

commit;
