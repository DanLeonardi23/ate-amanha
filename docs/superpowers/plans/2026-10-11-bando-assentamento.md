# Bando e identidade do Assentamento — Plano de implementação (Etapa 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Assentamento nome, nível, XP, Ataque e Defesa, e criar o Bando (recrutar, equipar, curar, missões e defesa contra invasões), tudo local.

**Architecture:** Dois módulos puros e testáveis no Node (`combate.js`: motor de combate determinístico; `bando-regras.js`: tabelas e cálculos) e um módulo de jogo (`bando.js`: estado, regras e telas do Bando), todos carregados por `<script>` antes de `script.js`. O `script.js` só ganha ganchos (save, dia, laço de tempo, saque noturno, XP). Desenho completo em `docs/superpowers/specs/2026-10-11-bando-assentamento-design.md`.

**Tech Stack:** HTML/CSS/JavaScript puro (sem build), testes com `node --test` (Node 20, `node:test` + `node:assert/strict`), `vm` do Node para testar `bando.js` com versões mínimas das funções do jogo.

---

## Antes de começar

- O working tree usa CRLF (`core.autocrlf=true`). Crie arquivos com a ferramenta de escrita e altere com a ferramenta de edição. **Não** use `sed` com barras invertidas no Git Bash (já gerou caracteres invisíveis neste projeto). Depois de editar `script.js`, confira: `grep -c $'\x08' script.js` deve dar `0`.
- Rode todos os testes com: `node --test tests/`
- Checagem de sintaxe: `node --check <arquivo>.js`

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `combate.js` (novo) | Motor de combate puro: RNG com semente, golpe, simulação, relatório |
| `bando-regras.js` (novo) | Tabelas (XP, categorias, itens de combate, missões) e funções puras |
| `bando.js` (novo) | Estado do Bando, identidade, recrutamento, soldo, equipamento, cura, missões, defesa e telas |
| `tests/combate.test.js` (novo) | Testes do motor |
| `tests/bando-regras.test.js` (novo) | Testes das regras e do equilíbrio |
| `tests/bando.test.js` (novo) | Testes do `bando.js` com funções do jogo simuladas |
| `index.html` | Carrega os 3 scripts; aba Assentamento com identidade e sub-abas |
| `script.js` | Ganchos de integração |
| `style.css` | Estilos da identidade, Bando, missões, janelas e relatórios |
| `manual.html` | Tela "Bando" no manual |

---

### Task 1: Motor de combate

**Files:**
- Create: `tests/combate.test.js`
- Create: `combate.js`

- [ ] **Step 1: Escrever os testes**

Criar `tests/combate.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarRng, calcularGolpe, decidirVencedor, simularCombate } = require('../combate.js');

const lut = (id, atq, def, vida) => ({ id, nome: id, atq, def, vida });
const sequencia = valores => { let i = 0; return () => valores[i++]; };

test('criarRng é determinístico e fica entre 0 e 1', () => {
  const a = criarRng(42), b = criarRng(42);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(criarRng(1)(), criarRng(2)());
});

test('calcularGolpe: erro, normal, crítico, Defesa e dano mínimo', () => {
  assert.deepEqual(calcularGolpe(10, 0, sequencia([0.1])), { dano: 0, tipo: 'erro' });
  assert.deepEqual(calcularGolpe(10, 0, sequencia([0.5, 0.5])), { dano: 10, tipo: 'normal' });
  assert.deepEqual(calcularGolpe(10, 8, sequencia([0.5, 0.5])), { dano: 6, tipo: 'normal' });
  assert.deepEqual(calcularGolpe(2, 50, sequencia([0.5, 0.5])), { dano: 1, tipo: 'normal' });
  assert.deepEqual(calcularGolpe(10, 0, sequencia([0.95, 0.5])), { dano: 20, tipo: 'critico' });
});

test('decidirVencedor: maior fração vence; empate favorece o defensor (B)', () => {
  assert.equal(decidirVencedor(0.6, 0.4), 'A');
  assert.equal(decidirVencedor(0.4, 0.6), 'B');
  assert.equal(decidirVencedor(0.5, 0.5), 'B');
});

test('simularCombate: mesma semente, mesmo resultado', () => {
  const A = [lut('a1', 5, 2, 40), lut('a2', 5, 2, 40)];
  const B = [lut('b1', 5, 1, 33), lut('b2', 5, 1, 33)];
  assert.deepEqual(simularCombate(A, B, 7), simularCombate(A, B, 7));
});

test('simularCombate: não altera a entrada e vida nunca fica negativa', () => {
  const A = [lut('a1', 30, 0, 20)], B = [lut('b1', 30, 0, 20)];
  const res = simularCombate(A, B, 3);
  assert.equal(A[0].vida, 20);
  for (const l of res.lutadores) assert.ok(l.vida >= 0);
  assert.equal(res.lutadores.length, 2);
});

test('simularCombate: time muito mais forte vence quase sempre', () => {
  let vitorias = 0;
  for (let s = 1; s <= 500; s++) {
    const res = simularCombate([lut('f1', 12, 6, 60), lut('f2', 12, 6, 60)], [lut('w1', 4, 1, 30), lut('w2', 4, 1, 30)], s);
    if (res.vencedor === 'A') vitorias++;
  }
  assert.ok(vitorias >= 480, `vitórias: ${vitorias}`);
});

test('simularCombate: time vazio perde sem rodadas', () => {
  const res = simularCombate([], [lut('b', 1, 0, 10)], 1);
  assert.equal(res.vencedor, 'B');
  assert.equal(res.rodadas, 0);
});

test('simularCombate: lado abaixo de 25% recua antes de cair inteiro', () => {
  let recuos = 0;
  for (let s = 1; s <= 200; s++) {
    const res = simularCombate([lut('a', 60, 50, 100)], [lut('b1', 1, 0, 100), lut('b2', 1, 0, 100)], s);
    assert.equal(res.vencedor, 'A');
    if (res.motivo === 'recuo') recuos++;
  }
  assert.ok(recuos >= 120, `recuos: ${recuos}`);
});

test('simularCombate: no máximo 5 rodadas e relatório com as rodadas', () => {
  const res = simularCombate([lut('a', 1, 99, 500)], [lut('b', 1, 99, 500)], 5);
  assert.equal(res.rodadas, 5);
  assert.equal(res.motivo, 'tempo');
  assert.equal(res.relatorio.filter(l => l.startsWith('— Rodada')).length, 5);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/combate.test.js`
Expected: FAIL com `Cannot find module '../combate.js'`

- [ ] **Step 3: Implementar o motor**

Criar `combate.js`:

```js
/**
 * ATÉ AMANHÃ — combate.js
 * Motor de combate puro: não acessa o estado do jogo. Roda no navegador (funções globais)
 * e no Node (module.exports), para testes e, na Etapa 2, para conferência no servidor.
 */
(function (raiz) {
  'use strict';

  const MAX_RODADAS  = 5;
  const LIMIAR_RECUO = 0.25; // abaixo de 25% da vida total inicial, o lado recua
  const CHANCE_ERRO  = 0.20;
  const CHANCE_CRIT  = 0.12;

  // Gerador determinístico (mulberry32): a mesma semente gera sempre a mesma sequência
  function criarRng(semente) {
    let a = (semente >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Um golpe: erro, normal ou crítico. Consome 1 número do RNG (erro) ou 2 (acerto).
  function calcularGolpe(atq, defAlvo, rng) {
    const r = rng();
    if (r < CHANCE_ERRO) return { dano: 0, tipo: 'erro' };
    const critico = r > 1 - CHANCE_CRIT;
    const base = atq * (0.6 + 0.8 * rng()) - defAlvo * 0.5;
    return { dano: Math.max(1, Math.round(base * (critico ? 2 : 1))), tipo: critico ? 'critico' : 'normal' };
  }

  // Desempate por porcentagem de vida restante: empate favorece o defensor (B)
  function decidirVencedor(fracaoA, fracaoB) {
    return fracaoA > fracaoB ? 'A' : 'B';
  }

  // timeA/timeB: [{ id, nome, atq, def, vida }]. Os objetos de entrada não são alterados.
  function simularCombate(timeA, timeB, semente) {
    const rng = criarRng(semente);
    const preparar = (time, lado) => time.map(l => ({ id: l.id, nome: l.nome, atq: l.atq, def: l.def, vida: Math.max(0, l.vida), lado }));
    const A = preparar(timeA, 'A');
    const B = preparar(timeB, 'B');
    const somaVida = t => t.reduce((s, l) => s + l.vida, 0);
    const inicial = { A: somaVida(A), B: somaVida(B) };
    const dePe = t => t.filter(l => l.vida > 0);
    const fracao = (t, lado) => (inicial[lado] > 0 ? somaVida(t) / inicial[lado] : 0);
    const relatorio = [];

    function checarFim() {
      if (!dePe(A).length) return { vencedor: 'B', motivo: 'derrota' };
      if (!dePe(B).length) return { vencedor: 'A', motivo: 'derrota' };
      const fa = fracao(A, 'A'), fb = fracao(B, 'B');
      if (fa < LIMIAR_RECUO || fb < LIMIAR_RECUO) return { vencedor: decidirVencedor(fa, fb), motivo: 'recuo' };
      return null;
    }

    let fim = checarFim(); // time vazio decide na hora
    let rodadas = 0;
    while (!fim && rodadas < MAX_RODADAS) {
      rodadas++;
      relatorio.push(`— Rodada ${rodadas} —`);
      const va = dePe(A), vb = dePe(B), ordem = [];
      for (let i = 0; i < Math.max(va.length, vb.length); i++) {
        if (va[i]) ordem.push(va[i]);
        if (vb[i]) ordem.push(vb[i]);
      }
      for (const atacante of ordem) {
        if (atacante.vida <= 0) continue;
        const inimigos = dePe(atacante.lado === 'A' ? B : A);
        if (!inimigos.length) break;
        const alvo = inimigos[Math.floor(rng() * inimigos.length)];
        const golpe = calcularGolpe(atacante.atq, alvo.def, rng);
        alvo.vida = Math.max(0, alvo.vida - golpe.dano);
        if (golpe.tipo === 'erro') relatorio.push(`${atacante.nome} erra ${alvo.nome}.`);
        else relatorio.push(`${atacante.nome} acerta ${alvo.nome}${golpe.tipo === 'critico' ? ' (crítico!)' : ''}: ${golpe.dano} de dano${alvo.vida === 0 ? ' — caiu!' : '.'}`);
      }
      fim = checarFim();
    }
    if (!fim) fim = { vencedor: decidirVencedor(fracao(A, 'A'), fracao(B, 'B')), motivo: 'tempo' };

    return {
      vencedor: fim.vencedor,
      motivo: fim.motivo,
      rodadas,
      lutadores: [...A, ...B].map(l => ({ id: l.id, lado: l.lado, vida: l.vida })),
      relatorio,
    };
  }

  const api = { criarRng, calcularGolpe, decidirVencedor, simularCombate, MAX_RODADAS, LIMIAR_RECUO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(raiz, api);
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/combate.test.js`
Expected: `# pass 9` e `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add combate.js tests/combate.test.js
git commit -m "feat: motor de combate do Bando (combate.js) com testes"
```

