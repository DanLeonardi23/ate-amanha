# Bando online — Plano de implementação (Etapa 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assentamentos online: perfil público, lista de alvos, ataques entre jogadores decididos no servidor, aplicação dos resultados no save e ranking por pontos de guerra.

**Architecture:** O servidor (Supabase/PostgreSQL) guarda perfis e ataques e decide cada combate com um motor em PL/pgSQL idêntico ao `combate.js` (paridade testada). O jogo ganha `online.js` (publicar perfil, sub-aba 🌐 Ataques, enviar ataques, aplicar resultados) e regras puras novas em `bando-regras.js`; `script.js` só recebe ganchos. Desenho: `docs/superpowers/specs/2026-10-11-bando-online-design.md`.

**Tech Stack:** HTML/CSS/JS puro; Supabase (PostgreSQL 15+, RLS, funções `security definer`); testes `node --test`; PGlite (PostgreSQL em WASM) para testar o SQL localmente.

---

## Antes de começar

- O working tree usa CRLF (`core.autocrlf=true`). Crie arquivos com a ferramenta de escrita e altere com a ferramenta de edição. **Não** use `sed`/`awk` com barras invertidas (já gerou caracteres invisíveis neste projeto). Depois de editar, `grep -c $'\x08' <arquivo>` deve dar `0`.
- Testes do jogo: `node --test tests/` (os scripts em `tests/servidor/` e `tests/paridade-servidor.js` não entram nessa contagem; são rodados à mão).
- **Decisão de interface (esclarece o desenho):** só participa do online quem tem conta **e é Líder** (tem acesso ao Assentamento). O perfil é publicado só nessa condição.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase_bando_online.sql` (novo) | Tabelas, RLS, motor de combate em SQL e funções do PvP |
| `tests/servidor/package.json`, `banco-teste.js`, `paridade-sql.js`, `cenarios-sql.js` (novos) | Testes locais do SQL com PGlite |
| `tests/paridade-servidor.js` (novo) | Paridade contra o Supabase de produção |
| `bando-regras.js` | Regras puras do online (limites, constantes, milícia, bloqueios) |
| `bando.js` | `normalizarBando` conhece ataques em andamento |
| `online.js` (novo) | Perfil público, sub-aba Ataques, envio e aplicação de ataques |
| `tests/online-regras.test.js`, `tests/online.test.js` (novos) | Testes do lado do jogo |
| `script.js`, `index.html`, `style.css`, `manual.html` | Ganchos, sub-aba, estilos, manual |
| `.gitignore` | Ignorar `tests/servidor/node_modules/` |

---

### Task 1: SQL do servidor com testes locais (PGlite)

**Files:**
- Create: `tests/servidor/package.json`, `tests/servidor/banco-teste.js`, `tests/servidor/paridade-sql.js`, `tests/servidor/cenarios-sql.js`
- Create: `supabase_bando_online.sql`
- Modify: `.gitignore`

- [ ] **Step 1: Arquivos de teste do servidor**

`tests/servidor/package.json`:

```json
{
  "name": "ateamanha-testes-servidor",
  "private": true,
  "description": "Testes do SQL do Bando online num PostgreSQL local (PGlite). Não faz parte do jogo.",
  "dependencies": {
    "@electric-sql/pglite": "0.2.17"
  }
}
```

`tests/servidor/banco-teste.js`:

```js
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
```

`tests/servidor/paridade-sql.js`:

```js
// Paridade do motor de combate: SQL (supabase_bando_online.sql) × combate.js, num PostgreSQL local (PGlite).
// Uso (uma vez): cd tests/servidor && npm install
// Depois:        node tests/servidor/paridade-sql.js
const fs = require('fs');
const path = require('path');
const util = require('util');
const { PGlite } = require('@electric-sql/pglite');
const raiz = path.join(__dirname, '..', '..');
const { simularCombate, criarRng } = require(path.join(raiz, 'combate.js'));
const { prepararBanco } = require('./banco-teste.js');

