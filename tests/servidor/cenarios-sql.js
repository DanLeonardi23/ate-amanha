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
    await erro(A, 'select iniciar_ataque($1, $2)', [B, JSON.stringify([lut('a1', 22, 8, 55)])], /inválido/);
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

  const F = '00000000-0000-0000-0000-0000000000f0';
  const ALVO = '00000000-0000-0000-0000-000000000011'; // nível 1, sem ataques sofridos
  await db.query('insert into auth.users values ($1)', [F]);
  await rpc(F, 'select publicar_perfil($1)', [perfil('Vila F', 0, [lut('f1', 5, 2, 40)])]);

  await caso('dados sujos recusados e chaves extras descartadas', async () => {
    const base = JSON.parse(perfil('Vila F', 0, [lut('f1', 5, 2, 40)]));
    const pub = extra => rpc(F, 'select publicar_perfil($1)', [JSON.stringify({ ...base, ...extra })]);
    await erro(F, 'select publicar_perfil($1)', [JSON.stringify({ ...base, defensores: [{ ...lut('f1', 5, 2, 40), atq: '5' }] })], /defensores/);
    await erro(F, 'select publicar_perfil($1)', [JSON.stringify({ ...base, defensores: [lut('f1', 5, 2, 40), lut('f1', 4, 2, 30)] })], /defensores/);
    await erro(F, 'select iniciar_ataque($1, $2)', [ALVO, JSON.stringify([lut('x', 5, 2, 40), lut('x', 4, 2, 30)])], /inválido/);
    await erro(F, 'select publicar_perfil($1)', [JSON.stringify({ ...base, deposito: [{ id: 'sucata', qtd: 1 }, { id: 'sucata', qtd: 2 }] })], /depósito/);
    await erro(F, 'select publicar_perfil($1)', [JSON.stringify({ ...base, deposito: [{ id: 'constructor', qtd: 1 }] })], /depósito/);
    await erro(F, 'select publicar_perfil($1)', [JSON.stringify({ ...base, deposito: [{ id: 'sucata', qtd: '3' }] })], /depósito/);
    await pub({ deposito: [{ id: 'kit', qtd: 2, lixo: 1 }], defensores: [{ ...lut('f1', 5, 2, 40), lixo: { a: 1 }, extra: true }] });
    const r = await ler(F);
    assert.deepEqual(r.defensores, [lut('f1', 5, 2, 40)]);
    assert.deepEqual(r.deposito, [{ id: 'kit', qtd: 2 }]);
  });

  await caso('semente é 0 antes da resolução e sorteada depois', async () => {
    const at = (await rpc(F, 'select iniciar_ataque($1, $2) as r', [ALVO, JSON.stringify([{ ...lut('f1', 5, 2, 40), extra: 1 }])])).r;
    let linha = (await db.query('select semente, time_atacante from ataques where id = $1', [at.id])).rows[0];
    assert.equal(String(linha.semente), '0');
    assert.deepEqual(linha.time_atacante, [lut('f1', 5, 2, 40)]);
    await db.query(`update ataques set chegada = now() - interval '1 second' where id = $1`, [at.id]);
    await rpc(F, 'select resolver_ataque($1)', [at.id]);
    linha = (await db.query('select semente from ataques where id = $1', [at.id])).rows[0];
    assert.ok(BigInt(linha.semente) > 0n);
  });

  await caso('permissões: cliente não escreve direto, não lê colunas ocultas nem helpers', async () => {
    await como(F);
    const sob = async fn => { await db.exec('set role authenticated'); try { return await fn(); } finally { await db.exec('reset role'); } };
    const nega = (sql, re = /permission denied/) => sob(() => assert.rejects(db.query(sql), e => { assert.match(e.message, re); return true; }));
    await nega(`insert into assentamentos_publicos (user_id) values ('${A}')`);
    await nega(`insert into ataques (atacante, defensor, atacante_nome, defensor_nome, time_atacante, semente, chegada) values ('${A}','${B}','a','b','[]',1,now())`);
    await nega(`update assentamentos_publicos set pontos = 999`);
    await nega(`delete from assentamentos_publicos`);
    await nega(`select baterias from assentamentos_publicos`);
    await nega(`select deposito, xp from assentamentos_publicos`);
    await nega(`select _simular_combate('[]', '[]', 1)`);
    await nega(`select _time_valido('[]', 8)`);
    const r = await sob(() => db.query('select nome, pontos from assentamentos_publicos'));
    assert.ok(r.rows.length >= 3);
    const pontos = (await ler(F)).pontos;
    assert.notEqual(pontos, 999);
    const nove = JSON.stringify(Array.from({ length: 9 }, (_, i) => lut('n' + i, 1, 1, 10)));
    await sob(() => assert.rejects(db.query('select simular_combate_publico($1, $1, 1)', [nove]), /inválidos/));
    const ok9 = await sob(() => db.query('select simular_combate_publico($1, $2, 1) as r', [JSON.stringify([lut('a', 5, 2, 40)]), JSON.stringify([lut('b', 5, 1, 33)])]));
    assert.ok(ok9.rows[0].r.vencedor);
    await sob(async () => { await rpc(F, 'select publicar_perfil($1)', [perfil('Vila F', 0, [lut('f1', 5, 2, 40)])]); });
  });

  await caso('evolução: limites 21/22/90 (supabase_bando_evolucao.sql) e helper continua fechado', async () => {
    await db.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase_bando_evolucao.sql'), 'utf8'));
    await rpc(F, 'select publicar_perfil($1)', [perfil('Vila F', 0, [lut('f1', 21, 22, 90)])]);
    assert.deepEqual((await ler(F)).defensores, [lut('f1', 21, 22, 90)]);
    await erro(F, 'select publicar_perfil($1)', [perfil('Vila F', 0, [lut('f1', 22, 22, 90)])], /defensores/);
    await erro(F, 'select publicar_perfil($1)', [perfil('Vila F', 0, [lut('f1', 21, 23, 90)])], /defensores/);
    await erro(F, 'select publicar_perfil($1)', [perfil('Vila F', 0, [lut('f1', 21, 22, 91)])], /defensores/);
    await db.exec('set role authenticated');
    try { await assert.rejects(db.query("select _lutador_valido('{}')"), /permission denied/); } finally { await db.exec('reset role'); }
  });

  console.log(`\n${ok} cenários ok`);
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