---

### Task 2: Regras do Bando e equilíbrio

**Files:**
- Create: `tests/bando-regras.test.js`
- Create: `bando-regras.js`

- [ ] **Step 1: Escrever os testes (inclui equilíbrio com 3.000 combates por cenário)**

Criar `tests/bando-regras.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../bando-regras.js');
const { criarRng, simularCombate } = require('../combate.js');

const combatente = (categoria, equip = {}) => {
  const c = R.CATEGORIAS[categoria];
  return { id: categoria, nome: categoria, atqBase: c.atq, defBase: c.def, vida: c.vida, vidaMax: c.vida, equip: { arma: null, cabeca: null, peito: null, ...equip } };
};

test('nivelPorXp, xpParaNivel e limiteBando', () => {
  assert.equal(R.nivelPorXp(0), 1);
  assert.equal(R.nivelPorXp(99), 1);
  assert.equal(R.nivelPorXp(100), 2);
  assert.equal(R.nivelPorXp(449), 3);
  assert.equal(R.nivelPorXp(1750), 8);
  assert.equal(R.nivelPorXp(99999), 8);
  assert.equal(R.xpParaNivel(1), 100);
  assert.equal(R.xpParaNivel(7), 1750);
  assert.equal(R.xpParaNivel(8), null);
  assert.equal(R.limiteBando(1), 2);
  assert.equal(R.limiteBando(5), 6);
  assert.equal(R.limiteBando(8), 8);
});

test('statsLutador soma equipamento e bônus de defesa', () => {
  const c = combatente('novato', { arma: 'faca', cabeca: 'capacete', peito: 'colete_balistico' });
  assert.deepEqual(R.statsLutador(c), { id: 'novato', nome: 'novato', atq: 7, def: 11, vida: 40 });
  assert.equal(R.statsLutador(c, 3).def, 14);
  assert.equal(R.statsLutador(combatente('elite', { arma: 'item_inexistente' })).atq, 9);
});

test('gerarInimigos e gerarInvasores seguem as fórmulas', () => {
  assert.deepEqual(R.gerarInimigos('acampamento', 1).map(i => [i.atq, i.def, i.vida]), [[4, 1, 33], [4, 1, 33]]);
  const posto4 = R.gerarInimigos('posto', 4);
  assert.equal(posto4.length, 5);
  assert.deepEqual([posto4[0].atq, posto4[0].def, posto4[0].vida], [7, 4, 52]);
  assert.equal(R.gerarInimigos('deposito_militar', 1).length, 4);
  assert.deepEqual(R.gerarInvasores(3).map(i => [i.atq, i.def, i.vida]), [[5, 2, 39], [5, 2, 39], [5, 2, 39]]);
});

test('curaDiaria e estadoAposCombate', () => {
  assert.equal(R.curaDiaria(false, false), 5);
  assert.equal(R.curaDiaria(true, false), 15);
  assert.equal(R.curaDiaria(true, true), 25);
  assert.equal(R.estadoAposCombate(0, 40), 'morto');
  assert.equal(R.estadoAposCombate(11, 40), 'ferido');
  assert.equal(R.estadoAposCombate(12, 40), 'pronto');
});

test('gerarRecruta: campos válidos e preço na faixa da categoria', () => {
  const rng = criarRng(99);
  const genero = { 1: 'M', 2: 'H', 3: 'M', 4: 'M', 5: 'H', 6: 'H', 7: 'M', 8: 'H', 9: 'M', 10: 'H', 11: 'M', 12: 'H' };
  for (let i = 0; i < 200; i++) {
    const r = R.gerarRecruta(rng, genero);
    const cat = R.CATEGORIAS[r.categoria];
    assert.ok(cat, r.categoria);
    assert.ok(r.charId >= 1 && r.charId <= 12);
    assert.ok(R.NOMES_COMBATENTE[genero[r.charId]].includes(r.nome));
    assert.ok(r.preco >= cat.preco[0] && r.preco <= cat.preco[1]);
    assert.equal(r.vida, r.vidaMax);
  }
});

test('sortearLoot: baterias na faixa e itens do alvo', () => {
  const rng = criarRng(5);
  let raros = 0;
  for (let i = 0; i < 500; i++) {
    const loot = R.sortearLoot('deposito_militar', rng);
    assert.ok(loot.baterias >= 35 && loot.baterias <= 60);
    const permitidos = [...R.MISSOES.deposito_militar.itens.map(x => x.id), ...R.MISSOES.deposito_militar.raro.ids];
    for (const it of loot.itens) assert.ok(permitidos.includes(it.id) && it.qtd >= 1);
    if (loot.itens.some(it => R.MISSOES.deposito_militar.raro.ids.includes(it.id))) raros++;
  }
  assert.ok(raros > 100 && raros < 200, `raros: ${raros}`); // ~30%
});

// ── Equilíbrio (nível 1, 3.000 combates por cenário) ──
const taxa = (fazerA, fazerB, n = 3000) => {
  let vitoriasA = 0;
  for (let s = 1; s <= n; s++) if (simularCombate(fazerA(), fazerB(), s).vencedor === 'A') vitoriasA++;
  return vitoriasA / n;
};
const novatoNu = () => R.statsLutador(combatente('novato'));
const novatoEquipado = () => R.statsLutador(combatente('novato', { arma: 'faca', cabeca: 'capacete' }));
const veteranoEquipado = () => R.statsLutador(combatente('veterano', { arma: 'lanca', cabeca: 'capacete_tatico' }));
const dois = f => () => [{ ...f(), id: 'x1' }, { ...f(), id: 'x2' }];

test('equilíbrio: 2 Novatos sem equipamento vencem o Acampamento em 75–95%', () => {
  const t = taxa(dois(novatoNu), () => R.gerarInimigos('acampamento', 1));
  assert.ok(t >= 0.75 && t <= 0.95, `taxa: ${t}`);
});

test('equilíbrio: 2 Novatos com faca e capacete vencem o Posto em 20–50%', () => {
  const t = taxa(dois(novatoEquipado), () => R.gerarInimigos('posto', 1));
  assert.ok(t >= 0.20 && t <= 0.50, `taxa: ${t}`);
});

test('equilíbrio: 2 Veteranos com lança e capacete tático vencem o Depósito militar em ≥ 80%', () => {
  const t = taxa(dois(veteranoEquipado), () => R.gerarInimigos('deposito_militar', 1));
  assert.ok(t >= 0.80, `taxa: ${t}`);
});

test('equilíbrio: 2 Novatos sem equipamento defendem a invasão em 75–95%', () => {
  const invasoresVencem = taxa(() => R.gerarInvasores(1), dois(novatoNu));
  const defesa = 1 - invasoresVencem;
  assert.ok(defesa >= 0.75 && defesa <= 0.95, `defesa: ${defesa}`);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/bando-regras.test.js`
Expected: FAIL com `Cannot find module '../bando-regras.js'`

- [ ] **Step 3: Implementar as regras**

Criar `bando-regras.js`:

