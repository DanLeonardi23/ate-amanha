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
