// Evolução dos combatentes: regras puras (bando-regras.js) e comportamento em bando.js (jogo simulado)
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const R = require('../bando-regras.js');

const combatente = (extra = {}) => ({
  id: 'c1', nome: 'Bia', categoria: 'novato', atqBase: 4, defBase: 2, vida: 40, vidaMax: 40,
  equip: { arma: null, cabeca: null, peito: null }, estado: 'pronto', nivel: 1, xp: 0, ...extra,
});

// ── Regras puras ──
test('tabela de níveis: XP, custo e próximo treino', () => {
  assert.deepEqual(R.NIVEIS_COMBATENTE.map(n => [n.nivel, n.xp, n.custo]), [[1, 0, 0], [2, 50, 15], [3, 120, 30], [4, 220, 50], [5, 350, 80]]);
  assert.equal(R.proximoTreino(combatente()).nivel, 2);
  assert.equal(R.proximoTreino(combatente({ nivel: 4 })).custo, 80);
  assert.equal(R.proximoTreino(combatente({ nivel: 5 })), null);
});

test('podeTreinar: XP, Baterias, estado e nível máximo', () => {
  assert.deepEqual(R.podeTreinar(combatente({ xp: 50 }), 15), { ok: true, motivo: null });
  assert.equal(R.podeTreinar(combatente({ xp: 49 }), 99).motivo, 'Faltam 1 XP');
  assert.equal(R.podeTreinar(combatente({ xp: 50 }), 14).motivo, 'Precisa de 15 Baterias');
  assert.equal(R.podeTreinar(combatente({ xp: 50, estado: 'missao' }), 99).motivo, 'Indisponível agora');
  assert.equal(R.podeTreinar(combatente({ xp: 50, estado: 'parado' }), 99).motivo, 'Indisponível agora');
  assert.equal(R.podeTreinar(combatente({ nivel: 5, xp: 999 }), 999).motivo, 'Nível máximo');
  assert.equal(R.podeTreinar(combatente({ xp: 50, estado: 'ferido' }), 99).ok, true); // ferido pode treinar
});

test('statsLutador soma o nível; soldo sobe 2 por nível', () => {
  assert.deepEqual([R.statsLutador(combatente({ nivel: 3 })).atq, R.statsLutador(combatente({ nivel: 3 })).def], [6, 4]);
  assert.equal(R.statsLutador(combatente()).atq, 4);
  assert.equal(R.statsLutador(combatente({ nivel: undefined })).atq, 4); // save sem nível
  assert.equal(R.soldoDe(combatente({ nivel: 1 })), 5);
  assert.equal(R.soldoDe(combatente({ nivel: 5 })), 13);
  assert.equal(R.soldoDe(combatente({ categoria: 'elite', nivel: 3 })), 19);
});

test('Elite nível 5 com o melhor equipamento cabe exatamente nos limites do online', () => {
  const c = combatente({ categoria: 'elite', atqBase: 9, defBase: 6, nivel: 5, vida: 90, vidaMax: 90,
    equip: { arma: 'machado', cabeca: 'capacete_tatico', peito: 'colete_balistico' } });
  const s = R.statsLutador(c);
  assert.deepEqual([s.atq, s.def, s.vida], [R.LIMITES_LUTADOR.atq, R.LIMITES_LUTADOR.def, R.LIMITES_LUTADOR.vida]);
  assert.deepEqual(R.LIMITES_LUTADOR, { atq: 21, def: 22, vida: 90 });
});

// ── bando.js com o jogo simulado ──
function criarJogo() {
  const raiz = path.join(__dirname, '..');
  const el = () => ({ className: '', style: {}, innerHTML: '', classList: { contains: () => false }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, remove() {} });
  const ctx = {
    console, Date, Array, Object, Set, JSON, parseInt, String,
    document: { getElementById: () => null, hidden: true, createElement: el, querySelectorAll: () => [], body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    estado: {
      dia: 1, inventario: [], baterias: 100, personagem: { nome: 'Ana' },
      deposito: { nivel: 1, itens: [] }, seguranca: { armadilhasInstaladas: 0 },
      assentamento: { parcelas: [null, null, null, null] },
    },
    ITENS: {}, SLOT_LABELS: { arma: 'Arma', cabeca: 'Cabeça', peito: 'Peito' },
    CHARS_GENERO: { 1: 'M', 2: 'H', 3: 'M', 4: 'M', 5: 'H', 6: 'H', 7: 'M', 8: 'H', 9: 'M', 10: 'H', 11: 'M', 12: 'H' },
    logs: [],
  };
  ctx.Math = Object.create(Math);
  Object.assign(ctx, {
    charPath: id => `img/${id}.png`, esc: s => String(s),
    log: m => ctx.logs.push(m), mostrarToast: m => ctx.logs.push('toast: ' + m),
    mostrarConfirmacao: (m, sim) => sim(), salvarJogo: () => {},
    temItem: (id, q = 1) => id === 'pilha' ? ctx.estado.baterias >= q : false,
    removerItem: (id, q = 1) => { if (id === 'pilha') ctx.estado.baterias -= q; return true; },
    adicionarItem: () => true, renderizarDeposito: () => {}, mudarBaterias: d => { ctx.estado.baterias += d; },
    capacidadeDeposito: () => 5, moradores: () => [], npcAtivo: () => true, habCanonica: h => h,
    renderizarAssentamento: () => {}, atualizarBadgeAssentamento: () => {},
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['combate.js', 'bando-regras.js', 'bando.js']) vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), ctx, { filename: f });
  const run = code => vm.runInContext(code, ctx);
  const a = ctx.estado.assentamento;
  a.bando = [
    { id: 'c1', nome: 'Bia', charId: 1, categoria: 'novato', atqBase: 4, defBase: 2, vida: 40, vidaMax: 40, equip: { arma: null, cabeca: null, peito: null }, estado: 'pronto', diaSoldo: 6, soldoPendente: null, divida: null },
    { id: 'c2', nome: 'Rafa', charId: 2, categoria: 'novato', atqBase: 4, defBase: 2, vida: 40, vidaMax: 40, equip: { arma: null, cabeca: null, peito: null }, estado: 'pronto', diaSoldo: 6, soldoPendente: null, divida: null },
  ];
  run('normalizarBando(estado.assentamento, estado.personagem);');
  return { ctx, run, a };
}