```js
/**
 * ATÉ AMANHÃ — bando-regras.js
 * Regras puras do Bando e da identidade do Assentamento: tabelas e cálculos, sem acesso
 * ao estado do jogo. Roda no navegador (globais) e no Node (testes).
 */
(function (raiz) {
  'use strict';

  // XP acumulada necessária para chegar a cada nível (índice 0 = nível 1)
  const XP_NIVEIS = [0, 100, 250, 450, 700, 1000, 1350, 1750];
  const NIVEL_MAX = XP_NIVEIS.length;

  const XP_EVENTO = { moradia: 30, morador: 20, invasaoVitoria: 50, derrota: 10 };

  const CATEGORIAS = {
    novato:   { nome: 'Novato',   atq: 4, def: 2, vida: 40, preco: [15, 25], soldo: 5 },
    veterano: { nome: 'Veterano', atq: 6, def: 4, vida: 55, preco: [35, 50], soldo: 10 },
    elite:    { nome: 'Elite',    atq: 9, def: 6, vida: 70, preco: [70, 90], soldo: 15 },
  };

  // Valores de combate dos itens equipáveis que os combatentes podem usar
  const COMBATE_EQUIP = {
    faca:             { slot: 'arma',   atq: 3, def: 0 },
    arco:             { slot: 'arma',   atq: 4, def: 0 },
    lanca:            { slot: 'arma',   atq: 5, def: 0 },
    revolver:         { slot: 'arma',   atq: 5, def: 0 },
    machado:          { slot: 'arma',   atq: 8, def: 0 },
    capuz:            { slot: 'cabeca', atq: 0, def: 1 },
    capacete:         { slot: 'cabeca', atq: 0, def: 2 },
    capacete_tatico:  { slot: 'cabeca', atq: 0, def: 5 },
    jaqueta_couro:    { slot: 'peito',  atq: 0, def: 2 },
    colete:           { slot: 'peito',  atq: 0, def: 1 },
    colete_balistico: { slot: 'peito',  atq: 0, def: 7 },
  };
  const SLOTS_COMBATENTE = ['arma', 'cabeca', 'peito'];

  // Nomes por gênero do retrato (mesma convenção de CHARS_GENERO: 'M' mulher, 'H' homem)
  const NOMES_COMBATENTE = {
    M: ['Jana', 'Rita', 'Luíza', 'Kátia', 'Bia', 'Nalu', 'Tereza', 'Iara', 'Dora', 'Cida'],
    H: ['Bruno', 'Caio', 'Edson', 'Fábio', 'Gil', 'Hugo', 'Ivo', 'Jonas', 'Léo', 'Otávio'],
  };

  // Alvos de missão. Inimigos crescem a cada 2 níveis do assentamento (h = ⌊nível/2⌋).
  const MISSOES = {
    acampamento: {
      nome: 'Acampamento de saqueadores', icone: '⛺', inimigo: 'Saqueador',
      qtd: 2, atq: 4, def: 1, vida: 30, vidaPorNivel: 3, duracaoMin: 3, xp: 40, baterias: [10, 20],
      itens: [{ id: 'sucata', qtd: [2, 4] }, { id: 'madeira', qtd: [2, 4] }, { id: 'pano', qtd: [1, 3] }],
      sorteios: 2, raro: null,
    },
    posto: {
      nome: 'Posto de bandidos', icone: '🏚️', inimigo: 'Bandido',
      qtd: 3, atq: 5, def: 2, vida: 36, vidaPorNivel: 4, duracaoMin: 6, xp: 80, baterias: [20, 35],
      itens: [{ id: 'atadura', qtd: [1, 3] }, { id: 'remedio', qtd: [1, 2] }, { id: 'kit', qtd: [1, 1] }, { id: 'faca', qtd: [1, 1] }, { id: 'lanca', qtd: [1, 1] }],
      sorteios: 2, raro: null,
    },
    deposito_militar: {
      nome: 'Depósito militar abandonado', icone: '🎖️', inimigo: 'Mercenário',
      qtd: 4, atq: 6, def: 3, vida: 42, vidaPorNivel: 5, duracaoMin: 10, xp: 120, baterias: [35, 60],
      itens: [{ id: 'arame', qtd: [2, 4] }, { id: 'sucata', qtd: [3, 5] }, { id: 'kit', qtd: [1, 2] }],
      sorteios: 2,
      raro: { chance: 0.3, ids: ['capacete_tatico', 'colete_balistico', 'farda_militar', 'municao', 'radio_militar'] },
    },
  };

  const intEntre = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

  function nivelPorXp(xp) {
    let nivel = 1;
    for (let i = 1; i < XP_NIVEIS.length; i++) if (xp >= XP_NIVEIS[i]) nivel = i + 1;
    return nivel;
  }

  // XP acumulada para chegar ao próximo nível (null no nível máximo)
  function xpParaNivel(nivel) {
    return nivel >= NIVEL_MAX ? null : XP_NIVEIS[nivel];
  }

  function limiteBando(nivel) {
    return Math.min(8, 1 + nivel);
  }

  function sortearCategoria(rng) {
    const r = rng();
    return r < 0.60 ? 'novato' : r < 0.92 ? 'veterano' : 'elite';
  }

  // generoPorChar: mapa charId → 'M'|'H' (CHARS_GENERO do jogo)
  function gerarRecruta(rng, generoPorChar) {
    const charId = intEntre(rng, 1, 12);
    const nomes = NOMES_COMBATENTE[generoPorChar[charId] === 'M' ? 'M' : 'H'];
    const categoria = sortearCategoria(rng);
    const cat = CATEGORIAS[categoria];
    return {
      id: 'c' + intEntre(rng, 0, 2 ** 31).toString(36) + intEntre(rng, 0, 2 ** 31).toString(36),
      nome: nomes[intEntre(rng, 0, nomes.length - 1)],
      charId,
      categoria,
      atqBase: cat.atq,
      defBase: cat.def,
      vida: cat.vida,
      vidaMax: cat.vida,
      preco: intEntre(rng, cat.preco[0], cat.preco[1]),
    };
  }

  // Lutador para o motor de combate: atributos base + equipamento (+ bônus de defesa do assentamento)
  function statsLutador(c, bonusDef = 0) {
    let atq = c.atqBase, def = c.defBase + bonusDef;
    for (const slot of SLOTS_COMBATENTE) {
      const e = COMBATE_EQUIP[c.equip?.[slot]];
      if (e) { atq += e.atq; def += e.def; }
    }
    return { id: c.id, nome: c.nome, atq, def, vida: c.vida };
  }

  function gerarInimigos(tipo, nivel) {
    const m = MISSOES[tipo], h = Math.floor(nivel / 2);
    return Array.from({ length: m.qtd + h }, (_, i) => ({
      id: `${tipo}-${i + 1}`, nome: `${m.inimigo} ${i + 1}`,
      atq: m.atq + h, def: m.def + h, vida: m.vida + m.vidaPorNivel * nivel,
    }));
  }

  function gerarInvasores(nivel) {
    const h = Math.floor(nivel / 2);
    return Array.from({ length: 2 + h }, (_, i) => ({
      id: `invasor-${i + 1}`, nome: `Invasor ${i + 1}`,
      atq: 4 + h, def: 1 + h, vida: 30 + 3 * nivel,
    }));
  }

  function curaDiaria(temMedico, medicoNoPosto) {
    return medicoNoPosto ? 25 : temMedico ? 15 : 5;
  }

  function estadoAposCombate(vida, vidaMax) {
    if (vida <= 0) return 'morto';
    return vida < vidaMax * 0.3 ? 'ferido' : 'pronto';
  }

  function sortearLoot(tipo, rng) {
    const m = MISSOES[tipo];
    const itens = [];
    for (let i = 0; i < m.sorteios; i++) {
      const opcao = m.itens[intEntre(rng, 0, m.itens.length - 1)];
      const qtd = intEntre(rng, opcao.qtd[0], opcao.qtd[1]);
      const existente = itens.find(x => x.id === opcao.id);
      if (existente) existente.qtd += qtd;
      else itens.push({ id: opcao.id, qtd });
    }
    if (m.raro && rng() < m.raro.chance) itens.push({ id: m.raro.ids[intEntre(rng, 0, m.raro.ids.length - 1)], qtd: 1 });
    return { baterias: intEntre(rng, m.baterias[0], m.baterias[1]), itens };
  }

  const api = {
    XP_NIVEIS, NIVEL_MAX, XP_EVENTO, CATEGORIAS, COMBATE_EQUIP, SLOTS_COMBATENTE, NOMES_COMBATENTE, MISSOES,
    nivelPorXp, xpParaNivel, limiteBando, sortearCategoria, gerarRecruta, statsLutador,
    gerarInimigos, gerarInvasores, curaDiaria, estadoAposCombate, sortearLoot,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(raiz, api);
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/`
Expected: `# pass 19` e `# fail 0`. Se um teste de equilíbrio falhar, **não** mude o teste: revise se as fórmulas de `gerarInimigos`/`gerarInvasores` e a ordem de consumo do RNG em `simularCombate` estão exatamente como acima.

- [ ] **Step 5: Commit**

```bash
git add bando-regras.js tests/bando-regras.test.js
git commit -m "feat: regras do Bando (bando-regras.js) com testes de equilíbrio"
```

---

### Task 3: Módulo do Bando (estado, regras e telas)

**Files:**
- Create: `tests/bando.test.js`
- Create: `bando.js`

- [ ] **Step 1: Escrever os testes**

Criar `tests/bando.test.js` (carrega os três scripts num contexto `vm` com versões mínimas das funções do jogo):

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/bando.test.js`
Expected: FAIL com `ENOENT` ao ler `bando.js`

- [ ] **Step 3: Implementar `bando.js`**

Criar `bando.js`:

```js
/**
 * ATÉ AMANHÃ — bando.js
 * Identidade do Assentamento (nome, nível, XP, Ataque/Defesa) e o Bando: recrutamento,
 * soldo, equipamento, cura, missões e defesa contra invasões.
 * Depende de combate.js e bando-regras.js (carregados antes) e das funções globais de
 * script.js (estado, ITENS, SLOT_LABELS, CHARS_GENERO, charPath, esc, log, mostrarToast,
 * mostrarConfirmacao, salvarJogo, temItem, removerItem, adicionarItem, mudarBaterias,
 * capacidadeDeposito, moradores, npcAtivo, habCanonica, renderizarAssentamento,
 * atualizarBadgeAssentamento). Essas funções só são chamadas depois que tudo carregou.
 */
'use strict';

// ════════════════════════════════════════════════════════════
// DADOS, XP E PODER
// ════════════════════════════════════════════════════════════

// Garante os campos do Bando e da identidade (saves antigos e jogo novo)
function normalizarBando(assent, personagem) {
  if (!assent.nome) assent.nome = `Assentamento de ${personagem?.nome || 'Sobrevivente'}`;
  if (typeof assent.xp !== 'number') {
    // Saves antigos: XP pelo que já foi construído e acolhido
    const moradias = assent.parcelas.filter(Boolean).length;
    const habitantes = assent.parcelas.reduce((s, p) => s + (p?.habitantes?.filter(Boolean).length || 0), 0);
    assent.xp = moradias * XP_EVENTO.moradia + habitantes * XP_EVENTO.morador;
  }
  assent.nivel = nivelPorXp(assent.xp);
  if (!Array.isArray(assent.bando)) assent.bando = [];
  if (!assent.recrutas) assent.recrutas = { lista: [], dia: -99 };
  if (!assent.missoes) assent.missoes = { emAndamento: [], feitasHoje: [] };
  if (!Array.isArray(assent.relatorios)) assent.relatorios = [];
  return assent;
}

function ganharXpAssentamento(qtd) {
  const a = estado.assentamento;
  const antes = a.nivel;
  a.xp += qtd;
  a.nivel = nivelPorXp(a.xp);
  if (a.nivel > antes) {
    log(`🏘 ${a.nome} subiu para o nível ${a.nivel}! O Bando agora comporta ${limiteBando(a.nivel)} combatentes.`, 'log-sucesso');
    mostrarToast(`🏘 Assentamento nível ${a.nivel}!`, 3000);
  }
}

function combatentePorId(id) {
  return estado.assentamento.bando.find(c => c.id === id);
}

// Prontos para lutar: vivos, não feridos, fora de missão, sem soldo atrasado nem parados
function combatentesProntos() {
  return estado.assentamento.bando.filter(c => c.estado === 'pronto' && !c.soldoPendente);
}

// +1 por armadilha, +1 por morador Segurança ativo, +2 se houver Torre de Vigilância com Segurança
function bonusDefesaAssentamento() {
  const seguranca = moradores().filter(m => npcAtivo(m.npc) && m.npc.habilidade === 'seguranca');
  const torre = seguranca.some(m => m.parcela.tipo === 'torre_vigilancia');
  return (estado.seguranca?.armadilhasInstaladas || 0) + seguranca.length + (torre ? 2 : 0);
}