(async () => {
  const db = await prepararBanco(PGlite, fs.readFileSync(path.join(raiz, 'supabase_bando_online.sql'), 'utf8'));
  const gen = criarRng(2024);
  const int = (a, b) => a + Math.floor(gen() * (b - a + 1));
  const time = (p, n) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, nome: `${p}-${i}`, atq: int(0, 20), def: int(0, 20), vida: int(0, 90) }));
  let iguais = 0;
  const total = 600;
  for (let caso = 0; caso < total; caso++) {
    const A = time('A', int(0, 6)), B = time('B', int(0, 6));
    const semente = int(0, 2 ** 32 - 1);
    const js = simularCombate(A, B, semente);
    const { rows } = await db.query('select simular_combate_publico($1, $2, $3) as r', [JSON.stringify(A), JSON.stringify(B), semente]);
    if (util.isDeepStrictEqual(js, rows[0].r)) iguais++;
    else console.log('DIFERENTE: caso', caso, 'semente', semente);
  }
  console.log(`paridade: ${iguais}/${total} idênticos`);
  process.exit(iguais === total ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
```

`tests/servidor/cenarios-sql.js`:

```js
// Cenários das funções do PvP (supabase_bando_online.sql) num PostgreSQL local (PGlite).
// Uso (uma vez): cd tests/servidor && npm install
// Depois:        node tests/servidor/cenarios-sql.js
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { prepararBanco } = require('./banco-teste.js');

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';

(async () => {
  const db = await prepararBanco(PGlite, fs.readFileSync(path.join(__dirname, '..', '..', 'supabase_bando_online.sql'), 'utf8'));
  await db.query(`insert into auth.users values ('${A}'), ('${B}'), ('${C}')`);

  const como = uid => db.query(`select set_config('teste.uid', $1, false)`, [uid]);
  const rpc = async (uid, sql, params = []) => { await como(uid); return (await db.query(sql, params)).rows[0]; };
  const erro = async (uid, sql, params, trecho) => {
    await assert.rejects(rpc(uid, sql, params), e => { assert.match(e.message, trecho); return true; });
  };
  const perfil = (nome, xp, defensores, extra = {}) => JSON.stringify({ nome, xp, nivel: 1 + [100, 250, 450, 700, 1000, 1350, 1750].filter(l => xp >= l).length, defensores, moradores: 2, bonus_def: 1, baterias: 400, deposito: [{ id: 'sucata', qtd: 8 }, { id: 'kit', qtd: 2 }], ...extra });
  const lut = (id, atq, def, vida) => ({ id, nome: id, atq, def, vida });
  const ler = async uid => (await db.query('select * from assentamentos_publicos where user_id = $1', [uid])).rows[0];
  let ok = 0;
  const caso = async (nome, fn) => { await fn(); ok++; console.log('ok -', nome); };

  await caso('publicar perfil válido e recusar valores impossíveis', async () => {
    await rpc(A, 'select publicar_perfil($1)', [perfil('Vila A', 120, [lut('a1', 12, 8, 55), lut('a2', 12, 8, 55)])]);
    await rpc(B, 'select publicar_perfil($1)', [perfil('Vila B', 0, [lut('b1', 4, 2, 40)])]);
    await rpc(C, 'select publicar_perfil($1)', [perfil('Vila C', 1750, [lut('c1', 9, 6, 70)])]);
    assert.equal((await ler(A)).nivel, 2);
    await erro(A, 'select publicar_perfil($1)', [perfil('Vila A', 120, [lut('a1', 99, 8, 55)])], /defensores/);
    await erro(A, 'select publicar_perfil($1)', [JSON.stringify({ ...JSON.parse(perfil('Vila A', 120, [])), nivel: 5 })], /nível/);
    await erro(A, 'select publicar_perfil($1)', [perfil('<b>x</b>', 120, [])], /nome/);
    await erro(null, 'select publicar_perfil($1)', [perfil('X', 0, [])], /login/);
  });

  await caso('bloqueios ao iniciar: próprio, faixa de nível, grupo inválido', async () => {
    await erro(A, 'select iniciar_ataque($1, $2)', [A, JSON.stringify([lut('a1', 12, 8, 55)])], /próprio/);
    await erro(A, 'select iniciar_ataque($1, $2)', [C, JSON.stringify([lut('a1', 12, 8, 55)])], /faixa/);
    await erro(A, 'select iniciar_ataque($1, $2)', [B, JSON.stringify([lut('a1', 12, 8, 55), lut('a2', 1, 1, 1), lut('a3', 1, 1, 1), lut('a4', 1, 1, 1)])], /inválido/); // nível 2 → máx 3
    await erro(A, 'select iniciar_ataque($1, $2)', [B, JSON.stringify([lut('a1', 18, 8, 55)])], /inválido/);
  });

  let ataque;
  await caso('iniciar ataque, mesmo alvo bloqueado no dia, resolver só após a chegada', async () => {
    ataque = (await rpc(A, 'select iniciar_ataque($1, $2) as r', [B, JSON.stringify([lut('a1', 12, 8, 55), lut('a2', 12, 8, 55)])])).r;
    assert.ok(ataque.id);
    assert.equal((await ler(A)).ataques_qtd, 1);
    await erro(A, 'select iniciar_ataque($1, $2)', [B, JSON.stringify([lut('a1', 12, 8, 55)])], /já atacou/);
    await erro(B, 'select resolver_ataque($1)', [ataque.id], /ainda não chegou/);
    await erro(C, 'select resolver_ataque($1)', [ataque.id], /não encontrado/);
  });

  await caso('resolver: vitória do mais forte, saque, pontos, escudo e idempotência', async () => {
    await db.query(`update ataques set chegada = now() - interval '1 second' where id = $1`, [ataque.id]);
    const r1 = (await rpc(B, 'select resolver_ataque($1) as r', [ataque.id])).r;
    assert.equal(r1.estado, 'resolvido');
    assert.equal(r1.resultado.vencedor, 'A');
    assert.equal(r1.resultado.saque.baterias, 60); // 15% de 400
    assert.ok(r1.resultado.saque.itens.length >= 1 && r1.resultado.saque.itens.length <= 2);
    const b = await ler(B), a = await ler(A);
    assert.equal(b.baterias, 340);
    assert.ok(b.escudo_ate > new Date());
    assert.deepEqual([a.pontos, a.vitorias, b.derrotas], [10, 1, 1]);
    const r2 = (await rpc(A, 'select resolver_ataque($1) as r', [ataque.id])).r;
    assert.deepEqual(r2.resultado, r1.resultado);
    assert.equal((await ler(A)).pontos, 10); // não pontua duas vezes
  });

  await caso('perfil do defensor não sobrescreve Baterias/depósito até aplicar o ataque', async () => {
    await rpc(B, 'select publicar_perfil($1)', [perfil('Vila B', 0, [lut('b1', 4, 2, 40)])]); // ainda diz 400
    assert.equal((await ler(B)).baterias, 340);
    await rpc(B, 'select marcar_ataque_aplicado($1)', [ataque.id]);
    await rpc(B, 'select publicar_perfil($1)', [perfil('Vila B', 0, [lut('b1', 4, 2, 40)], { baterias: 335 })]);
    assert.equal((await ler(B)).baterias, 335);
    const at = (await db.query('select aplicado_atacante, aplicado_defensor from ataques where id = $1', [ataque.id])).rows[0];
    assert.deepEqual(at, { aplicado_atacante: false, aplicado_defensor: true });
  });

  await caso('escudo bloqueia novo ataque; milícia defende quem não tem Bando', async () => {
    await db.query(`insert into auth.users values ('00000000-0000-0000-0000-00000000000d')`);
    const D = '00000000-0000-0000-0000-00000000000d';
    await erro(D, 'select iniciar_ataque($1, $2)', [B, JSON.stringify([lut('d1', 4, 2, 40)])], /publicado/);
    await rpc(D, 'select publicar_perfil($1)', [perfil('Vila D', 0, [lut('d1', 4, 2, 40)])]);
    await erro(D, 'select iniciar_ataque($1, $2)', [B, JSON.stringify([lut('d1', 4, 2, 40)])], /protegido/);
    await rpc(A, 'select publicar_perfil($1)', [perfil('Vila A', 120, [], { moradores: 3, bonus_def: 2 })]); // A sem Bando
    const at = (await rpc(D, 'select iniciar_ataque($1, $2) as r', [A, JSON.stringify([lut('d1', 4, 2, 40)])])).r;
    await db.query(`update ataques set chegada = now() - interval '1 second' where id = $1`, [at.id]);
    const r = (await rpc(D, 'select resolver_ataque($1) as r', [at.id])).r;
    assert.equal(r.resultado.milicia, true);
    assert.equal(r.resultado.time_defensor.length, 3);
    assert.deepEqual([r.resultado.time_defensor[0].atq, r.resultado.time_defensor[0].def, r.resultado.time_defensor[0].vida], [2, 3, 25]);
  });

  await caso('limite de 3 ataques por dia', async () => {
    const E = ['0e', '0f', '10', '11'].map(x => `00000000-0000-0000-0000-0000000000${x}`);
    for (const u of E) { await db.query('insert into auth.users values ($1)', [u]); await rpc(u, 'select publicar_perfil($1)', [perfil('Alvo ' + u.slice(-1), 0, [lut('x', 1, 0, 10)])]); }
    await rpc(C, 'select publicar_perfil($1)', [perfil('Vila C', 0, [lut('c1', 9, 6, 70)])]); // C agora nível 1
    for (const u of E.slice(0, 3)) await rpc(C, 'select iniciar_ataque($1, $2)', [u, JSON.stringify([lut('c1', 9, 6, 70)])]);
    await erro(C, 'select iniciar_ataque($1, $2)', [E[3], JSON.stringify([lut('c1', 9, 6, 70)])], /Limite de 3/);
  });

  await caso('paridade pública igual ao motor interno', async () => {
    const r = (await rpc(null, 'select simular_combate_publico($1, $2, 99) as r', [JSON.stringify([lut('a', 5, 2, 40)]), JSON.stringify([lut('b', 5, 1, 33)])])).r;
    assert.ok(['A', 'B'].includes(r.vencedor));
    assert.equal(r.estado_rng, undefined);
  });

  console.log(`\n${ok} cenários ok`);
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
```

- [ ] **Step 2: Ignorar as dependências dos testes**

O `.gitignore` deve conter exatamente estas duas linhas (crie o arquivo se não existir; ele pode já ter `.vercel`):

```
.vercel
tests/servidor/node_modules/
```

- [ ] **Step 3: Instalar o PGlite e ver falhar**

Run: `cd tests/servidor && npm install && cd ../.. && node tests/servidor/paridade-sql.js`
Expected: `ERRO: ENOENT ... supabase_bando_online.sql`

- [ ] **Step 4: Criar o SQL**

Criar `supabase_bando_online.sql`:

```sql
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
```

- [ ] **Step 5: Rodar os testes do servidor**

Run: `node tests/servidor/paridade-sql.js && node tests/servidor/cenarios-sql.js`
Expected: `paridade: 600/600 idênticos` e `8 cenários ok`

- [ ] **Step 6: Commit**

```bash
git add supabase_bando_online.sql tests/servidor/package.json tests/servidor/banco-teste.js tests/servidor/paridade-sql.js tests/servidor/cenarios-sql.js .gitignore
git commit -m "feat: SQL do Bando online (motor de combate e funções do PvP) com testes locais"
```

(Não commitar `tests/servidor/package-lock.json` nem `node_modules`.)

---

### Task 2: Regras puras do online

**Files:**
- Create: `tests/online-regras.test.js`
- Modify: `bando-regras.js` (antes de `  const api = {` e na lista de exportação)
- Modify: `bando.js` (`normalizarBando`)

- [ ] **Step 1: Testes**

Criar `tests/online-regras.test.js`:

```js
// Regras puras do online (bando-regras.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../bando-regras.js');

// ── Regras puras ──
test('montarMilicia: um por morador (mínimo 1) com bônus de defesa', () => {
  assert.equal(R.montarMilicia(0, 2).length, 1);
  assert.deepEqual(R.montarMilicia(3, 2).map(l => [l.atq, l.def, l.vida]), [[2, 3, 25], [2, 3, 25], [2, 3, 25]]);
});

test('poderPerfil usa defensores com bônus ou a milícia', () => {
  assert.deepEqual(R.poderPerfil({ defensores: [{ atq: 10, def: 5 }, { atq: 6, def: 4 }], bonus_def: 2 }), { atq: 16, def: 13 });
  assert.deepEqual(R.poderPerfil({ defensores: [], moradores: 2, bonus_def: 1 }), { atq: 4, def: 4 });
});

test('motivoBloqueio: prontos, faixa, escudo, limite diário e mesmo alvo', () => {
  const agora = new Date('2026-10-11T15:00:00Z');
  const hoje = R.hojeBrasilia(agora);
  const eu = { nivel: 3, ataques_dia: hoje, ataques_qtd: 1, alvos_dia: ['x'] };
  const alvo = { user_id: 'y', nivel: 4, escudo_ate: null };
  assert.equal(R.motivoBloqueio(eu, alvo, agora, true), null);
  assert.equal(R.motivoBloqueio(eu, alvo, agora, false), 'Sem combatentes prontos');
  assert.equal(R.motivoBloqueio(eu, { ...alvo, nivel: 6 }, agora, true), 'Fora da sua faixa de nível');
  assert.match(R.motivoBloqueio(eu, { ...alvo, escudo_ate: '2026-10-11T18:00:00Z' }, agora, true), /^Protegido até/);
  assert.equal(R.motivoBloqueio({ ...eu, ataques_qtd: 3 }, alvo, agora, true), 'Limite de 3 ataques hoje');
  assert.equal(R.motivoBloqueio(eu, { ...alvo, user_id: 'x' }, agora, true), 'Já atacado hoje');
  assert.equal(R.motivoBloqueio({ ...eu, ataques_dia: '2026-10-01', ataques_qtd: 3 }, alvo, agora, true), null); // outro dia zera
});

test('estaOnline: visto há menos de 5 minutos', () => {
  const agora = new Date('2026-10-11T15:00:00Z');
  assert.equal(R.estaOnline('2026-10-11T14:56:00Z', agora), true);
  assert.equal(R.estaOnline('2026-10-11T14:54:00Z', agora), false);
});
```

- [ ] **Step 2: Ver falhar**

Run: `node --test tests/online-regras.test.js`
Expected: FAIL com `R.montarMilicia is not a function`

- [ ] **Step 3: Regras em `bando-regras.js`**

Inserir imediatamente antes da linha `  const api = {`:

```js
  // ── Online (Etapa 2) ── espelho das regras do servidor (supabase_bando_online.sql);
  // aqui só servem para a interface explicar bloqueios antes de chamar o servidor.
  const LIMITES_LUTADOR = { atq: 17, def: 18, vida: 70 };
  const PVP = {
    viagemMin: 5, escudoHoras: 6, ataquesPorDia: 3, faixaNivel: 2, onlineMin: 5,
    saquePct: 0.15, saqueMaxBaterias: 200, saqueItens: 3, saqueItemPct: 0.25,
    milicia: { atq: 2, def: 1, vida: 25 },
    pontos: { vitoria: 10, defesa: 5, derrota: -3 },
    xp: { vitoria: 60, defesa: 50, derrota: 10 },
  };

  // Moradores lutam como milícia quando não há defensores (no mínimo 1 miliciano)
  function montarMilicia(moradores, bonusDef) {
    return Array.from({ length: Math.max(1, moradores) }, (_, i) => ({
      id: `milicia-${i + 1}`, nome: `Miliciano ${i + 1}`,
      atq: PVP.milicia.atq, def: PVP.milicia.def + bonusDef, vida: PVP.milicia.vida,
    }));
  }

  // Dia de jogo dos limites diários (horário de Brasília), no formato AAAA-MM-DD
  function hojeBrasilia(agora) {
    return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }

  function estaOnline(vistoEm, agora) {
    return agora - new Date(vistoEm) < PVP.onlineMin * 60000;
  }

  // ⚔️/🛡️ estimados de um perfil público (defensores com bônus, ou a milícia)
  function poderPerfil(perfil) {
    const time = perfil.defensores?.length
      ? perfil.defensores.map(l => ({ ...l, def: l.def + (perfil.bonus_def || 0) }))
      : montarMilicia(perfil.moradores || 0, perfil.bonus_def || 0);
    return time.reduce((p, l) => ({ atq: p.atq + l.atq, def: p.def + l.def }), { atq: 0, def: 0 });
  }

  // Motivo para não poder atacar (null = pode). eu/alvo: linhas de assentamentos_publicos.
  function motivoBloqueio(eu, alvo, agora, temProntos) {
    if (!temProntos) return 'Sem combatentes prontos';
    if (Math.abs(eu.nivel - alvo.nivel) > PVP.faixaNivel) return 'Fora da sua faixa de nível';
    if (alvo.escudo_ate && new Date(alvo.escudo_ate) > agora) {
      return `Protegido até ${new Date(alvo.escudo_ate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    }
    const mesmoDia = eu.ataques_dia === hojeBrasilia(agora);
    if (mesmoDia && eu.ataques_qtd >= PVP.ataquesPorDia) return `Limite de ${PVP.ataquesPorDia} ataques hoje`;
    if (mesmoDia && (eu.alvos_dia || []).includes(alvo.user_id)) return 'Já atacado hoje';
    return null;
  }
```

E na lista do `api`, logo após a linha `    gerarInimigos, gerarInvasores, curaDiaria, estadoAposCombate, sortearLoot,` adicionar:

```js
    LIMITES_LUTADOR, PVP, montarMilicia, hojeBrasilia, estaOnline, poderPerfil, motivoBloqueio,
```

- [ ] **Step 4: `normalizarBando` conhece ataques em andamento**

Em `bando.js`, trocar:

```js
  if (!Array.isArray(assent.relatorios)) assent.relatorios = [];
  // Reparo: quem ficou "em missão" sem missão correspondente (erro ao resolver) volta ao Bando
  const emCampo = new Set(assent.missoes.emAndamento.flatMap(m => m.membros || []));
```

por:

```js
  if (!Array.isArray(assent.relatorios)) assent.relatorios = [];
  if (!Array.isArray(assent.ataquesEnviados)) assent.ataquesEnviados = [];   // Etapa 2 (online.js)
  if (!Array.isArray(assent.ataquesAplicados)) assent.ataquesAplicados = [];
  // Reparo: quem ficou "em missão" sem missão nem ataque correspondente (erro ao resolver) volta ao Bando
  const emCampo = new Set([...assent.missoes.emAndamento, ...assent.ataquesEnviados].flatMap(m => m.membros || []));
```

- [ ] **Step 5: Ver passar**

Run: `node --test tests/`
Expected: `# pass 41`, `# fail 0` (37 anteriores + 4)

- [ ] **Step 6: Commit**

```bash
git add bando-regras.js bando.js tests/online-regras.test.js
git commit -m "feat: regras puras do Bando online (limites, milícia, bloqueios)"
```

---

### Task 3: Módulo online do jogo

**Files:**
- Create: `tests/online.test.js`
- Create: `online.js`

- [ ] **Step 1: Testes**

Criar `tests/online.test.js`:

```js
// Testa online.js e as regras online de bando-regras.js num contexto vm com o jogo simulado
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const R = require('../bando-regras.js');
const simples = x => JSON.parse(JSON.stringify(x)); // arrays do contexto vm → arrays comuns

function criarJogo() {
  const raiz = path.join(__dirname, '..');
  const el = () => ({ innerHTML: '', className: '', style: {}, classList: { contains: () => false }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, remove() {} });
  const chamadasRpc = [];
  const ctx = {
    console, Date, Array, Object, Set, JSON, parseInt, String, setInterval: () => 0,
    document: { getElementById: () => null, hidden: true, createElement: el, body: { appendChild() {} }, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [] },
    estado: {
      dia: 3, criado: true, ehLider: true, inventario: [], baterias: 100, personagem: { nome: 'Ana' },
      deposito: { nivel: 1, itens: [{ id: 'sucata', nome: 'Sucata', icone: '🔩', tipo: 'material', qtd: 10 }, { id: 'manual_x', nome: 'Manual', icone: '📕', tipo: 'leitura', qtd: 1 }] },
      seguranca: { armadilhasInstaladas: 1 },
      assentamento: { nome: 'Vila <Ana>', parcelas: [{ tipo: 'barraco', habitantes: [{ habilidade: 'coletor', estadoNpc: 'idle' }] }, null, null, null] },
    },
    ITENS: { sucata: { id: 'sucata', nome: 'Sucata', icone: '🔩', tipo: 'material' }, kit: { id: 'kit', nome: 'Kit', icone: '🩹', tipo: 'medicinal' } },
    SLOT_LABELS: { arma: 'Arma', cabeca: 'Cabeça', peito: 'Peito' },
    CHARS_GENERO: { 1: 'M', 2: 'H', 3: 'M', 4: 'M', 5: 'H', 6: 'H', 7: 'M', 8: 'H', 9: 'M', 10: 'H', 11: 'M', 12: 'H' },
    logs: [], adicionados: [], chamadasRpc,
    _sbUser: { id: 'eu' },
  };
  ctx.Math = Object.create(Math);
  ctx.getSB = () => ({ rpc: async (nome, args) => { chamadasRpc.push({ nome, args }); return { data: null, error: null }; } });
  ctx.charPath = id => `img/${id}.png`;
  ctx.esc = s => String(s);
  ctx.log = m => ctx.logs.push(m);
  ctx.mostrarToast = m => ctx.logs.push('toast: ' + m);
  ctx.mostrarConfirmacao = (m, sim) => sim();
  ctx.salvarJogo = () => {};
  ctx.temItem = (id, q = 1) => id === 'pilha' ? ctx.estado.baterias >= q : false;
  ctx.removerItem = (id, q = 1) => { if (id === 'pilha') ctx.estado.baterias -= q; return true; };
  ctx.adicionarItem = (base, qtd) => { ctx.adicionados.push({ id: base.id, qtd }); return true; };
  ctx.mudarBaterias = d => { ctx.estado.baterias = Math.max(0, ctx.estado.baterias + d); };
  ctx.capacidadeDeposito = () => 5;
  ctx.renderizarDeposito = () => {};
  ctx.moradores = () => [{ parcela: ctx.estado.assentamento.parcelas[0], npc: ctx.estado.assentamento.parcelas[0].habitantes[0] }];
  ctx.npcAtivo = () => true;
  ctx.habCanonica = h => h;
  ctx.renderizarAssentamento = () => {};
  ctx.atualizarBadgeAssentamento = () => {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['combate.js', 'bando-regras.js', 'bando.js', 'online.js']) vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), ctx, { filename: f });
  const run = code => vm.runInContext(code, ctx);
  run('normalizarBando(estado.assentamento, estado.personagem);');
  const a = ctx.estado.assentamento;
  a.bando.push(
    { id: 'c1', nome: 'Rafa', charId: 1, categoria: 'veterano', atqBase: 6, defBase: 4, vida: 55, vidaMax: 55, equip: { arma: 'lanca', cabeca: null, peito: null }, estado: 'pronto', diaSoldo: 9, soldoPendente: null, divida: null },
    { id: 'c2', nome: 'Bia', charId: 3, categoria: 'novato', atqBase: 4, defBase: 2, vida: 40, vidaMax: 40, equip: { arma: null, cabeca: null, peito: null }, estado: 'pronto', diaSoldo: 9, soldoPendente: null, divida: null },
  );
  return { ctx, run, a };
}

// ── online.js ──
test('montarPerfilPublico: limpa o nome, só prontos, depósito sem leituras, limites', () => {
  const { run, a } = criarJogo();
  a.bando[1].estado = 'ferido';
  const p = run('montarPerfilPublico()');
  assert.equal(p.nome, 'Vila Ana');
  assert.equal(p.defensores.length, 1);
  assert.deepEqual([p.defensores[0].atq, p.defensores[0].def, p.defensores[0].vida], [11, 4, 55]);
  assert.equal(p.moradores, 1);
  assert.equal(p.bonus_def, 1); // 1 armadilha (o morador é Coletor, não Segurança)
  assert.deepEqual(simples(p.deposito), [{ id: 'sucata', qtd: 10 }]);
});

test('publicarPerfilOnline: respeita o intervalo, a menos que forçado; não publica sem liderança', async () => {
  const { ctx, run } = criarJogo();
  await run('publicarPerfilOnline()');
  await run('publicarPerfilOnline()');
  assert.equal(ctx.chamadasRpc.filter(c => c.nome === 'publicar_perfil').length, 1);
  await run('publicarPerfilOnline(true)');
  assert.equal(ctx.chamadasRpc.filter(c => c.nome === 'publicar_perfil').length, 2);
  ctx.estado.ehLider = false;
  await run('publicarPerfilOnline(true)');
  assert.equal(ctx.chamadasRpc.filter(c => c.nome === 'publicar_perfil').length, 2);
});

const ataqueResolvido = (vencedor, extra = {}) => ({
  id: 'atq1', atacante: 'eu', defensor: 'outro', atacante_nome: 'Vila Ana', defensor_nome: 'Vila Zé', semente: 7, estado: 'resolvido',
  resultado: {
    vencedor, motivo: 'derrota', rodadas: 3, relatorio: ['— Rodada 1 —'], milicia: false,
    lutadores: [{ id: 'c1', lado: 'A', vida: 30 }, { id: 'c2', lado: 'A', vida: 0 }, { id: 'z1', lado: 'B', vida: 0 }],
    saque: { baterias: 40, itens: [{ id: 'sucata', qtd: 3 }] }, ...extra,
  },
});

test('atacante vencedor: vidas, morte sem devolver equipamento, saque, XP e não reaplica', () => {
  const { ctx, run, a } = criarJogo();
  a.bando.forEach(c => { c.estado = 'missao'; });
  a.ataquesEnviados.push({ id: 'atq1', membros: ['c1', 'c2'] });
  const xpAntes = a.xp, batAntes = ctx.estado.baterias;
  ctx.ataque = ataqueResolvido('A');
  run('aplicarResultadoAtaque(ataque, "atacante")');
  assert.deepEqual(simples(a.bando.map(c => [c.id, c.vida, c.estado])), [['c1', 30, 'pronto']]); // Bia morreu
  assert.equal(ctx.estado.baterias, batAntes + 40);
  assert.equal(ctx.estado.deposito.itens.find(i => i.id === 'sucata').qtd, 13);
  assert.equal(a.xp, xpAntes + 60);
  assert.equal(a.ataquesEnviados.length, 0);
  assert.equal(a.relatorios[0].venceu, true);
  run('aplicarResultadoAtaque(ataque, "atacante")');
  assert.equal(ctx.estado.baterias, batAntes + 40);
  assert.equal(a.relatorios.length, 1);
});

test('defensor derrotado: perde saque limitado ao que tem; milícia não sofre baixas', () => {
  const { ctx, run, a } = criarJogo();
  ctx.estado.baterias = 25;
  const xpAntes = a.xp;
  ctx.ataque = ataqueResolvido('A', { milicia: true, lutadores: [{ id: 'x', lado: 'A', vida: 10 }, { id: 'milicia-1', lado: 'B', vida: 0 }] });
  run('aplicarResultadoAtaque(ataque, "defensor")');
  assert.equal(ctx.estado.baterias, 0); // tinha só 25 dos 40
  assert.equal(ctx.estado.deposito.itens.find(i => i.id === 'sucata').qtd, 7);
  assert.equal(a.bando.length, 2);
  assert.equal(a.xp, xpAntes + 10);
  assert.match(a.relatorios[0].resumo, /milícia/);
});

test('defensor vencedor com Bando: aplica vidas do lado B e ganha XP de defesa', () => {
  const { ctx, run, a } = criarJogo();
  const xpAntes = a.xp;
  ctx.ataque = ataqueResolvido('B', { lutadores: [{ id: 'z1', lado: 'A', vida: 0 }, { id: 'c1', lado: 'B', vida: 12 }, { id: 'c2', lado: 'B', vida: 40 }] });
  run('aplicarResultadoAtaque(ataque, "defensor")');
  assert.equal(a.bando.find(c => c.id === 'c1').estado, 'ferido'); // 12 < 30% de 55
  assert.equal(a.xp, xpAntes + 50);
  assert.equal(ctx.estado.baterias, 100);
});

test('normalizarBando não "repara" quem está em ataque em andamento', () => {
  const { run, a } = criarJogo();
  a.bando[0].estado = 'missao';
  a.ataquesEnviados.push({ id: 'atq9', membros: ['c1'] });
  run('normalizarBando(estado.assentamento, estado.personagem);');
  assert.equal(a.bando[0].estado, 'missao');
});
```

- [ ] **Step 2: Ver falhar**

Run: `node --test tests/online.test.js`
Expected: FAIL com `ENOENT` ao ler `online.js`

- [ ] **Step 3: Implementar `online.js`**

Criar `online.js`:

```js
/**
 * ATÉ AMANHÃ — online.js
 * Etapa 2 do Bando: perfil público do assentamento, sub-aba 🌐 Ataques (lista de alvos,
 * ataques em andamento, ranking), envio de ataques e aplicação dos resultados no save.
 * A decisão de cada ataque é do servidor (supabase_bando_online.sql); aqui só se mostra,
 * envia e aplica. Depende de combate.js, bando-regras.js, bando.js e de script.js
 * (estado, getSB, _sbUser, esc, log, mostrarToast, salvarJogo, mudarBaterias,
 * renderizarDeposito, renderizarAssentamento, atualizarBadgeAssentamento).
 */
'use strict';

const PUBLICAR_INTERVALO_MS = 20000;  // salvarJogo roda muito; o perfil sobe no máximo a cada 20 s
const APLICADOS_MAX = 30;            // ids de ataques já aplicados guardados no save

// Estado só da sessão (não vai para o save)
const online = {
  perfis: [],          // linhas de assentamentos_publicos (sub-aba aberta)
  meuPerfil: null,
  contra: [],          // ataques a caminho contra mim
  ultimaPublicacao: 0,
  verificando: false,
  timerLista: null,
};

// Só participa do online quem tem conta e é Líder (tem acesso ao Assentamento)
function participaOnline() {
  return !!(getSB() && _sbUser && estado.criado && estado.ehLider && estado.assentamento?.bando);
}

// ════════════════════════════════════════════════════════════
// PERFIL PÚBLICO
// ════════════════════════════════════════════════════════════

function montarPerfilPublico() {
  const a = estado.assentamento;
  const bonus = Math.min(20, bonusDefesaAssentamento());
  const nome = (a.nome || '').replace(/[<>]/g, '').trim().slice(0, 24) || 'Assentamento';
  return {
    nome,
    xp: a.xp,
    nivel: a.nivel,
    defensores: combatentesProntos().slice(0, 8).map(c => {
      const s = statsLutador(c);
      return {
        id: String(c.id).slice(0, 40), nome: String(c.nome).replace(/[<>]/g, '').slice(0, 24) || 'Combatente',
        atq: Math.min(LIMITES_LUTADOR.atq, s.atq), def: Math.min(LIMITES_LUTADOR.def, s.def),
        vida: Math.max(1, Math.min(LIMITES_LUTADOR.vida, s.vida)),
      };
    }),
    moradores: Math.min(8, moradores().filter(m => npcAtivo(m.npc)).length),
    bonus_def: bonus,
    baterias: Math.max(0, Math.min(100000, estado.baterias || 0)),
    deposito: estado.deposito.itens
      .filter(i => i.tipo !== 'leitura' && i.tipo !== 'anotacao' && /^[a-z0-9_]{1,40}$/.test(i.id) && i.qtd > 0)
      .slice(0, 20)
      .map(i => ({ id: i.id, qtd: Math.min(999, i.qtd) })),
  };
}

async function publicarPerfilOnline(forcar = false) {
  if (!participaOnline()) return;
  const agora = Date.now();
  if (!forcar && agora - online.ultimaPublicacao < PUBLICAR_INTERVALO_MS) return;
  online.ultimaPublicacao = agora;
  const { error } = await getSB().rpc('publicar_perfil', { p: montarPerfilPublico() });
  if (error) console.error('[Online] Falha ao publicar o perfil:', error.message);
}

// ════════════════════════════════════════════════════════════
// ATAQUES PENDENTES (a cada 30 s e ao entrar)
// ════════════════════════════════════════════════════════════

async function verificarAtaquesOnline() {
  if (!participaOnline() || online.verificando) return;
  online.verificando = true;
  try {
    const sb = getSB(), eu = _sbUser.id;
    const { data, error } = await sb.from('ataques').select('*')
      .or('estado.eq.a_caminho,aplicado_atacante.eq.false,aplicado_defensor.eq.false');
    if (error) { console.error('[Online] Falha ao verificar ataques:', error.message); return; }
    online.contra = [];
    for (const at of data || []) {
      const papel = at.atacante === eu ? 'atacante' : 'defensor';
      let atual = at;
      if (atual.estado === 'a_caminho') {
        if (new Date(atual.chegada) > new Date()) {
          if (papel === 'defensor') online.contra.push(atual);
          continue;
        }
        const r = await sb.rpc('resolver_ataque', { p_ataque: atual.id });
        if (r.error) { console.error('[Online] Falha ao resolver ataque:', r.error.message); continue; }
        atual = r.data;
      }
      const jaAplicou = papel === 'atacante' ? atual.aplicado_atacante : atual.aplicado_defensor;
      if (atual.estado === 'resolvido' && !jaAplicou) {
        aplicarResultadoAtaque(atual, papel);
        const m = await sb.rpc('marcar_ataque_aplicado', { p_ataque: atual.id });
        if (m.error) console.error('[Online] Falha ao marcar ataque aplicado:', m.error.message);
      }
    }
    atualizarBadgeAssentamento();
    if (abaAssentamentoAberta()) renderizarOnline();
  } finally {
    online.verificando = false;
  }
}

// Aplica no save a parte deste jogador. Guarda o id para nunca aplicar duas vezes
// (mesmo que a marcação no servidor falhe e o ataque volte na próxima verificação).
function aplicarResultadoAtaque(at, papel) {
  const a = estado.assentamento;
  if (a.ataquesAplicados.includes(at.id)) return;
  const res = at.resultado;
  const souAtacante = papel === 'atacante';
  const venceu = souAtacante === (res.vencedor === 'A');
  let baixas = { mortos: [], feridos: [] };
  const partes = [];

  if (souAtacante) {
    baixas = aplicarResultadoCombate(res, 'A');
    if (venceu) {
      entregarLoot(res.saque);
      partes.push(`Saque: ${descreverLoot(res.saque)}`);
    }
    a.ataquesEnviados = a.ataquesEnviados.filter(x => x.id !== at.id);
    ganharXpAssentamento(venceu ? PVP.xp.vitoria : PVP.xp.derrota);
    partes.push(`+${venceu ? PVP.xp.vitoria : PVP.xp.derrota} XP · ${venceu ? `+${PVP.pontos.vitoria}` : PVP.pontos.derrota} pontos`);
  } else {
    if (!res.milicia) baixas = aplicarResultadoCombate(res, 'B');
    else partes.push('Sem Bando em casa: os moradores defenderam como milícia.');
    if (!venceu) {
      const perdas = perderSaque(res.saque);
      partes.push(`Levaram: ${perdas}`);
    }
    ganharXpAssentamento(venceu ? PVP.xp.defesa : PVP.xp.derrota);
    partes.push(`+${venceu ? PVP.xp.defesa : PVP.xp.derrota} XP${venceu ? ` · +${PVP.pontos.defesa} pontos` : ''}`);
  }

  const outro = souAtacante ? at.defensor_nome : at.atacante_nome;
  registrarRelatorio({
    titulo: souAtacante ? `⚔️ Ataque a ${outro}` : `🛡️ Ataque de ${outro}`,
    venceu, dia: estado.dia, resumo: partes.join(' · '), baixas, linhas: res.relatorio, semente: at.semente,
  });
  log(souAtacante
    ? `${venceu ? '🏆' : '☠️'} Seu ataque a ${outro}: ${venceu ? 'vitória' : 'derrota'}.`
    : `${venceu ? '🛡️' : '☠️'} ${outro} atacou seu assentamento: ${venceu ? 'o ataque foi repelido' : 'os invasores venceram'}.`,
  venceu ? 'log-sucesso' : 'log-perigo');
  if (baixas.mortos.length) log(`💀 Mortos: ${baixas.mortos.join(', ')}.`, 'log-perigo');

  a.ataquesAplicados.push(at.id);
  if (a.ataquesAplicados.length > APLICADOS_MAX) a.ataquesAplicados.splice(0, a.ataquesAplicados.length - APLICADOS_MAX);
  atualizarTelaAssentamento();
}

// Tira do save o que foi saqueado, limitado ao que o jogador tem agora
function perderSaque(saque) {
  const levou = [];
  const bat = Math.min(estado.baterias || 0, saque.baterias || 0);
  if (bat > 0) { mudarBaterias(-bat); levou.push(`${bat} 🔋`); }
  for (const { id, qtd } of saque.itens || []) {
    const dep = estado.deposito.itens.find(i => i.id === id);
    if (!dep) continue;
    const tira = Math.min(dep.qtd, qtd);
    dep.qtd -= tira;
    if (dep.qtd <= 0) estado.deposito.itens = estado.deposito.itens.filter(i => i.id !== id);
    levou.push(`${dep.icone || ''} ${dep.nome || id} ×${tira}`);
  }
  if (levou.length) renderizarDeposito();
  return levou.length ? levou.join(', ') : 'nada';
}

// ════════════════════════════════════════════════════════════
// ENVIAR ATAQUE
// ════════════════════════════════════════════════════════════

function abrirEnvioAtaque(alvoId) {
  const alvo = online.perfis.find(p => p.user_id === alvoId);
  const prontos = combatentesProntos();
  if (!alvo) return;
  const motivo = online.meuPerfil && motivoBloqueio(online.meuPerfil, alvo, new Date(), prontos.length > 0);
  if (motivo) { mostrarToast(motivo); return; }
  const limite = limiteBando(estado.assentamento.nivel);
  const lista = prontos.map((c, i) => {
    const s = statsLutador(c);
    return `<label class="janela-check"><input type="checkbox" value="${esc(c.id)}" ${i < limite ? 'checked' : ''}> ${esc(c.nome)} <span class="janela-dim">⚔️ ${s.atq} 🛡️ ${s.def} ❤️ ${c.vida}</span></label>`;
  }).join('');
  const poder = poderPerfil(alvo);
  const j = abrirJanela(`<h3>⚔️ Atacar ${esc(alvo.nome)}</h3>
    <p class="janela-dim">Nível ${alvo.nivel} · defesa estimada ⚔️ ${poder.atq} 🛡️ ${poder.def}. O grupo chega em ${PVP.viagemMin} min. Quem morrer em combate é perdido com o equipamento.</p>
    <div class="janela-lista">${lista}</div>
    <div class="modal-acoes"><button class="btn-primario btn-sm" data-partir>Atacar</button></div>`);
  j.querySelector('[data-partir]').onclick = async () => {
    const ids = [...j.querySelectorAll('input:checked')].map(i => i.value);
    if (!ids.length) { mostrarToast('Escolha pelo menos um combatente.'); return; }
    if (ids.length > limite) { mostrarToast(`No máximo ${limite} combatentes.`); return; }
    j.remove();
    await iniciarAtaqueOnline(alvo, ids);
  };
}

async function iniciarAtaqueOnline(alvo, ids) {
  const a = estado.assentamento;
  const validos = new Set(combatentesProntos().map(c => c.id));
  const membros = ids.filter(id => validos.has(id));
  if (!membros.length) { mostrarToast('Nenhum combatente pronto.'); return; }
  const time = membros.map(id => {
    const s = statsLutador(combatentePorId(id));
    return { id: s.id, nome: String(s.nome).replace(/[<>]/g, '').slice(0, 24), atq: s.atq, def: s.def, vida: s.vida };
  });
  await publicarPerfilOnline(true);
  const { data, error } = await getSB().rpc('iniciar_ataque', { p_alvo: alvo.user_id, p_time: time });
  if (error) { mostrarToast(`❌ ${error.message}`, 3500); return; }
  for (const c of a.bando) if (membros.includes(c.id)) c.estado = 'missao';
  a.ataquesEnviados.push({ id: data.id, membros, chegada: data.chegada, alvo: data.defensor_nome });
  log(`⚔️ ${membros.length} combatente(s) partiram para atacar ${data.defensor_nome}. Chegam em ${PVP.viagemMin} min.`, 'log-sistema');
  atualizarTelaAssentamento();
  carregarListaOnline();
}

// ════════════════════════════════════════════════════════════
// SUB-ABA 🌐 ATAQUES
// ════════════════════════════════════════════════════════════

async function carregarListaOnline() {
  if (!participaOnline()) return;
  if (!online.meuPerfil) await publicarPerfilOnline(true); // primeira vez: aparecer na lista antes de consultar
  const { data, error } = await getSB().from('assentamentos_publicos')
    .select('user_id,nome,nivel,pontos,vitorias,derrotas,visto_em,defensores,moradores,bonus_def,escudo_ate,ataques_dia,ataques_qtd,alvos_dia')
    .order('pontos', { ascending: false }).order('vitorias', { ascending: false }).limit(100);
  if (error) { console.error('[Online] Falha ao carregar assentamentos:', error.message); return; }
  online.meuPerfil = (data || []).find(p => p.user_id === _sbUser.id) || null;
  online.perfis = (data || []).filter(p => p.user_id !== _sbUser.id);
  online.ranking = data || [];
  renderizarOnline();
}

const horaCurta = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function renderizarOnline() {
  const painel = document.getElementById('online-painel');
  if (!painel) return;
  if (!getSB() || !_sbUser) {
    painel.innerHTML = '<div class="sec-bloco"><p class="bando-vazio">Faça login com uma conta para atacar e defender contra outros jogadores.</p></div>';
    return;
  }
  const a = estado.assentamento, agora = new Date();
  const temProntos = combatentesProntos().length > 0;

  const enviados = a.ataquesEnviados.map(x => `<div class="online-andamento">⚔️ Seu ataque a <b>${esc(x.alvo)}</b> chega às ${horaCurta(x.chegada)}</div>`);
  const contra = online.contra.map(x => `<div class="online-andamento online-perigo">⚠️ Ataque a caminho: <b>${esc(x.atacante_nome)}</b>, chega às ${horaCurta(x.chegada)}</div>`);
  const andamento = [...contra, ...enviados].join('') || '<p class="bando-vazio">Nenhum ataque em andamento.</p>';

  const alvos = online.perfis.map(p => {
    const motivo = online.meuPerfil ? motivoBloqueio(online.meuPerfil, p, agora, temProntos) : 'Publicando seu assentamento…';
    const poder = poderPerfil(p);
    const on = estaOnline(p.visto_em, agora);
    return `<div class="online-alvo">
      <div class="comb-info">
        <span class="comb-nome">${on ? '🟢' : '⚫'} ${esc(p.nome)} <span class="comb-cat">Nível ${p.nivel}</span></span>
        <span class="comb-estado">🏆 ${p.pontos} pontos · ⚔️ ${poder.atq} 🛡️ ${poder.def}${p.defensores?.length ? '' : ' (milícia)'}</span>
      </div>
      <button class="btn-primario btn-sm" data-atacar="${esc(p.user_id)}" ${motivo ? `disabled title="${esc(motivo)}"` : ''}>Atacar</button>
      ${motivo ? `<span class="online-motivo">${esc(motivo)}</span>` : ''}
    </div>`;
  }).join('') || '<p class="bando-vazio">Nenhum outro assentamento online ainda.</p>';

  const ranking = (online.ranking || []).slice(0, 20).map((p, i) => `<div class="online-rank${p.user_id === _sbUser.id ? ' online-eu' : ''}">
      <span class="online-pos">${i + 1}º</span><span class="online-rank-nome">${esc(p.nome)}</span>
      <span class="janela-dim">Nv ${p.nivel}</span><span>🏆 ${p.pontos}</span><span class="janela-dim">${p.vitorias}V/${p.derrotas}D</span>
    </div>`).join('') || '<p class="bando-vazio">Ranking vazio.</p>';

  painel.innerHTML = `
    <div class="sec-bloco bando-secao"><h4 class="trab-secao-titulo">🚩 Ataques em andamento</h4><div class="bando-lista">${andamento}</div></div>
    <div class="sec-bloco bando-secao"><h4 class="trab-secao-titulo">🌐 Assentamentos <span class="bando-cont">atualiza a cada 30 s</span></h4><div class="bando-lista">${alvos}</div></div>
    <div class="sec-bloco bando-secao"><h4 class="trab-secao-titulo">🏆 Ranking</h4><div class="bando-lista">${ranking}</div></div>`;
  painel.onclick = e => {
    const b = e.target.closest('[data-atacar]');
    if (b && !b.disabled) abrirEnvioAtaque(b.dataset.atacar);
  };
}

// Lista e ranking recarregam a cada 30 s enquanto a sub-aba Ataques estiver visível
function iniciarAtualizacaoOnline() {
  if (online.timerLista) return;
  online.timerLista = setInterval(() => {
    const visivel = !document.hidden && abaAssentamentoAberta() && !document.getElementById('sub-assent-online')?.classList.contains('oculto');
    if (visivel) carregarListaOnline();
  }, 30000);
}
```

- [ ] **Step 4: Ver passar**

Run: `node --test tests/ && node --check online.js`
Expected: `# pass 47`, `# fail 0`, sem saída do `--check`

- [ ] **Step 5: Commit**

```bash
git add online.js tests/online.test.js
git commit -m "feat: módulo online (perfil público, ataques, aplicação de resultados, ranking)"
```

---

### Task 4: Ligar o online ao jogo

**Files:**
- Modify: `index.html` (script, sub-aba e painel)
- Modify: `script.js` (6 ganchos)
- Modify: `style.css` (fim do arquivo)

- [ ] **Step 1: `index.html`**

Logo após `  <script src="bando.js"></script>` adicionar:

```html
  <script src="online.js"></script>
```

Logo após `              <button class="sub-aba-btn" data-sub="sub-assent-bando">⚔️ Bando</button>` adicionar:

```html
              <button class="sub-aba-btn" data-sub="sub-assent-online">🌐 Ataques</button>
```

Trocar:

```html
            <div class="sub-aba-painel oculto" id="sub-assent-bando">
              <div id="bando-painel" class="bando-painel"></div>
            </div>
```

por:

```html
            <div class="sub-aba-painel oculto" id="sub-assent-bando">
              <div id="bando-painel" class="bando-painel"></div>
            </div>

            <!-- Sub-aba: Ataques online (desenhada por online.js) -->
            <div class="sub-aba-painel oculto" id="sub-assent-online">
              <div id="online-painel" class="bando-painel"></div>
            </div>
```

- [ ] **Step 2: Ganchos em `script.js`**

Em `salvarJogo`, logo após `  if (_sbUser) sbSalvar(dados); // cloud save assíncrono, sem bloquear` adicionar:

```js
  if (_sbUser) publicarPerfilOnline(); // perfil público do assentamento (no máximo a cada 20 s)
```

No `setInterval` de 30 s do `DOMContentLoaded`, logo após `    resgatarCreditosBazar(); // vendas feitas enquanto o jogador está online` adicionar:

```js
    verificarAtaquesOnline(); // ataques a resolver/aplicar (Bando online)
```

Em `restaurarUIJogo`, logo após a última linha da função, `  iniciarLoop();`, adicionar:

```js
  verificarAtaquesOnline(); // ataques sofridos ou terminados enquanto o jogo estava fechado
```

Em `renderizarAssentamento`, logo após `  renderizarBando();` adicionar:

```js
  renderizarOnline();
```

No clique das abas, trocar:

```js
      if (aba === 'assentamento') renderizarAssentamento();
```

por:

```js
      if (aba === 'assentamento') { renderizarAssentamento(); carregarListaOnline(); iniciarAtualizacaoOnline(); }
```

Em `atualizarBadgeAssentamento`, trocar:

```js
    || (estado.assentamento?.bando || []).some(c => c.soldoPendente);
```

por:

```js
    || (estado.assentamento?.bando || []).some(c => c.soldoPendente)
    || online.contra.length > 0;
```

- [ ] **Step 3: Estilos**

Adicionar ao fim de `style.css`:

```css
/* ══════════════════════════════════════════════════════
   SUB-ABA 🌐 ATAQUES (online.js)
══════════════════════════════════════════════════════ */
.online-andamento {
  font-size: .82rem; padding: 6px 8px;
  background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius);
}
.online-perigo { border-color: #6a2a2a; color: #ec8a8a; }
.online-alvo {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 6px 8px;
  background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius);
}
.online-alvo .btn-primario { margin-left: auto; }
.online-motivo { flex-basis: 100%; text-align: right; font-size: .68rem; color: var(--text-dim); }
.online-rank {
  display: grid; grid-template-columns: 32px minmax(0, 1fr) auto auto auto; gap: 8px; align-items: baseline;
  font-size: .82rem; padding: 4px 8px; border-bottom: 1px solid var(--border);
}
.online-rank-nome { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.online-pos { font-family: var(--font-mono); color: #e2b44c; }
.online-eu { background: rgba(68, 204, 68, .08); }
```

- [ ] **Step 4: Verificar**

Run: `node --check script.js && node --test tests/ && grep -c $'\x08' script.js index.html style.css`
Expected: sem erros, `# pass 47`, e `0` para os três

- [ ] **Step 5: Commit**

```bash
git add index.html script.js style.css
git commit -m "feat: integrar o Bando online ao jogo (sub-aba Ataques, perfil e verificação)"
```

---

### Task 5: Aplicar o SQL no Supabase e conferir a paridade em produção

**Files:**
- Create: `tests/paridade-servidor.js`

- [ ] **Step 1: Script de paridade com o Supabase**

Criar `tests/paridade-servidor.js`:

```js
// Paridade com o Supabase de produção: chama simular_combate_publico (só cálculo, sem dados)
// e compara com combate.js. Rode depois de aplicar supabase_bando_online.sql:
//   node tests/paridade-servidor.js
const fs = require('fs');
const path = require('path');
const util = require('util');
const raiz = path.join(__dirname, '..');
const { simularCombate, criarRng } = require(path.join(raiz, 'combate.js'));

const config = fs.readFileSync(path.join(raiz, 'config.js'), 'utf8');
const URL = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(config)[1];
const KEY = /SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(config)[1];

(async () => {
  const gen = criarRng(77);
  const int = (a, b) => a + Math.floor(gen() * (b - a + 1));
  const time = (p, n) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, nome: `${p}-${i}`, atq: int(0, 17), def: int(0, 18), vida: int(1, 70) }));
  let iguais = 0;
  const total = 200;
  for (let caso = 0; caso < total; caso++) {
    const A = time('A', int(1, 6)), B = time('B', int(1, 6));
    const semente = int(1, 2147483646);
    const resp = await fetch(`${URL}/rest/v1/rpc/simular_combate_publico`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_a: A, time_b: B, semente }),
    });
    if (!resp.ok) { console.error('Erro do servidor:', resp.status, await resp.text()); process.exit(1); }
    if (util.isDeepStrictEqual(simularCombate(A, B, semente), await resp.json())) iguais++;
    else console.log('DIFERENTE: caso', caso, 'semente', semente);
  }
  console.log(`paridade com o Supabase: ${iguais}/${total} idênticos`);
  process.exit(iguais === total ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
```

- [ ] **Step 2: Commit**

```bash
git add tests/paridade-servidor.js
git commit -m "test: paridade do motor de combate com o Supabase"
```

- [ ] **Step 3: O usuário roda o SQL** (passo humano)

No Supabase: SQL Editor → New query → colar todo o `supabase_bando_online.sql` → Run. Esperado: "Success. No rows returned".

- [ ] **Step 4: Conferir a paridade em produção**

Run: `node tests/paridade-servidor.js`
Expected: `paridade com o Supabase: 200/200 idênticos`

---

### Task 6: Manual

**Files:**
- Modify: `manual.html`

- [ ] **Step 1: Nova tela**

Em `manual.html`, logo antes de `  <!-- ═══════════ 8. ITENS E EVENTOS ═══════════ -->`, inserir:

```html
  <!-- ═══════════ ATAQUES ONLINE ═══════════ -->
  <section class="screen" id="s-ataques" data-nome="Ataques online" hidden>
    <p class="screen-intro">Com uma conta, seu assentamento aparece para os outros jogadores, e você pode <strong>atacar</strong> os deles com o Bando. Quem vence leva Baterias e itens do depósito do outro. O combate é decidido no servidor, então ninguém consegue inventar uma vitória.</p>
    <div class="frame stack">
      <div class="frame-label">Aba Assentamento · sub-aba 🌐 Ataques</div>
      <div class="card stack" data-h="atq-andamento" tabindex="0">
        <span class="sec-t" style="margin:0">🚩 Ataques em andamento</span>
        <span style="color:var(--red)">⚠️ Ataque a caminho: <b>Vila do Zé</b>, chega às 18:42</span>
        <span>⚔️ Seu ataque a <b>Forte Norte</b> chega às 18:40</span>
      </div>
      <div class="card stack">
        <span class="sec-t" style="margin:0">🌐 Assentamentos</span>
        <div class="mini-slot" data-h="atq-alvo" tabindex="0">🟢 <b>Vila do Zé</b> <span class="chip">Nível 3</span> <span class="dim">🏆 40 · ⚔️ 22 🛡️ 18</span><span class="btn sm" style="margin-left:auto" data-h="atq-atacar" tabindex="0">Atacar</span></div>
        <div class="mini-slot" data-h="atq-bloqueio" tabindex="0">⚫ <b>Forte Norte</b> <span class="chip">Nível 4</span> <span class="dim">🏆 25 · ⚔️ 8 🛡️ 9 (milícia)</span><span class="btn sm off" style="margin-left:auto">Atacar</span><span class="dim" style="flex-basis:100%;text-align:right;font-size:12px">Protegido até 21:15</span></div>
      </div>
      <div class="card stack" data-h="atq-ranking" tabindex="0">
        <span class="sec-t" style="margin:0">🏆 Ranking</span>
        <span>1º Vila do Zé · Nv 3 · 🏆 40 · 4V/1D</span>
        <span>2º Forte Norte · Nv 4 · 🏆 25 · 3V/2D</span>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Textos**

No objeto `H`, logo antes de `  // Itens e eventos`, inserir:

```js
  // Ataques online
  'atq-andamento': ['Ataques em andamento', 'Seus grupos a caminho e os ataques vindo na sua direção, com a hora de chegada. O grupo leva <b>5 minutos</b> para chegar. Se você estiver fora quando um ataque chegar, o resultado é aplicado e o relatório aparece quando você voltar.'],
  'atq-alvo': ['Assentamento de outro jogador', '🟢 jogou nos últimos 5 minutos, ⚫ está offline (também pode ser atacado). Mostra nível, pontos de guerra e o ⚔️/🛡️ estimado da defesa. Sem Bando em casa, os moradores defendem como <b>milícia</b> (mais fraca).'],
  'atq-atacar': ['Atacar', 'Escolha quais combatentes prontos vão. Se vencer, você leva <b>15% das Baterias</b> do outro (no máximo 200) e até <b>3 tipos de item</b> do depósito dele. Mortos e feridos valem para os dois lados. Vitória: +10 pontos e +60 XP; derrota: −3 pontos e +10 XP.'],
  'atq-bloqueio': ['Quando não dá para atacar', 'Só é possível atacar assentamentos até <b>2 níveis</b> acima ou abaixo do seu, no máximo <b>3 ataques por dia</b> e <b>uma vez por dia</b> o mesmo alvo. Quem foi atacado fica <b>protegido por 6 horas</b>. O motivo aparece embaixo do botão.'],
  'atq-ranking': ['Ranking', 'Os 20 primeiros por pontos de guerra: vitória atacando +10, defesa vencida +5, derrota atacando −3 (nunca abaixo de zero). Mostra vitórias (V) e derrotas (D).'],
```

- [ ] **Step 3: Verificar e commit**

Run: extrair o `<script>` do manual para um arquivo temporário e rodar `node --check` nele; `grep -c 'id="s-ataques"' manual.html` → 1.

```bash
git add manual.html
git commit -m "docs: manual com os ataques online"
```

---

### Task 7: Teste com duas contas e publicação

- [ ] **Step 1: Rodar tudo**

Run: `node --test tests/ && node tests/servidor/paridade-sql.js && node tests/servidor/cenarios-sql.js && node tests/paridade-servidor.js`
Expected: `# pass 47`, `600/600`, `8 cenários ok`, `200/200`

- [ ] **Step 2: Roteiro no navegador** (duas contas Líder, por exemplo uma janela normal e uma anônima)

1. As duas contas aparecem uma para a outra na sub-aba 🌐 Ataques (🟢), com nível, pontos e ⚔️/🛡️.
2. Conta A ataca B: os combatentes de A ficam "em missão"; B (online) vê "⚠️ Ataque a caminho" e o "!" na aba.
3. Após 5 min: os dois recebem o relatório; o saque sai de B e entra em A; pontos e V/D atualizam no ranking; B fica "Protegido até …".
4. A tenta atacar B de novo: bloqueado ("Protegido" ou "Já atacado hoje").
5. Defensor offline: B fecha o jogo, A ataca; quando B volta, o relatório aparece e as perdas são aplicadas uma única vez.
6. B sem Bando: a milícia defende (relatório menciona a milícia).
7. Recarregar a página com um ataque a caminho: os combatentes continuam "em missão" e o resultado é aplicado ao chegar.

- [ ] **Step 3: Publicar (só com aprovação do usuário)**

```bash
git checkout main && git merge --ff-only dev && git push origin main && git checkout dev && git push origin dev
```
