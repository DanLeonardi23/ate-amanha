// Testa bando.js carregando-o num contexto com versões mínimas das funções do jogo (script.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function criarJogo() {
  const raiz = path.join(__dirname, '..');
  const elementoFalso = () => ({ innerHTML: '', classList: { contains: () => false }, querySelector: () => null, addEventListener() {}, remove() {} });
  const ctx = {
    console, Date, Array, Object, Set, JSON, parseInt, String,
    document: { getElementById: () => null, hidden: true, createElement: elementoFalso, body: { appendChild() {} } },
    estado: {
      dia: 1, inventario: [], baterias: 500, personagem: { nome: 'Ana' },
      deposito: { nivel: 1, itens: [{ id: 'faca', nome: 'Faca', icone: '🔪', tipo: 'ferramenta', qtd: 2 }] },
      seguranca: { armadilhasInstaladas: 2 },
      assentamento: { parcelas: [{ tipo: 'barraco', habitantes: [{ habilidade: 'medico', estadoNpc: 'idle' }] }, null, null, null] },
    },
    ITENS: {
      faca: { id: 'faca', nome: 'Faca', icone: '🔪', tipo: 'ferramenta' },
      sucata: { id: 'sucata', nome: 'Sucata', icone: '🔩', tipo: 'material' },
      madeira: { id: 'madeira', nome: 'Madeira', icone: '🌳', tipo: 'material' },
      pano: { id: 'pano', nome: 'Trapo', icone: '🧻', tipo: 'material' },
    },
    SLOT_LABELS: { arma: 'Arma', cabeca: 'Cabeça', peito: 'Peito' },
    CHARS_GENERO: { 1: 'M', 2: 'H', 3: 'M', 4: 'M', 5: 'H', 6: 'H', 7: 'M', 8: 'H', 9: 'M', 10: 'H', 11: 'M', 12: 'H' },
    logs: [],
  };
  ctx.Math = Object.create(Math);
  ctx.charPath = id => `img/chars/${id}.png`;
  ctx.esc = s => String(s);
  ctx.log = m => ctx.logs.push(m);
  ctx.mostrarToast = m => ctx.logs.push('toast: ' + m);
  ctx.mostrarConfirmacao = (msg, sim) => sim();
  ctx.salvarJogo = () => {};
  ctx.temItem = (id, q = 1) => id === 'pilha' ? ctx.estado.baterias >= q : ctx.estado.deposito.itens.some(i => i.id === id && i.qtd >= q);
  ctx.removerItem = (id, q = 1) => {
    if (id === 'pilha') { ctx.estado.baterias -= q; return true; }
    const i = ctx.estado.deposito.itens.find(x => x.id === id); i.qtd -= q; return true;
  };
  ctx.adicionarItem = () => true;
  ctx.mudarBaterias = d => { ctx.estado.baterias += d; };
  ctx.capacidadeDeposito = () => 5;
  ctx.moradores = () => [{ parcela: ctx.estado.assentamento.parcelas[0], npc: ctx.estado.assentamento.parcelas[0].habitantes[0] }];
  ctx.npcAtivo = () => true;
  ctx.habCanonica = h => h;
  ctx.renderizarAssentamento = () => {};
  ctx.atualizarBadgeAssentamento = () => {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['combate.js', 'bando-regras.js', 'bando.js']) vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), ctx, { filename: f });
  vm.runInContext('Math.random = criarRng(12345);', ctx); // recrutas previsíveis
  const run = code => vm.runInContext(code, ctx);
  run('normalizarBando(estado.assentamento, estado.personagem); garantirMural();');
  return { ctx, run, a: ctx.estado.assentamento };
}

test('normalizarBando: nome, XP de save antigo e campos novos', () => {
  const { a } = criarJogo();
  assert.equal(a.nome, 'Assentamento de Ana');
  assert.equal(a.xp, 50); // 1 moradia (30) + 1 morador (20)
  assert.equal(a.nivel, 1);
  assert.deepEqual([a.bando.length, a.recrutas.lista.length, a.relatorios.length], [0, 3, 0]);
});