function poderAssentamento() {
  const bonus = bonusDefesaAssentamento();
  return combatentesProntos().reduce((p, c) => {
    const s = statsLutador(c, bonus);
    return { atq: p.atq + s.atq, def: p.def + s.def };
  }, { atq: 0, def: 0 });
}

function abaAssentamentoAberta() {
  return !!document.getElementById('aba-assentamento')?.classList.contains('ativa');
}

// Salva e redesenha a aba se estiver aberta (senão, só atualiza o "!" da aba)
function atualizarTelaAssentamento() {
  salvarJogo();
  if (abaAssentamentoAberta()) renderizarAssentamento();
  else atualizarBadgeAssentamento();
}

// Janela simples por cima do jogo; fecha no botão "Fechar" ou clicando fora
function abrirJanela(html, { largura = 420 } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal janela-bando';
  overlay.style.zIndex = '9000';
  overlay.innerHTML = `<div class="modal-conteudo janela-conteudo" style="max-width:${largura}px">${html}
    <div class="modal-acoes"><button class="btn-secundario btn-sm" data-fechar>Fechar</button></div></div>`;
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-fechar]')) overlay.remove();
  });
  document.body.appendChild(overlay);
  return overlay;
}

// ════════════════════════════════════════════════════════════
// IDENTIDADE (cabeçalho da aba Assentamento)
// ════════════════════════════════════════════════════════════

function renderizarIdentidadeAssentamento() {
  const el = document.getElementById('assent-identidade');
  if (!el) return;
  const a = estado.assentamento;
  const prox = xpParaNivel(a.nivel);
  const base = XP_NIVEIS[a.nivel - 1];
  const pct = prox ? Math.round((a.xp - base) / (prox - base) * 100) : 100;
  const poder = poderAssentamento();
  el.innerHTML = `
    <div class="ident-topo">
      <span class="ident-nome">🏘 ${esc(a.nome)}</span>
      <button class="ident-editar" id="ident-editar" title="Renomear o assentamento">✏️</button>
      <span class="ident-nivel">Nível ${a.nivel}</span>
    </div>
    <div class="ident-xp"><div class="ident-xp-fill" style="width:${pct}%"></div></div>
    <div class="ident-linha">
      <span class="ident-xp-txt">${prox ? `${a.xp} / ${prox} XP` : `${a.xp} XP · nível máximo`}</span>
      <span class="ident-poder" title="Soma dos combatentes prontos (a Defesa inclui os bônus do assentamento)">⚔️ ${poder.atq} &nbsp; 🛡️ ${poder.def}</span>
    </div>`;
  el.querySelector('#ident-editar').onclick = editarNomeAssentamento;
}

function editarNomeAssentamento() {
  const a = estado.assentamento;
  const j = abrirJanela(`<h3>Nome do assentamento</h3>
    <input id="ident-nome-input" class="janela-input" maxlength="24" value="${esc(a.nome)}">
    <div class="modal-acoes"><button class="btn-primario btn-sm" id="ident-nome-salvar">Salvar</button></div>`);
  const input = j.querySelector('#ident-nome-input');
  input.focus();
  input.select();
  const salvar = () => {
    const nome = input.value.trim().slice(0, 24);
    if (nome.length < 2) { mostrarToast('O nome precisa ter pelo menos 2 letras.'); return; }
    a.nome = nome;
    j.remove();
    log(`🏘 O assentamento agora se chama ${nome}.`, 'log-sistema');
    salvarJogo();
    renderizarIdentidadeAssentamento();
  };
  j.querySelector('#ident-nome-salvar').onclick = salvar;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') salvar(); });
}

// ════════════════════════════════════════════════════════════
// SUB-ABA BANDO — estrutura
// Cada parte se registra em SECOES_BANDO (ordem de exibição) e seus botões usam
// data-acao="..." tratados por ACOES_BANDO.
// ════════════════════════════════════════════════════════════

const SECOES_BANDO = [];
const ACOES_BANDO  = {};

function renderizarBando() {
  const painel = document.getElementById('bando-painel');
  if (!painel) return;
  painel.innerHTML = SECOES_BANDO.map(s => s.html()).join('');
  painel.onclick = e => {
    const el = e.target.closest('[data-acao]');
    if (el && !el.disabled && ACOES_BANDO[el.dataset.acao]) ACOES_BANDO[el.dataset.acao](el);
  };
}

// ════════════════════════════════════════════════════════════
// COMBATENTES, MURAL DE RECRUTAS E SOLDO
// ════════════════════════════════════════════════════════════

const MURAL_DIAS = 3;
const DIAS_SOLDO = 5;
const ESTADO_COMBATENTE = {
  pronto: ['🟢', 'Pronto'],
  ferido: ['🩸', 'Ferido'],
  missao: ['🚶', 'Em missão'],
  parado: ['⛔', 'Parado'],
};

function garantirMural() {
  const r = estado.assentamento.recrutas;
  if (r.lista.length && estado.dia - r.dia < MURAL_DIAS) return;
  r.lista = Array.from({ length: 3 }, () => gerarRecruta(Math.random, CHARS_GENERO));
  r.dia = estado.dia;
}

function htmlCombatente(c) {
  const cat = CATEGORIAS[c.categoria];
  const s = statsLutador(c);
  const pctVida = Math.round(c.vida / c.vidaMax * 100);
  const [icone, texto] = c.soldoPendente ? ['🔋', 'Cobrando soldo'] : ESTADO_COMBATENTE[c.estado];
  const emMissao = c.estado === 'missao';
  const slots = SLOTS_COMBATENTE.map(slot => {
    const it = c.equip[slot] && ITENS[c.equip[slot]];
    return `<button class="comb-slot" data-acao="equipar" data-id="${c.id}" data-slot="${slot}" ${emMissao ? 'disabled' : ''}>${it ? `${it.icone} ${esc(it.nome)}` : `+ ${SLOT_LABELS[slot]}`}</button>`;
  }).join('');
  let acoes = '';
  if (c.soldoPendente) {
    acoes = `<button class="btn-primario btn-sm" data-acao="pagar-soldo" data-id="${c.id}" ${temItem('pilha', c.soldoPendente) ? '' : 'disabled'}>🔋 Pagar soldo (${c.soldoPendente})</button>
      <button class="btn-secundario btn-sm" data-acao="recusar-soldo" data-id="${c.id}">Recusar</button>`;
  } else if (c.estado === 'parado') {
    acoes = `<button class="btn-primario btn-sm" data-acao="reativar" data-id="${c.id}" ${temItem('pilha', c.divida) ? '' : 'disabled'}>🔋 Pagar e reativar (${c.divida})</button>`;
  }
  return `
    <div class="comb-card${c.estado === 'ferido' ? ' comb-ferido' : ''}">
      <div class="comb-topo">
        <img src="${charPath(c.charId)}" class="comb-avatar" alt="">
        <div class="comb-info">
          <span class="comb-nome">${esc(c.nome)} <span class="comb-cat comb-cat-${c.categoria}">${cat.nome}</span></span>
          <span class="comb-estado">${icone} ${texto} · ⚔️ ${s.atq} 🛡️ ${s.def}</span>
        </div>
      </div>
      <div class="comb-vida" title="${c.vida} / ${c.vidaMax} de vida"><div class="comb-vida-fill" style="width:${pctVida}%"></div></div>
      <span class="comb-vida-txt">❤️ ${c.vida} / ${c.vidaMax}</span>
      <div class="comb-slots">${slots}</div>
      <div class="comb-acoes">
        ${acoes}
        <button class="btn-secundario btn-sm" data-acao="curar" data-id="${c.id}" ${c.vida >= c.vidaMax || emMissao ? 'disabled' : ''}>🩹 Curar</button>
        <button class="btn-secundario btn-sm comb-dispensar" data-acao="dispensar" data-id="${c.id}" ${emMissao ? 'disabled' : ''}>Dispensar</button>
      </div>
    </div>`;
}

SECOES_BANDO.push({
  html() {
    const a = estado.assentamento;
    const cards = a.bando.length
      ? a.bando.map(htmlCombatente).join('')
      : '<p class="bando-vazio">Nenhum combatente ainda. Contrate no mural abaixo.</p>';
    return `<div class="sec-bloco bando-secao">
      <h4 class="trab-secao-titulo">⚔️ Seu Bando <span class="bando-cont">${a.bando.length}/${limiteBando(a.nivel)}</span></h4>
      <div class="bando-grid">${cards}</div>
    </div>`;
  },
});

SECOES_BANDO.push({
  html() {
    garantirMural();
    const r = estado.assentamento.recrutas;
    const cards = r.lista.length ? r.lista.map((rec, i) => {
      const cat = CATEGORIAS[rec.categoria];
      return `<div class="recruta-card">
        <img src="${charPath(rec.charId)}" class="comb-avatar" alt="">
        <div class="comb-info">
          <span class="comb-nome">${esc(rec.nome)} <span class="comb-cat comb-cat-${rec.categoria}">${cat.nome}</span></span>
          <span class="comb-estado">⚔️ ${rec.atqBase} 🛡️ ${rec.defBase} ❤️ ${rec.vidaMax} · soldo ${cat.soldo} 🔋 a cada ${DIAS_SOLDO} dias</span>
        </div>
        <button class="btn-primario btn-sm" data-acao="contratar" data-idx="${i}" ${temItem('pilha', rec.preco) ? '' : 'disabled'}>Contratar · ${rec.preco} 🔋</button>
      </div>`;
    }).join('') : '<p class="bando-vazio">Nenhum recruta no momento.</p>';
    return `<div class="sec-bloco bando-secao">
      <h4 class="trab-secao-titulo">📜 Mural de recrutas <span class="bando-cont">renova no dia ${r.dia + MURAL_DIAS}</span></h4>
      <div class="bando-lista">${cards}</div>
    </div>`;
  },
});