test('save antigo: combatentes ganham nível 1 e XP 0', () => {
  const { a } = criarJogo();
  assert.deepEqual(a.bando.map(c => [c.nivel, c.xp]).map(x => [...x]), [[1, 0], [1, 0]]);
});

test('save corrompido: nível fora de 1–5 e XP inválido são corrigidos', () => {
  const { run, a } = criarJogo();
  Object.assign(a.bando[0], { nivel: 9, xp: NaN });
  Object.assign(a.bando[1], { nivel: -2, xp: -5 });
  run('normalizarBando(estado.assentamento, estado.personagem);');
  assert.deepEqual(a.bando.map(c => [c.nivel, c.xp]).map(x => [...x]), [[5, 0], [1, 0]]);
  assert.doesNotThrow(() => run('htmlCombatente(estado.assentamento.bando[0])'));
});

test('XP só para quem sobreviveu: +20 na vitória, +8 na derrota, nada para morto', () => {
  const { ctx, run, a } = criarJogo();
  ctx.res = { lutadores: [{ id: 'c1', lado: 'A', vida: 30 }, { id: 'c2', lado: 'A', vida: 0 }] };
  const baixas = run('aplicarResultadoCombate(res, "A", true)');
  assert.equal(a.bando.length, 1);
  assert.equal(a.bando[0].xp, 20);
  assert.deepEqual([baixas.xp, [...baixas.ganharam]], [20, ['Bia']]);
  ctx.res = { lutadores: [{ id: 'c1', lado: 'A', vida: 25 }] };
  run('aplicarResultadoCombate(res, "A", false)');
  assert.equal(a.bando[0].xp, 28);
  run('aplicarResultadoCombate(res, "A")'); // sem resultado informado: sem XP
  assert.equal(a.bando[0].xp, 28);
});

test('aviso quando o XP libera o treino (uma vez)', () => {
  const { ctx, run, a } = criarJogo();
  a.bando[0].xp = 40;
  ctx.res = { lutadores: [{ id: 'c1', lado: 'A', vida: 40 }] };
  run('aplicarResultadoCombate(res, "A", true)');
  assert.equal(ctx.logs.filter(l => l.includes('pode treinar para o nível 2')).length, 1);
  run('aplicarResultadoCombate(res, "A", true)');
  assert.equal(ctx.logs.filter(l => l.includes('pode treinar para o nível 2')).length, 1);
});

test('treinar: desconta Baterias, sobe nível, vida máxima e vida', () => {
  const { ctx, run, a } = criarJogo();
  const c = a.bando[0];
  c.xp = 55; c.vida = 30;
  run('treinarCombatente("c1")');
  assert.deepEqual([c.nivel, c.vidaMax, c.vida, ctx.estado.baterias], [2, 45, 35, 85]);
  run('treinarCombatente("c1")'); // XP 55 < 120: não treina
  assert.equal(c.nivel, 2);
  assert.ok(ctx.logs.some(l => l === 'toast: Faltam 65 XP'));
});

test('treinar sem Baterias suficientes não muda nada', () => {
  const { ctx, run, a } = criarJogo();
  ctx.estado.baterias = 10;
  a.bando[0].xp = 60;
  run('treinarCombatente("c1")');
  assert.deepEqual([a.bando[0].nivel, ctx.estado.baterias], [1, 10]);
});

test('soldo cobrado conforme o nível', () => {
  const { run, a } = criarJogo();
  a.bando[0].nivel = 4;
  run('estado.dia = 6; rotinaDiariaBando();');
  assert.deepEqual([a.bando[0].soldoPendente, a.bando[1].soldoPendente], [11, 5]);
});

test('missão: sobreviventes ganham XP e o relatório mostra quem ganhou', () => {
  const { run, a } = criarJogo();
  a.bando.forEach(c => { c.atqBase = 30; c.defBase = 30; c.vida = 200; c.vidaMax = 200; }); // vitória garantida
  run('iniciarMissao("acampamento", ["c1", "c2"]); estado.assentamento.missoes.emAndamento[0].fim = 0; verificarMissoesConcluidas();');
  assert.deepEqual(a.bando.map(c => c.xp).map(Number), [20, 20]);
  assert.equal(a.relatorios[0].baixas.xp, 20);
  assert.deepEqual([...a.relatorios[0].baixas.ganharam], ['Bia', 'Rafa']);
});