test('contratar respeita Baterias e o limite do Bando', () => {
  const { ctx, run, a } = criarJogo();
  const precos = a.recrutas.lista.slice(0, 2).map(r => r.preco);
  run('contratarRecruta(0); contratarRecruta(0);');
  assert.equal(a.bando.length, 2);
  assert.equal(ctx.estado.baterias, 500 - precos[0] - precos[1]);
  run('contratarRecruta(0);'); // limite do nível 1 é 2
  assert.equal(a.bando.length, 2);
  assert.ok(ctx.logs.some(l => l.includes('Bando cheio')));
});

test('equipar tira o item do inventário e aumenta o Ataque', () => {
  const { ctx, run, a } = criarJogo();
  run('contratarRecruta(0);');
  const atqAntes = run('statsLutador(estado.assentamento.bando[0]).atq');
  run('equiparCombatente(estado.assentamento.bando[0], "arma", "faca");');
  assert.equal(a.bando[0].equip.arma, 'faca');
  assert.equal(ctx.estado.deposito.itens[0].qtd, 1);
  assert.equal(run('statsLutador(estado.assentamento.bando[0]).atq'), atqAntes + 3);
});

test('missão: termina, gera relatório e não pode repetir no mesmo dia', () => {
  const { run, a } = criarJogo();
  run('contratarRecruta(0); contratarRecruta(0);');
  run('iniciarMissao("acampamento", estado.assentamento.bando.map(c => c.id));');
  assert.ok(a.bando.every(c => c.estado === 'missao'));
  run('estado.assentamento.missoes.emAndamento[0].fim = 0; verificarMissoesConcluidas();');
  assert.equal(a.missoes.emAndamento.length, 0);
  assert.equal(a.relatorios.length, 1);
  assert.ok(a.bando.every(c => c.estado !== 'missao'));
  run('iniciarMissao("acampamento", estado.assentamento.bando.map(c => c.id));');
  assert.equal(a.missoes.emAndamento.length, 0);
});

test('soldo: cobra no dia certo, recusar para e reativar volta', () => {
  const { ctx, run, a } = criarJogo();
  run('contratarRecruta(0);');
  const c = a.bando[0];
  run('estado.dia = 5; rotinaDiariaBando();');
  assert.equal(c.soldoPendente, null);
  run('estado.dia = 6; rotinaDiariaBando();');
  assert.equal(c.soldoPendente, ctx.CATEGORIAS[c.categoria].soldo);
  run(`recusarSoldo("${c.id}");`);
  assert.equal(c.estado, 'parado');
  assert.equal(run('combatentesProntos().length'), 0);
  const antes = ctx.estado.baterias;
  run(`reativarCombatente("${c.id}");`);
  assert.equal(c.estado, 'pronto');
  assert.equal(ctx.estado.baterias, antes - ctx.CATEGORIAS[c.categoria].soldo);
});

test('cura diária com Médico e volta de ferido para pronto', () => {
  const { run, a } = criarJogo();
  run('contratarRecruta(0);');
  const c = a.bando[0];
  c.vida = 5; c.estado = 'ferido';
  run('rotinaDiariaBando();'); // Médico ativo fora do Posto: +15
  assert.equal(c.vida, 20);
  assert.equal(c.estado, c.vida >= c.vidaMax * 0.3 ? 'pronto' : 'ferido');
});

test('morte remove o combatente; defesa sem Bando devolve null', () => {
  const { run, a } = criarJogo();
  run('contratarRecruta(0);');
  const id = a.bando[0].id;
  run(`aplicarResultadoCombate({ lutadores: [{ id: "${id}", lado: "A", vida: 0 }] }, "A");`);
  assert.equal(a.bando.length, 0);
  assert.equal(run('defenderInvasao()'), null);
  run('contratarRecruta(0);');
  assert.equal(typeof run('defenderInvasao()'), 'boolean');
  assert.equal(a.relatorios.length, 1);
});