function contratarRecruta(idx) {
  const a = estado.assentamento, rec = a.recrutas.lista[idx];
  if (!rec) return;
  const limite = limiteBando(a.nivel);
  if (a.bando.length >= limite) { mostrarToast(`⚔️ Bando cheio (${limite}). Suba o nível do assentamento.`); return; }
  if (!temItem('pilha', rec.preco)) { mostrarToast(`🔋 Precisa de ${rec.preco} Baterias.`); return; }
  removerItem('pilha', rec.preco);
  a.bando.push({
    id: rec.id, nome: rec.nome, charId: rec.charId, categoria: rec.categoria,
    atqBase: rec.atqBase, defBase: rec.defBase, vida: rec.vida, vidaMax: rec.vidaMax,
    equip: { arma: null, cabeca: null, peito: null },
    estado: 'pronto', diaSoldo: estado.dia + DIAS_SOLDO, soldoPendente: null, divida: null,
  });
  a.recrutas.lista.splice(idx, 1);
  log(`⚔️ ${rec.nome} (${CATEGORIAS[rec.categoria].nome}) entrou para o Bando por ${rec.preco} 🔋.`, 'log-sucesso');
  mostrarToast(`⚔️ ${rec.nome} contratado!`);
  atualizarTelaAssentamento();
}

function dispensarCombatente(id) {
  const c = combatentePorId(id);
  if (!c || c.estado === 'missao') return;
  mostrarConfirmacao(`Dispensar ${esc(c.nome)} do Bando?<br><br>O equipamento volta para a mochila.`, () => {
    for (const slot of SLOTS_COMBATENTE) if (c.equip[slot]) adicionarItem(ITENS[c.equip[slot]], 1, { forcar: true });
    estado.assentamento.bando = estado.assentamento.bando.filter(x => x.id !== id);
    log(`🚪 ${c.nome} deixou o Bando.`, 'log-sistema');
    atualizarTelaAssentamento();
  }, null, { labelSim: 'Dispensar', labelNao: 'Cancelar' });
}

function pagarSoldo(id) {
  const c = combatentePorId(id);
  if (!c?.soldoPendente) return;
  if (!temItem('pilha', c.soldoPendente)) { mostrarToast(`🔋 Precisa de ${c.soldoPendente} Baterias.`); return; }
  removerItem('pilha', c.soldoPendente);
  log(`🔋 Você pagou ${c.soldoPendente} Baterias de soldo a ${c.nome}.`, 'log-sucesso');
  c.soldoPendente = null;
  c.diaSoldo = estado.dia + DIAS_SOLDO;
  atualizarTelaAssentamento();
}

function recusarSoldo(id) {
  const c = combatentePorId(id);
  if (!c?.soldoPendente) return;
  c.divida = c.soldoPendente;
  c.soldoPendente = null;
  c.estado = 'parado';
  log(`⛔ ${c.nome} parou de lutar por falta de soldo.`, 'log-alerta');
  atualizarTelaAssentamento();
}

function reativarCombatente(id) {
  const c = combatentePorId(id);
  if (c?.estado !== 'parado') return;
  if (!temItem('pilha', c.divida)) { mostrarToast(`🔋 Precisa de ${c.divida} Baterias.`); return; }
  removerItem('pilha', c.divida);
  log(`🔋 Você pagou ${c.divida} Baterias. ${c.nome} voltou ao Bando.`, 'log-sucesso');
  c.divida = null;
  c.estado = estadoAposCombate(c.vida, c.vidaMax) === 'ferido' ? 'ferido' : 'pronto';
  c.diaSoldo = estado.dia + DIAS_SOLDO;
  atualizarTelaAssentamento();
}

ACOES_BANDO['contratar']     = el => contratarRecruta(parseInt(el.dataset.idx));
ACOES_BANDO['dispensar']     = el => dispensarCombatente(el.dataset.id);
ACOES_BANDO['pagar-soldo']   = el => pagarSoldo(el.dataset.id);
ACOES_BANDO['recusar-soldo'] = el => recusarSoldo(el.dataset.id);
ACOES_BANDO['reativar']      = el => reativarCombatente(el.dataset.id);

// ════════════════════════════════════════════════════════════
// EQUIPAMENTO E CURA COM ITENS
// ════════════════════════════════════════════════════════════

function abrirEquipCombatente(id, slot) {
  const c = combatentePorId(id);
  if (!c || c.estado === 'missao') return;
  const opcoes = Object.entries(COMBATE_EQUIP).filter(([itemId, e]) => e.slot === slot && temItem(itemId));
  const atual = c.equip[slot];
  const lista = opcoes.length
    ? opcoes.map(([itemId, e]) => `<button class="btn-secundario btn-sm janela-opcao" data-item="${itemId}">${ITENS[itemId].icone} ${esc(ITENS[itemId].nome)} <span class="janela-dim">${e.atq ? `+${e.atq} ⚔️` : `+${e.def} 🛡️`}</span></button>`).join('')
    : `<p class="janela-dim">Nenhum item para ${SLOT_LABELS[slot].toLowerCase()} na mochila ou no depósito.</p>`;
  const j = abrirJanela(`<h3>${esc(c.nome)} · ${SLOT_LABELS[slot]}</h3>
    ${atual ? `<p>Equipado: ${ITENS[atual].icone} ${esc(ITENS[atual].nome)} <button class="btn-perigo btn-sm" data-remover>Remover</button></p>` : ''}
    <div class="janela-lista">${lista}</div>`);
  j.querySelectorAll('[data-item]').forEach(b => {
    b.onclick = () => { equiparCombatente(c, slot, b.dataset.item); j.remove(); };
  });
  j.querySelector('[data-remover]')?.addEventListener('click', () => { desequiparCombatente(c, slot); j.remove(); });
}

function equiparCombatente(c, slot, itemId) {
  if (!temItem(itemId, 1)) return;
  removerItem(itemId, 1);
  if (c.equip[slot]) adicionarItem(ITENS[c.equip[slot]], 1, { forcar: true });
  c.equip[slot] = itemId;
  log(`⚔️ ${c.nome} equipou ${ITENS[itemId].icone} ${ITENS[itemId].nome}.`, 'log-sistema');
  atualizarTelaAssentamento();
}

function desequiparCombatente(c, slot) {
  const itemId = c.equip[slot];
  if (!itemId) return;
  adicionarItem(ITENS[itemId], 1, { forcar: true });
  c.equip[slot] = null;
  atualizarTelaAssentamento();
}

function abrirCuraCombatente(id) {
  const c = combatentePorId(id);
  if (!c || c.estado === 'missao') return;
  const ids = [...new Set([...estado.inventario, ...estado.deposito.itens].map(i => i.id))]
    .filter(itemId => ITENS[itemId]?.tipo === 'medicinal' && (ITENS[itemId].efeitos?.vida || 0) > 0);
  const lista = ids.length
    ? ids.map(itemId => `<button class="btn-secundario btn-sm janela-opcao" data-item="${itemId}">${ITENS[itemId].icone} ${esc(ITENS[itemId].nome)} <span class="janela-dim">+${ITENS[itemId].efeitos.vida} ❤️</span></button>`).join('')
    : '<p class="janela-dim">Nenhum item de cura na mochila ou no depósito.</p>';
  const j = abrirJanela(`<h3>Curar ${esc(c.nome)}</h3><p class="janela-dim">Vida: ${c.vida} / ${c.vidaMax}</p><div class="janela-lista">${lista}</div>`);
  j.querySelectorAll('[data-item]').forEach(b => {
    b.onclick = () => { curarCombatenteComItem(c, b.dataset.item); j.remove(); };
  });
}

function curarCombatenteComItem(c, itemId) {
  if (!temItem(itemId, 1)) return;
  removerItem(itemId, 1);
  const antes = c.vida;
  c.vida = Math.min(c.vidaMax, c.vida + ITENS[itemId].efeitos.vida);
  if (c.estado === 'ferido' && estadoAposCombate(c.vida, c.vidaMax) === 'pronto') c.estado = 'pronto';
  log(`🩹 ${c.nome} recebeu ${ITENS[itemId].nome}: +${c.vida - antes} de vida.`, 'log-sucesso');
  atualizarTelaAssentamento();
}

ACOES_BANDO['equipar'] = el => abrirEquipCombatente(el.dataset.id, el.dataset.slot);
ACOES_BANDO['curar']   = el => abrirCuraCombatente(el.dataset.id);

// ════════════════════════════════════════════════════════════
// ROTINA DIÁRIA (chamada em avancarDia)
// ════════════════════════════════════════════════════════════

function rotinaDiariaBando() {
  const a = estado.assentamento;
  if (!a?.bando) return;

  // Soldo: cobra a cada DIAS_SOLDO dias (quem está em missão é cobrado depois que voltar)
  for (const c of a.bando) {
    if (c.estado === 'parado' || c.estado === 'missao' || c.soldoPendente) continue;
    if (estado.dia >= c.diaSoldo) {
      c.soldoPendente = CATEGORIAS[c.categoria].soldo;
      log(`🔋 ${c.nome} cobra o soldo: ${c.soldoPendente} Baterias.`, 'log-alerta');
    }
  }

  // Cura: sozinho, com Médico ou com Médico no Posto Médico
  const medicos = moradores().filter(m => npcAtivo(m.npc) && habCanonica(m.npc.habilidade) === 'medico');
  const cura = curaDiaria(medicos.length > 0, medicos.some(m => m.parcela.tipo === 'posto_medico'));
  for (const c of a.bando) {
    if (c.estado === 'missao' || c.vida >= c.vidaMax) continue;
    c.vida = Math.min(c.vidaMax, c.vida + cura);
    if (c.estado === 'ferido' && estadoAposCombate(c.vida, c.vidaMax) === 'pronto') {
      c.estado = 'pronto';
      log(`🩹 ${c.nome} se recuperou e voltou ao Bando.`, 'log-sucesso');
    }
  }

  a.missoes.feitasHoje = [];
  garantirMural();
}

// ════════════════════════════════════════════════════════════
// RESULTADO DE COMBATE, LOOT E RELATÓRIOS
// ════════════════════════════════════════════════════════════

const RELATORIOS_MAX = 5;

// Aplica as vidas finais do lado do Bando; mortos saem do Bando com o equipamento
function aplicarResultadoCombate(res, lado) {
  const a = estado.assentamento;
  const mortos = [], feridos = [], idsMortos = [];
  for (const l of res.lutadores) {
    if (l.lado !== lado) continue;
    const c = combatentePorId(l.id);
    if (!c) continue;
    c.vida = l.vida;
    const est = estadoAposCombate(c.vida, c.vidaMax);
    if (est === 'morto') { mortos.push(c.nome); idsMortos.push(c.id); continue; }
    if (est === 'ferido') feridos.push(c.nome);
    if (c.estado !== 'parado') c.estado = est;
  }
  a.bando = a.bando.filter(c => !idsMortos.includes(c.id));
  return { mortos, feridos };
}

