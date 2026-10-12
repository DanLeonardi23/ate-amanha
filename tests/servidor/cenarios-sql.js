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