function guardarLootNoDeposito(base, qtd) {
  const dep = estado.deposito;
  if (!dep.nivel) return false;
  const existente = dep.itens.find(i => i.id === base.id);
  if (existente) { existente.qtd += qtd; return true; }
  if (dep.itens.length >= capacidadeDeposito()) return false;
  dep.itens.push({ ...base, qtd });
  return true;
}

// Baterias vão para a carteira; itens para o Depósito (ou mochila, se não couber)
function entregarLoot(loot) {
  if (loot.baterias) mudarBaterias(loot.baterias);
  for (const { id, qtd } of loot.itens) {
    const base = ITENS[id];
    if (!base) continue;
    if (!guardarLootNoDeposito(base, qtd)) adicionarItem(base, qtd, { forcar: true });
  }
}

function descreverLoot(loot) {
  return [`${loot.baterias} 🔋`, ...loot.itens.map(i => `${ITENS[i.id]?.icone || ''} ${ITENS[i.id]?.nome || i.id} ×${i.qtd}`)].join(', ');
}

function registrarRelatorio(rel) {
  const lista = estado.assentamento.relatorios;
  lista.unshift(rel);
  if (lista.length > RELATORIOS_MAX) lista.length = RELATORIOS_MAX;
}

function abrirRelatorio(rel) {
  const baixas = [
    rel.baixas.mortos.length ? `💀 Mortos: ${rel.baixas.mortos.map(esc).join(', ')}` : '',
    rel.baixas.feridos.length ? `🩸 Feridos: ${rel.baixas.feridos.map(esc).join(', ')}` : '',
  ].filter(Boolean).join('<br>');
  abrirJanela(`<h3>${rel.titulo}</h3>
    <p class="rel-resultado ${rel.venceu ? 'rel-vitoria' : 'rel-derrota'}">${rel.venceu ? '🏆 Vitória' : '☠️ Derrota'} · Dia ${rel.dia}</p>
    <p>${esc(rel.resumo)}</p>
    ${baixas ? `<p>${baixas}</p>` : ''}
    <div class="rel-linhas">${rel.linhas.map(l => `<div class="${l.startsWith('—') ? 'rel-rodada' : ''}">${esc(l)}</div>`).join('')}</div>`,
    { largura: 520 });
}

// ════════════════════════════════════════════════════════════
// MISSÕES
// ════════════════════════════════════════════════════════════

SECOES_BANDO.push({
  html() {
    const a = estado.assentamento;
    const temProntos = combatentesProntos().length > 0;
    const cards = Object.entries(MISSOES).map(([tipo, m]) => {
      const andamento = a.missoes.emAndamento.find(x => x.tipo === tipo);
      const inimigos = gerarInimigos(tipo, a.nivel), i0 = inimigos[0];
      let rodape;
      if (andamento) {
        const hora = new Date(andamento.fim).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const nomes = andamento.membros.map(id => combatentePorId(id)?.nome).filter(Boolean).map(esc).join(', ');
        rodape = `<span class="missao-status">🚶 ${nomes} · volta às ${hora}</span>`;
      } else if (a.missoes.feitasHoje.includes(tipo)) {
        rodape = '<span class="missao-status janela-dim">✔ Já feita hoje. Volta amanhã.</span>';
      } else {
        rodape = `<button class="btn-primario btn-sm" data-acao="missao" data-tipo="${tipo}" ${temProntos ? '' : 'disabled'}>Enviar Bando</button>`;
      }
      return `<div class="missao-card">
        <span class="missao-nome">${m.icone} ${m.nome}</span>
        <span class="missao-info">${inimigos.length}× ${m.inimigo} (⚔️ ${i0.atq} 🛡️ ${i0.def} ❤️ ${i0.vida}) · ⏱ ${m.duracaoMin} min</span>
        <span class="missao-info">Recompensa: ${m.baterias[0]}–${m.baterias[1]} 🔋, itens${m.raro ? ', chance de item raro' : ''} · +${m.xp} XP</span>
        ${rodape}
      </div>`;
    }).join('');
    return `<div class="sec-bloco bando-secao">
      <h4 class="trab-secao-titulo">🗺️ Missões</h4>
      <div class="bando-lista">${cards}</div>
    </div>`;
  },
});

function abrirEnvioMissao(tipo) {
  const m = MISSOES[tipo], prontos = combatentesProntos();
  if (!prontos.length) { mostrarToast('Nenhum combatente pronto.'); return; }
  const lista = prontos.map(c => {
    const s = statsLutador(c);
    return `<label class="janela-check"><input type="checkbox" value="${c.id}" checked> ${esc(c.nome)} <span class="janela-dim">⚔️ ${s.atq} 🛡️ ${s.def} ❤️ ${c.vida}</span></label>`;
  }).join('');
  const j = abrirJanela(`<h3>${m.icone} ${m.nome}</h3>
    <p class="janela-dim">Escolha quem vai. Quem morrer em combate é perdido junto com o equipamento.</p>
    <div class="janela-lista">${lista}</div>
    <div class="modal-acoes"><button class="btn-primario btn-sm" data-partir>Partir</button></div>`);
  j.querySelector('[data-partir]').onclick = () => {
    const ids = [...j.querySelectorAll('input:checked')].map(i => i.value);
    if (!ids.length) { mostrarToast('Escolha pelo menos um combatente.'); return; }
    iniciarMissao(tipo, ids);
    j.remove();
  };
}

function iniciarMissao(tipo, ids) {
  const a = estado.assentamento, m = MISSOES[tipo];
  if (a.missoes.feitasHoje.includes(tipo) || a.missoes.emAndamento.some(x => x.tipo === tipo)) return;
  const agora = Date.now();
  for (const c of a.bando) if (ids.includes(c.id)) c.estado = 'missao';
  a.missoes.emAndamento.push({
    id: 'm' + agora.toString(36), tipo, membros: ids, nivel: a.nivel,
    fim: agora + m.duracaoMin * 60000, semente: (agora % 2147483647) || 1,
  });
  a.missoes.feitasHoje.push(tipo);
  log(`🗺️ ${ids.length} combatente(s) partiram para ${m.nome}. Voltam em ${m.duracaoMin} min.`, 'log-sistema');
  atualizarTelaAssentamento();
}

// Chamada a cada segundo (atualizarStatus) e funciona também ao voltar com o jogo fechado
function verificarMissoesConcluidas() {
  const a = estado.assentamento;
  if (!a?.missoes?.emAndamento?.length) return;
  const agora = Date.now();
  const prontas = a.missoes.emAndamento.filter(m => agora >= m.fim);
  if (!prontas.length) return;
  a.missoes.emAndamento = a.missoes.emAndamento.filter(m => agora < m.fim);
  for (const m of prontas) resolverMissao(m);
  atualizarTelaAssentamento();
}

function resolverMissao(m) {
  const cfg = MISSOES[m.tipo];
  const membros = estado.assentamento.bando.filter(c => m.membros.includes(c.id));
  const res = simularCombate(membros.map(c => statsLutador(c)), gerarInimigos(m.tipo, m.nivel), m.semente);
  const baixas = aplicarResultadoCombate(res, 'A');
  const venceu = res.vencedor === 'A';
  let resumo;
  if (venceu) {
    const loot = sortearLoot(m.tipo, criarRng(m.semente + 1));
    entregarLoot(loot);
    ganharXpAssentamento(cfg.xp);
    resumo = `Saque: ${descreverLoot(loot)} · +${cfg.xp} XP`;
  } else {
    ganharXpAssentamento(XP_EVENTO.derrota);
    resumo = `O Bando recuou sem nada. +${XP_EVENTO.derrota} XP`;
  }
  const rel = { titulo: `${cfg.icone} ${cfg.nome}`, venceu, dia: estado.dia, resumo, baixas, linhas: res.relatorio };
  registrarRelatorio(rel);
  log(`${venceu ? '🏆' : '☠️'} Missão ${cfg.nome}: ${venceu ? 'vitória' : 'derrota'}.${baixas.mortos.length ? ` Mortos: ${baixas.mortos.join(', ')}.` : ''}`, venceu ? 'log-sucesso' : 'log-perigo');
  if (!document.hidden) abrirRelatorio(rel);
}

ACOES_BANDO['missao'] = el => abrirEnvioMissao(el.dataset.tipo);

// ════════════════════════════════════════════════════════════
// DEFESA CONTRA INVASÕES (chamada em processarSaqueNoturno)
// Retorna true (Bando venceu: nada é roubado), false (perdeu) ou null (sem defensores).
// ════════════════════════════════════════════════════════════

function defenderInvasao() {
  const a = estado.assentamento;
  if (!a?.bando) return null;
  const defensores = combatentesProntos();
  if (!defensores.length) return null;
  const bonus = bonusDefesaAssentamento();
  const res = simularCombate(gerarInvasores(a.nivel), defensores.map(c => statsLutador(c, bonus)), (Date.now() % 2147483647) || 1);
  const baixas = aplicarResultadoCombate(res, 'B');
  const venceu = res.vencedor === 'B';
  ganharXpAssentamento(venceu ? XP_EVENTO.invasaoVitoria : XP_EVENTO.derrota);
  const resumo = venceu
    ? `O Bando expulsou os invasores. Nada foi roubado. +${XP_EVENTO.invasaoVitoria} XP`
    : `Os invasores passaram pelo Bando e saquearam o depósito. +${XP_EVENTO.derrota} XP`;
  registrarRelatorio({ titulo: '🌙 Invasão noturna', venceu, dia: estado.dia, resumo, baixas, linhas: res.relatorio });
  log(venceu ? `⚔️ Invasores atacaram ${a.nome}, mas o Bando os expulsou!` : `⚔️ Invasores venceram o Bando de ${a.nome}.`, venceu ? 'log-sucesso' : 'log-perigo');
  if (baixas.mortos.length) log(`💀 Mortos na defesa: ${baixas.mortos.join(', ')}.`, 'log-perigo');
  mostrarToast(venceu ? '⚔️ O Bando defendeu o assentamento!' : '⚔️ O Bando perdeu a defesa!', 3000);
  atualizarTelaAssentamento();
  return venceu;
}

// ════════════════════════════════════════════════════════════
// RELATÓRIOS (última seção da sub-aba)
// ════════════════════════════════════════════════════════════

SECOES_BANDO.push({
  html() {
    const rs = estado.assentamento.relatorios;
    if (!rs.length) return '';
    return `<div class="sec-bloco bando-secao">
      <h4 class="trab-secao-titulo">📋 Últimos combates</h4>
      <div class="bando-lista">${rs.map((r, i) => `<button class="rel-item" data-acao="relatorio" data-idx="${i}">${r.venceu ? '🏆' : '☠️'} ${r.titulo} · Dia ${r.dia}</button>`).join('')}</div>
    </div>`;
  },
});

ACOES_BANDO['relatorio'] = el => {
  const rel = estado.assentamento.relatorios[parseInt(el.dataset.idx)];
  if (rel) abrirRelatorio(rel);
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/` e `node --check bando.js`
Expected: `# pass 26`, `# fail 0` e nenhuma saída do `--check`

- [ ] **Step 5: Commit**

```bash
git add bando.js tests/bando.test.js
git commit -m "feat: módulo do Bando (recrutamento, soldo, equipamento, cura, missões, defesa)"
```

---

### Task 4: Ligar o Bando ao jogo (script.js e scripts no index.html)

**Files:**
- Modify: `index.html` (tags `<script>` no fim do `<body>`)
- Modify: `script.js` (8 pontos)

- [ ] **Step 1: Carregar os scripts antes do `script.js`**

Em `index.html`, trocar:

```html
  <script src="script.js"></script>
```

por:

```html
  <script src="combate.js"></script>
  <script src="bando-regras.js"></script>
  <script src="bando.js"></script>
  <script src="script.js"></script>
```

- [ ] **Step 2: Normalizar os dados ao carregar e ao criar personagem**

Em `script.js`, `aplicarDadosSave`, logo após a linha:

```js
  estado.assentamento.parcelas = estado.assentamento.parcelas.map(normalizarParcela);
```

adicionar:

```js
  normalizarBando(estado.assentamento, estado.personagem);
```

Em `iniciarJogo`, logo após a linha:

```js
  estado.assentamento       = { parcelas: [null, null, null, null], npcPendente: null, ultimoEventoNpc: 0 };
```

adicionar:

```js
  normalizarBando(estado.assentamento, estado.personagem);
```

- [ ] **Step 3: Rotina diária, laço de tempo e saque noturno**

Em `avancarDia`, logo após `  verificarPagamentosNpc();` adicionar:

```js
  rotinaDiariaBando();
```

Em `atualizarStatus`, logo antes de `  // ── Relógio ──` adicionar:

```js
  // Missões do Bando que terminaram (usa hora real; resolve também ao voltar com o jogo fechado)
  verificarMissoesConcluidas();
```

Em `processarSaqueNoturno`, logo antes de `  // ── SAQUE ACONTECE — roba do depósito ──` adicionar:

```js
  // O Bando defende antes do saque: vitória = nada é roubado (ver bando.js)
  if (defenderInvasao() === true) { atualizarDefesaUI(); return; }
```

- [ ] **Step 4: XP ao construir moradia e acolher morador**

Em `renderizarAssentamento`, no handler de construir, logo após a linha que começa com `log(\`🏘 Construiu ${est.icone} ${est.nome} na Parcela` adicionar:

```js
      ganharXpAssentamento(XP_EVENTO.moradia);
```

No handler de aceitar morador, logo após a linha que começa com `log(\`🏘 ${npc.nome} foi aceito e se mudou` adicionar:

```js
      ganharXpAssentamento(XP_EVENTO.morador);
```

- [ ] **Step 5: Desenhar identidade e Bando junto com o Assentamento**

Em `renderizarAssentamento`, logo após:

```js
  const container = document.getElementById('assent-parcelas');
  if (!container) return;
```

adicionar:

```js
  renderizarIdentidadeAssentamento();
  renderizarBando();
```

- [ ] **Step 6: Aviso "!" na aba também para soldo do Bando**

Em `atualizarBadgeAssentamento`, trocar:

```js
    || moradores().some(m => m.npc.pagamentoPendente);
```

por:

```js
    || moradores().some(m => m.npc.pagamentoPendente)
    || (estado.assentamento?.bando || []).some(c => c.soldoPendente);
```

- [ ] **Step 7: Pedir o nome ao desbloquear**

Em `verificarAssentamento`, logo após a linha:

```js
    log('🏘 Assentamento desbloqueado! Sua reputação como Líder abre novas possibilidades.', 'log-sucesso');
```

adicionar:

```js
    log('✏️ Dê um nome ao seu assentamento: aba Assentamento, botão ✏️ ao lado do nome.', 'log-info');
```

- [ ] **Step 8: Verificar**

Run: `node --check script.js && node --test tests/ && grep -c $'\x08' script.js`
Expected: sem erros de sintaxe, `# pass 26`, e `0`

- [ ] **Step 9: Commit**

```bash
git add index.html script.js
git commit -m "feat: integrar o Bando ao jogo (save, dia, missões, invasão, XP)"
```

---

### Task 5: Aba Assentamento (identidade e sub-abas) e estilos

**Files:**
- Modify: `index.html` (conteúdo de `#aba-assentamento`)
- Modify: `style.css` (fim do arquivo)

- [ ] **Step 1: Trocar o conteúdo da aba**

Em `index.html`, substituir todo o bloco entre `<div class="aba-conteudo" id="aba-assentamento">` e `</div><!-- fim aba assentamento -->` por:

```html
          <div class="aba-conteudo" id="aba-assentamento">

            <!-- Identidade: nome, nível, XP, Ataque e Defesa (desenhada por bando.js) -->
            <div id="assent-identidade" class="assent-identidade sec-bloco"></div>

            <nav class="sub-abas-nav">
              <button class="sub-aba-btn ativa" data-sub="sub-assent-moradores">🏘 Moradores</button>
              <button class="sub-aba-btn" data-sub="sub-assent-bando">⚔️ Bando</button>
            </nav>

            <!-- Sub-aba: Moradores (conteúdo de antes) -->
            <div class="sub-aba-painel" id="sub-assent-moradores">
              <div class="sec-bloco">
                <h4 class="trab-secao-titulo">🏗 Parcelas de Construção</h4>
                <div id="assent-parcelas" class="assent-grid"></div>
              </div>

              <div class="assent-footer sec-bloco" style="font-size:.72rem;color:var(--text-dim);font-style:italic">
                Sobreviventes aparecem pedindo abrigo ao longo dos dias. Aceite-os para que trabalhem pelo assentamento.
              </div>
            </div>

            <!-- Sub-aba: Bando (desenhada por bando.js) -->
            <div class="sub-aba-painel oculto" id="sub-assent-bando">
              <div id="bando-painel" class="bando-painel"></div>
            </div>

          </div><!-- fim aba assentamento -->
```

- [ ] **Step 2: Estilos**

Adicionar ao fim de `style.css`:

```css
/* ══════════════════════════════════════════════════════
   IDENTIDADE DO ASSENTAMENTO E BANDO (bando.js)
══════════════════════════════════════════════════════ */
.assent-identidade { gap: 6px; }
.ident-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ident-nome { font-size: 1.15rem; font-weight: 700; color: var(--text-pri); }
.ident-editar {
  background: none; border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; padding: 0 6px; font-size: .8rem;
}
.ident-editar:hover { border-color: var(--accent); }
.ident-nivel {
  margin-left: auto; font-family: var(--font-mono); font-size: .8rem; color: #e2b44c;
  border: 1px solid #5e4a1c; border-radius: var(--radius); padding: 1px 8px;
}
.ident-xp { height: 6px; background: var(--bg-0); border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
.ident-xp-fill { height: 100%; background: #e2b44c; transition: width .4s ease; }
.ident-linha {
  display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  font-family: var(--font-mono); font-size: .75rem; color: var(--text-sec);
}
.ident-poder { color: var(--text-pri); }

.bando-painel { display: flex; flex-direction: column; gap: 14px; }
.bando-secao { gap: 8px; }
.bando-cont { font-family: var(--font-mono); font-size: .7rem; color: var(--text-dim); font-weight: 400; margin-left: 6px; }
.bando-vazio { font-size: .85rem; color: var(--text-dim); font-style: italic; }
.bando-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.bando-lista { display: grid; gap: 6px; }

.comb-card {
  display: grid; gap: 5px; padding: 8px;
  background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius);
}
.comb-ferido { border-color: #6a2a2a; }
.comb-topo { display: flex; gap: 8px; align-items: center; }
.recruta-card {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 6px 8px;
  background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius);
}
.recruta-card .btn-primario { margin-left: auto; }
.comb-avatar {
  width: 38px; height: 38px; object-fit: cover; flex-shrink: 0;
  border-radius: var(--radius); border: 1px solid var(--border-hi);
}
.comb-info { display: grid; min-width: 0; }
.comb-nome { font-weight: 700; font-size: .9rem; }
.comb-estado { font-size: .72rem; color: var(--text-sec); }
.comb-cat {
  font-family: var(--font-mono); font-size: .62rem; font-weight: 400; padding: 0 5px;
  border-radius: 2px; border: 1px solid var(--border-hi); color: var(--text-sec);
}
.comb-cat-veterano { color: #8fc0ea; border-color: #2a4a6b; }
.comb-cat-elite { color: #e2b44c; border-color: #5e4a1c; }
.comb-vida { height: 6px; background: var(--bg-0); border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
.comb-vida-fill { height: 100%; background: var(--vida-cor); }
.comb-vida-txt { font-family: var(--font-mono); font-size: .68rem; color: var(--text-sec); }
.comb-slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.comb-slot {
  font-size: .68rem; padding: 4px 3px; cursor: pointer;
  background: var(--bg-0); color: var(--text-sec);
  border: 1px dashed var(--border-hi); border-radius: var(--radius);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.comb-slot:hover:not(:disabled) { border-color: var(--accent); color: var(--text-pri); }
.comb-slot:disabled { opacity: .5; cursor: default; }
.comb-acoes { display: flex; flex-wrap: wrap; gap: 4px; }
.comb-dispensar { margin-left: auto; color: var(--red-l); }

.missao-card {
  display: grid; gap: 3px; padding: 8px;
  background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius);
}
.missao-card .btn-primario { justify-self: start; }
.missao-nome { font-weight: 700; font-size: .9rem; }
.missao-info { font-size: .72rem; color: var(--text-sec); }
.missao-status { font-size: .75rem; color: #e2b44c; }

.rel-item {
  text-align: left; font-size: .8rem; padding: 6px 8px; cursor: pointer;
  background: var(--bg-1); color: var(--text-pri); border: 1px solid var(--border); border-radius: var(--radius);
}
.rel-item:hover { border-color: var(--accent); }

/* Janelas do Bando (criadas no body, fora de #tela-jogo) */
.janela-conteudo { display: grid; gap: 10px; max-height: 85vh; overflow-y: auto; color: #bcc8b8; }
.janela-lista { display: grid; gap: 6px; }
.janela-opcao { text-align: left; }
.janela-dim { color: #a8b8a2; font-size: .8rem; }
.janela-check { display: flex; gap: 6px; align-items: center; font-size: .9rem; cursor: pointer; }
.janela-input {
  width: 100%; padding: 8px 10px; font-size: .95rem; color: #bcc8b8;
  background: var(--bg-0); border: 1px solid var(--border-hi); border-radius: var(--radius);
}
.rel-resultado { font-weight: 700; }
.rel-vitoria { color: var(--green-l); }
.rel-derrota { color: var(--red-l); }
.rel-linhas {
  max-height: 260px; overflow-y: auto; display: grid; gap: 2px; padding: 6px 8px;
  font-family: var(--font-mono); font-size: .72rem; color: #a8b8a2;
  background: var(--bg-0); border: 1px solid var(--border); border-radius: var(--radius);
}
.rel-rodada { color: #5fd35f; margin-top: 4px; }
```

- [ ] **Step 3: Commit**

```bash
git add index.html style.css
git commit -m "feat: aba Assentamento com identidade e sub-abas Moradores/Bando"
```

---

### Task 6: Manual

**Files:**
- Modify: `manual.html` (nova tela e textos)

- [ ] **Step 1: Nova tela "Bando"**

Em `manual.html`, logo antes de `  <!-- ═══════════ 8. ITENS E EVENTOS ═══════════ -->`, inserir:

```html
  <!-- ═══════════ BANDO ═══════════ -->
  <section class="screen" id="s-bando" data-nome="Bando" hidden>
    <p class="screen-intro">Dentro do Assentamento, o <strong>Bando</strong> reúne combatentes contratados com Baterias. Eles <strong>defendem</strong> o assentamento das invasões e saem em <strong>missões</strong> atrás de saque. Quem morre em combate é perdido junto com o equipamento.</p>
    <div class="frame stack">
      <div class="frame-label">Aba Assentamento · sub-aba Bando</div>
      <div class="card stack" data-h="identidade" tabindex="0">
        <div class="row"><b style="font-size:19px;font-weight:600">🏘 Vila Esperança</b><span class="chip">✏️</span><span class="chip" style="margin-left:auto;color:var(--amber)">Nível 3</span></div>
        <div class="bar"><i style="width:45%;background:var(--amber)"></i></div>
        <div class="row mono dim" style="font-size:12px;justify-content:space-between"><span>340 / 450 XP</span><span style="color:var(--fg)">⚔️ 21 &nbsp; 🛡️ 17</span></div>
      </div>
      <div class="two">
        <div class="card stack" data-h="combatente" tabindex="0">
          <div class="row"><span style="font-size:26px">🧔</span><div><b style="font-weight:600">Bruno</b> <span class="chip">Veterano</span><div class="dim" style="font-size:13.5px">🟢 Pronto · ⚔️ 11 🛡️ 9</div></div></div>
          <div class="bar"><i style="width:80%;background:var(--red)"></i></div>
          <div class="row" data-h="comb-equip" tabindex="0"><span class="chip">🗡️ Lança</span><span class="chip">⛑️ Capacete</span><span class="chip">+ Peito</span></div>
          <div class="row"><span class="btn sec sm" data-h="comb-curar" tabindex="0">🩹 Curar</span><span class="btn sec sm" data-h="comb-dispensar" tabindex="0">Dispensar</span></div>
        </div>
        <div class="card stack">
          <div class="mini-slot" data-h="recruta" tabindex="0">👩 Jana <span class="chip">Novato</span> <span class="dim">⚔️ 4 🛡️ 2 ❤️ 40</span><span class="btn sm" style="margin-left:auto">Contratar · 18 🔋</span></div>
          <div class="mini-slot" data-h="soldo" tabindex="0">🔋 Cobrando soldo <span class="btn sm" style="margin-left:auto">Pagar soldo (10)</span><span class="btn sec sm">Recusar</span></div>
        </div>
      </div>
      <div class="two">
        <div class="card stack" data-h="missao" tabindex="0">
          <b style="font-weight:600">⛺ Acampamento de saqueadores</b>
          <span class="dim" style="font-size:14px">3× Saqueador (⚔️ 5 🛡️ 2 ❤️ 39) · ⏱ 3 min</span>
          <span class="btn sm" style="justify-self:start">Enviar Bando</span>
        </div>
        <div class="card stack" data-h="relatorios" tabindex="0">
          <span class="sec-t" style="margin:0">📋 Últimos combates</span>
          <span>🏆 ⛺ Acampamento de saqueadores · Dia 12</span>
          <span>☠️ 🌙 Invasão noturna · Dia 11</span>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Textos dos pontos da tela**

No objeto `H` do script do manual, logo antes da linha `  // Itens e eventos`, inserir:

```js
  // Bando
  identidade: ['Identidade do assentamento', 'Nome (troque no ✏️), <b>nível</b> e barra de XP. O assentamento ganha XP construindo moradias (+30), acolhendo moradores (+20), vencendo missões (+40 a +120) e defendendo invasões (+50). Cada nível aumenta o limite do Bando (2 no nível 1, até 8). ⚔️ e 🛡️ somam os combatentes prontos; a Defesa inclui armadilhas, moradores Segurança e a Torre de Vigilância.'],
  combatente: ['Combatente', 'Mostra categoria (Novato, Veterano ou Elite), estado, Ataque, Defesa e vida. <b>Ferido</b> (abaixo de 30% da vida) não luta até se recuperar. <span class="warn">Vida zero é morte permanente, e o equipamento é perdido.</span>'],
  'comb-equip': ['Equipamento do combatente', 'Três encaixes: <b>arma</b> (dá Ataque), <b>cabeça</b> e <b>peito</b> (dão Defesa). Usa os mesmos itens que você encontra, tirados da mochila ou do depósito. Ex.: Faca +3 ⚔️, Machado +8 ⚔️, Capacete Tático +5 🛡️, Colete Balístico +7 🛡️.'],
  'comb-curar': ['Curar', 'Use um item de cura da mochila no combatente. Além disso, todo dia ele recupera vida sozinho: +5, ou +15 com um Médico no assentamento, ou +25 com o Médico no Posto Médico.'],
  'comb-dispensar': ['Dispensar', 'Tira o combatente do Bando. O equipamento dele volta para a mochila.'],
  recruta: ['Mural de recrutas', '3 candidatos, renovados a cada 3 dias. Pague em Baterias para contratar. Veteranos e Elites custam mais e são mais fortes. O Bando não pode passar do limite do nível do assentamento.'],
  soldo: ['Soldo', 'A cada 5 dias cada combatente cobra soldo (Novato 5, Veterano 10, Elite 15 Baterias). <span class="warn">Enquanto não paga, ele não luta.</span> Recusar deixa o combatente parado até você pagar e reativar.'],
  missao: ['Missão', 'Escolha quais combatentes prontos vão. Eles ficam fora pelo tempo indicado (o tempo corre mesmo com o jogo fechado). Na volta, o combate é resolvido e aparece o relatório. Vitória traz Baterias, itens (para o Depósito) e XP. Cada alvo pode ser atacado uma vez por dia; os inimigos ficam mais fortes conforme o nível do assentamento.'],
  relatorios: ['Últimos combates', 'Os 5 últimos combates (missões e invasões). Clique para ver rodada a rodada, quem se feriu, quem morreu e o que foi saqueado. Invasões acontecem quando você está fora explorando ao anoitecer; com o Bando pronto em casa, ele luta antes de qualquer item ser roubado.'],
```

- [ ] **Step 3: Verificar o script do manual**

Run: `sed -n '/^<script>$/,/^<\/script>$/p' manual.html | sed '1d;$d' > /tmp/m.js && node --check /tmp/m.js`
Expected: sem saída

- [ ] **Step 4: Commit**

```bash
git add manual.html
git commit -m "docs: manual com a tela do Bando"
```

---

### Task 7: Verificação no navegador e publicação

- [ ] **Step 1: Rodar tudo**

Run: `node --test tests/ && node --check script.js && node --check bando.js`
Expected: `# pass 26`, `# fail 0`, sem erros

- [ ] **Step 2: Roteiro manual no navegador** (servidor local, por exemplo `npx serve`, com um save que já seja Líder)

1. Aba Assentamento: cabeçalho com nome, nível, barra de XP, ⚔️ e 🛡️; renomear pelo ✏️.
2. Sub-aba Bando: mural com 3 recrutas; contratar até o limite (2 no nível 1); o terceiro avisa "Bando cheio".
3. Equipar arma, cabeça e peito; o item sai da mochila/depósito e o ⚔️/🛡️ do card e do cabeçalho sobem.
4. Enviar missão ao Acampamento; o card mostra "volta às HH:MM"; ao terminar abre o relatório com rodadas, baixas e saque; o loot aparece no Depósito e as Baterias na carteira.
5. Ferido (vida abaixo de 30%) não aparece para missões; Curar com item; no dia seguinte a cura diária aumenta a vida.
6. Avançar até o dia de soldo: aparece a cobrança e o "!" na aba; Recusar → Parado; Pagar e reativar.
7. Explorar e deixar anoitecer fora com combatentes prontos: invasão gera relatório e mensagem no registro.
8. Recarregar a página com uma missão em andamento e esperar passar o tempo: ao voltar, ela é resolvida.
9. Carregar um save antigo: nome "Assentamento de …", XP inicial pelas moradias e moradores.

- [ ] **Step 3: Publicar (só com aprovação do usuário)**

```bash
git checkout main && git merge --ff-only dev && git push origin main && git checkout dev && git push origin dev
```
