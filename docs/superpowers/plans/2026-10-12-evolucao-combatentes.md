# Evolução dos combatentes — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combatentes do Bando ganham XP ao sobreviver a combates e, pagando um treino em Baterias, sobem do nível 1 ao 5 (+1 ⚔️, +1 🛡️, +5 ❤️ máx. por nível; soldo +2 por nível).

**Architecture:** Regras puras (tabela de níveis, `podeTreinar`, `soldoDe`, bônus em `statsLutador`) em `bando-regras.js`; XP, treino e card em `bando.js`; `online.js` só passa o resultado do combate. O servidor ganha limites novos em `_lutador_valido` (21/22/90) num SQL próprio para rodar no Supabase. Desenho: `docs/superpowers/specs/2026-10-12-evolucao-combatentes-design.md`.

**Tech Stack:** HTML/CSS/JS puro; testes `node --test`; PGlite (PostgreSQL em WASM) para o SQL.

---

## Antes de começar

- O working tree usa CRLF (`core.autocrlf=true`). **Não** use `sed`/`awk` com barras invertidas (já gerou caracteres invisíveis neste projeto). Depois de editar, `grep -c $'\x08' <arquivo>` deve dar `0`.
- As alterações grandes vêm como **scripts de patch em Node**: cada `rep(a, b)` troca um trecho exato `a` (que deve aparecer uma única vez) por `b`, preservando CRLF. Salve o script **no diretório de rascunho (scratchpad), não no repositório**, e rode-o a partir da raiz do repositório (`node <caminho>/script.js`). Se ele acusar `0x` ou `2x`, pare e reporte: o arquivo não está como o plano espera.
- Testes do jogo: `node --test tests/` (69 ao final). Os do servidor (`tests/servidor/`) rodam à mão; se `tests/servidor/node_modules` não existir, rode `npm install` dentro de `tests/servidor`.
- Todo o código abaixo já foi validado: aplicado nesta ordem sobre o `dev` atual, cada tarefa termina com a suíte verde.

## Mapa de arquivos

| Arquivo | Mudança |
|---|---|
| `bando-regras.js` | Tabela de níveis, XP por resultado, `proximoTreino`, `podeTreinar`, `soldoDe`, bônus em `statsLutador`, `LIMITES_LUTADOR` 21/22/90 |
| `bando.js` | `nivel`/`xp` em saves antigos e recrutas; XP para sobreviventes; soldo pelo nível; relatório; card (nível, barra, botão); `treinarCombatente` |
| `online.js` | Passa `venceu` para `aplicarResultadoCombate` |
| `supabase_bando_evolucao.sql` (novo), `supabase_bando_online.sql` | Limites novos em `_lutador_valido` |
| `style.css`, `manual.html` | Selo de nível, barra de XP, explicação do treino |
| `tests/evolucao.test.js` (novo), `tests/online.test.js`, `tests/servidor/cenarios-sql.js` | Testes |

---

### Task 1: Regras da evolução

**Files:**
- Create: `tests/evolucao.test.js`
- Modify: `bando-regras.js` (antes de `statsLutador`, `LIMITES_LUTADOR`, exportações), `tests/online.test.js` (expectativa do limite)

- [ ] **Step 1: Testes das regras**

Crie `tests/evolucao.test.js` com:

```js
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

```

- [ ] **Step 2: Ver falhar**

Run: `node --test tests/`
Expected: 4 falhas (as novas: `R.NIVEIS_COMBATENTE` indefinido etc.), 57 passando.

- [ ] **Step 3: Implementar (script de patch)**

Salve no scratchpad como `t1-regras.js` e rode a partir da raiz: `node <scratchpad>/t1-regras.js`

```js
// Aplica a evolução dos combatentes em bando-regras.js (Tarefa 1)
const fs = require('fs');
const f = process.argv[2] || 'bando-regras.js';
const raw = fs.readFileSync(f, 'utf8'); const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
const rep = (a, b) => { const c = s.split(a).length - 1; if (c !== 1) throw new Error(c + 'x: ' + a.slice(0, 70)); s = s.replace(a, b); };

const f2 = 'tests/online.test.js';
// 1) Tabela de níveis antes de statsLutador
rep(`  // Lutador para o motor de combate: atributos base + equipamento (+ bônus de defesa do assentamento)
  function statsLutador(c, bonusDef = 0) {
    let atq = c.atqBase, def = c.defBase + bonusDef;`,
`  // ── Evolução dos combatentes ──
  // Nível 1–5: o XP de combate libera o treino, que custa Baterias. Cada nível acima do 1
  // soma +1 ⚔️ e +1 🛡️ (calculados em statsLutador) e +5 ❤️ máx. (gravados no treino).
  const NIVEIS_COMBATENTE = [
    { nivel: 1, xp: 0,   custo: 0 },
    { nivel: 2, xp: 50,  custo: 15 },
    { nivel: 3, xp: 120, custo: 30 },
    { nivel: 4, xp: 220, custo: 50 },
    { nivel: 5, xp: 350, custo: 80 },
  ];
  const NIVEL_COMBATENTE_MAX = NIVEIS_COMBATENTE.length;
  const BONUS_NIVEL = { atq: 1, def: 1, vida: 5 };
  const XP_COMBATE = { vitoria: 20, derrota: 8 };
  const SOLDO_POR_NIVEL = 2;

  // Próximo treino ({ nivel, xp, custo }) ou null no nível máximo
  function proximoTreino(c) {
    return NIVEIS_COMBATENTE[c.nivel || 1] || null;
  }

  // { ok, motivo }: pode treinar agora?
  function podeTreinar(c, baterias) {
    const prox = proximoTreino(c);
    if (!prox) return { ok: false, motivo: 'Nível máximo' };
    if ((c.xp || 0) < prox.xp) return { ok: false, motivo: \`Faltam \${prox.xp - (c.xp || 0)} XP\` };
    if (c.estado === 'missao' || c.estado === 'parado') return { ok: false, motivo: 'Indisponível agora' };
    if (baterias < prox.custo) return { ok: false, motivo: \`Precisa de \${prox.custo} Baterias\` };
    return { ok: true, motivo: null };
  }

  function soldoDe(c) {
    return CATEGORIAS[c.categoria].soldo + SOLDO_POR_NIVEL * ((c.nivel || 1) - 1);
  }

  // Lutador para o motor de combate: atributos base + nível + equipamento (+ bônus de defesa do assentamento)
  function statsLutador(c, bonusDef = 0) {
    const extra = ((c.nivel || 1) - 1);
    let atq = c.atqBase + extra * BONUS_NIVEL.atq, def = c.defBase + extra * BONUS_NIVEL.def + bonusDef;`);

// 2) Limites do online: Elite nível 5 com o melhor equipamento
rep(`  const LIMITES_LUTADOR = { atq: 17, def: 18, vida: 70 };`,
    `  const LIMITES_LUTADOR = { atq: 21, def: 22, vida: 90 }; // Elite nível 5 com Machado, Capacete Tático e Colete Balístico`);

// 3) Exportações
rep(`    LIMITES_LUTADOR, PVP, montarMilicia, hojeBrasilia, estaOnline, poderPerfil, motivoBloqueio,\n`,
    `    LIMITES_LUTADOR, PVP, montarMilicia, hojeBrasilia, estaOnline, poderPerfil, motivoBloqueio,\n    NIVEIS_COMBATENTE, NIVEL_COMBATENTE_MAX, BONUS_NIVEL, XP_COMBATE, SOLDO_POR_NIVEL, proximoTreino, podeTreinar, soldoDe,\n`);


// 4) Teste do online: o limite enviado ao servidor acompanha LIMITES_LUTADOR
{
  const raw2 = fs.readFileSync(f2, 'utf8'); const crlf2 = raw2.includes('\r\n');
  let t = raw2.replace(/\r\n/g, '\n');
  const a = `  assert.deepEqual([m.atq, m.def, m.vida], [17, 18, 70]);`;
  if (t.split(a).length !== 2) throw new Error('clamp');
  t = t.replace(a, `  assert.deepEqual([m.atq, m.def, m.vida], [21, 22, 90]); // LIMITES_LUTADOR (Elite nível 5 equipado)`);
  fs.writeFileSync(f2, crlf2 ? t.replace(/\n/g, '\r\n') : t);
  console.log('ok', f2);
}
fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('ok', f);
```

O que muda: constantes e funções da evolução antes de `statsLutador`; `statsLutador` soma `nivel − 1` ao Ataque e à Defesa base; `LIMITES_LUTADOR` passa a `{ atq: 21, def: 22, vida: 90 }`; exportações novas; o teste do limite em `tests/online.test.js` passa a esperar `[21, 22, 90]`.

- [ ] **Step 4: Ver passar**

Run: `node --test tests/`
Expected: `# pass 61`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add bando-regras.js tests/evolucao.test.js tests/online.test.js
git commit -m "feat: regras da evolução dos combatentes"
```

---

### Task 2: XP, treino, soldo e card no Bando

**Files:**
- Modify: `bando.js` (`normalizarBando`, `contratarRecruta`, cobrança do soldo, `aplicarResultadoCombate`, `resolverMissao`, `defenderInvasao`, `abrirRelatorio`, `htmlCombatente`, ações)
- Modify: `tests/evolucao.test.js` (acrescentar ao final)

- [ ] **Step 1: Testes com o jogo simulado**

Acrescente ao **final** de `tests/evolucao.test.js` (depois do último teste da Task 1):

```js
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
```

- [ ] **Step 2: Ver falhar**

Run: `node --test tests/`
Expected: 7 falhas (as novas), 61 passando.

- [ ] **Step 3: Implementar (script de patch)**

Salve no scratchpad como `t2-bando.js` e rode a partir da raiz: `node <scratchpad>/t2-bando.js`

```js
// Aplica a evolução dos combatentes em bando.js (validação)
const fs = require('fs');
const f = process.argv[2] || 'bando.js';
const raw = fs.readFileSync(f, 'utf8'); const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
const rep = (a, b) => { const c = s.split(a).length - 1; if (c !== 1) throw new Error(c + 'x: ' + a.slice(0, 70)); s = s.replace(a, b); };

// 1) Saves antigos: nível e XP dos combatentes
rep(`  for (const c of assent.bando) {
    if (c.estado === 'missao' && !emCampo.has(c.id)) {`,
`  for (const c of assent.bando) {
    if (!c.nivel) c.nivel = 1;                     // evolução dos combatentes
    if (typeof c.xp !== 'number') c.xp = 0;
    if (c.estado === 'missao' && !emCampo.has(c.id)) {`);

// 2) Recruta chega no nível 1
rep(`    estado: 'pronto', diaSoldo: estado.dia + DIAS_SOLDO, soldoPendente: null, divida: null,`,
    `    estado: 'pronto', diaSoldo: estado.dia + DIAS_SOLDO, soldoPendente: null, divida: null,
    nivel: 1, xp: 0,`);

// 3) Soldo pelo nível
rep(`      c.soldoPendente = CATEGORIAS[c.categoria].soldo;`, `      c.soldoPendente = soldoDe(c);`);

// 4) XP para quem sobreviveu (venceu: true/false; omitido = sem XP)
rep(`// Aplica as vidas finais do lado do Bando; mortos saem do Bando com o equipamento
function aplicarResultadoCombate(res, lado) {
  const a = estado.assentamento;
  const mortos = [], feridos = [], idsMortos = [];`,
`// Aplica as vidas finais do lado do Bando; mortos saem do Bando com o equipamento.
// Com 'venceu' informado, quem sobreviveu ganha XP de combate (vitória/derrota).
function aplicarResultadoCombate(res, lado, venceu) {
  const a = estado.assentamento;
  const mortos = [], feridos = [], idsMortos = [], ganharam = [];
  const xpGanho = venceu === undefined ? 0 : (venceu ? XP_COMBATE.vitoria : XP_COMBATE.derrota);`);
rep(`    if (est === 'ferido') feridos.push(c.nome);
    // Parados nunca lutam`,
`    if (est === 'ferido') feridos.push(c.nome);
    if (xpGanho) {
      const prox = proximoTreino(c);
      const podiaAntes = prox && c.xp >= prox.xp;
      c.xp = (c.xp || 0) + xpGanho;
      ganharam.push(c.nome);
      if (prox && !podiaAntes && c.xp >= prox.xp) log(\`⭐ \${c.nome} pode treinar para o nível \${prox.nivel}.\`, 'log-sucesso');
    }
    // Parados nunca lutam`);
rep(`  a.bando = a.bando.filter(c => !idsMortos.includes(c.id));
  return { mortos, feridos };`,
`  a.bando = a.bando.filter(c => !idsMortos.includes(c.id));
  return { mortos, feridos, xp: xpGanho, ganharam };`);

// 5) Missões e invasões passam o resultado
rep(`  const baixas = aplicarResultadoCombate(res, 'A');
  const venceu = res.vencedor === 'A';
  let resumo;`,
`  const venceu = res.vencedor === 'A';
  const baixas = aplicarResultadoCombate(res, 'A', venceu);
  let resumo;`);
rep(`  const baixas = aplicarResultadoCombate(res, 'B');
  const venceu = res.vencedor === 'B';
  ganharXpAssentamento(venceu ? XP_EVENTO.invasaoVitoria : XP_EVENTO.derrota);`,
`  const venceu = res.vencedor === 'B';
  const baixas = aplicarResultadoCombate(res, 'B', venceu);
  ganharXpAssentamento(venceu ? XP_EVENTO.invasaoVitoria : XP_EVENTO.derrota);`);

// 6) Relatório mostra quem ganhou XP
rep(`    rel.baixas.feridos.length ? \`🩸 Feridos: \${rel.baixas.feridos.map(esc).join(', ')}\` : '',`,
`    rel.baixas.feridos.length ? \`🩸 Feridos: \${rel.baixas.feridos.map(esc).join(', ')}\` : '',
    rel.baixas.ganharam?.length ? \`⭐ +\${rel.baixas.xp} XP: \${rel.baixas.ganharam.map(esc).join(', ')}\` : '',`);

// 7) Card: nível, barra de XP e treino
rep(`  let acoes = '';
  if (c.soldoPendente) {`,
`  const prox = proximoTreino(c);
  const base = NIVEIS_COMBATENTE[(c.nivel || 1) - 1].xp;
  const pctXp = prox ? Math.min(100, Math.round((c.xp - base) / (prox.xp - base) * 100)) : 100;
  const treino = podeTreinar(c, estado.baterias || 0);
  const xpHtml = prox
    ? \`<div class="comb-xp" title="\${c.xp} / \${prox.xp} XP"><div class="comb-xp-fill" style="width:\${Math.max(0, pctXp)}%"></div></div>
       <span class="comb-xp-txt">⭐ \${c.xp} / \${prox.xp} XP</span>\`
    : '<span class="comb-xp-txt">⭐ Nível máximo</span>';
  const botaoTreino = prox && c.xp >= prox.xp
    ? \`<button class="btn-primario btn-sm" data-acao="treinar" data-id="\${esc(c.id)}" \${treino.ok ? '' : \`disabled title="\${esc(treino.motivo)}"\`}>⭐ Treinar → Nv \${prox.nivel} (\${prox.custo} 🔋)</button>\`
    : '';
  let acoes = '';
  if (c.soldoPendente) {`);
rep(`          <span class="comb-nome">\${esc(c.nome)} <span class="comb-cat comb-cat-\${c.categoria}">\${cat.nome}</span></span>`,
    `          <span class="comb-nome">\${esc(c.nome)} <span class="comb-cat comb-cat-\${c.categoria}">\${cat.nome}</span> <span class="comb-nivel">Nv \${c.nivel || 1}</span></span>`);
rep(`      <span class="comb-vida-txt">❤️ \${c.vida} / \${c.vidaMax}</span>
      <div class="comb-slots">\${slots}</div>
      <div class="comb-acoes">
        \${acoes}`,
`      <span class="comb-vida-txt">❤️ \${c.vida} / \${c.vidaMax}</span>
      \${xpHtml}
      <div class="comb-slots">\${slots}</div>
      <div class="comb-acoes">
        \${botaoTreino}
        \${acoes}`);

// 8) Treinar
rep(`ACOES_BANDO['contratar']     = el => contratarRecruta(parseInt(el.dataset.idx));`,
`// Treino: com o XP completo, paga Baterias e sobe um nível (+5 de vida máxima e de vida)
function treinarCombatente(id) {
  const c = combatentePorId(id);
  if (!c) return;
  const t = podeTreinar(c, estado.baterias || 0);
  if (!t.ok) { mostrarToast(t.motivo); return; }
  const prox = proximoTreino(c);
  removerItem('pilha', prox.custo);
  c.nivel = prox.nivel;
  c.vidaMax += BONUS_NIVEL.vida;
  c.vida = Math.min(c.vidaMax, c.vida + BONUS_NIVEL.vida);
  log(\`⭐ \${c.nome} treinou e chegou ao nível \${c.nivel}.\`, 'log-sucesso');
  mostrarToast(\`⭐ \${c.nome} agora é nível \${c.nivel}!\`);
  atualizarTelaAssentamento();
}

ACOES_BANDO['treinar']       = el => treinarCombatente(el.dataset.id);
ACOES_BANDO['contratar']     = el => contratarRecruta(parseInt(el.dataset.idx));`);

fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('ok', f);
```

O que muda:
1. Saves antigos ganham `nivel = 1` e `xp = 0`; recrutas chegam assim.
2. O soldo usa `soldoDe(c)`.
3. `aplicarResultadoCombate(res, lado, venceu)`: com `venceu` informado, cada sobrevivente ganha `XP_COMBATE.vitoria` ou `.derrota` (mortos não). Avisa no registro quando o XP libera o treino. Retorna também `xp` e `ganharam`.
4. Missões e invasões calculam `venceu` antes e o repassam.
5. O relatório mostra "⭐ +N XP: nomes".
6. O card mostra "Nv N", a barra de XP e o botão "⭐ Treinar → Nv N (custo 🔋)" (desativado com o motivo no `title`).
7. `treinarCombatente(id)` com a ação `treinar`.

- [ ] **Step 4: Ver passar**

Run: `node --test tests/` → `# pass 68`, `# fail 0`
Run: `grep -c $'\x08' bando.js` → `0`

- [ ] **Step 5: Commit**

```bash
git add bando.js tests/evolucao.test.js
git commit -m "feat: XP de combate, treino e soldo por nível no Bando"
```

---

### Task 3: XP nos ataques online

**Files:**
- Modify: `online.js` (`aplicarResultadoAtaque`), `tests/online.test.js`

- [ ] **Step 1: Teste**

Em `tests/online.test.js`, insira **imediatamente antes** da linha `test('normalizarBando não "repara" quem está em ataque em andamento', () => {`:

```js
test('ataque online: combatentes do jogador que sobrevivem ganham XP de combate', () => {
  const { ctx, run, a } = criarJogo();
  a.bando.forEach(c => { c.estado = 'missao'; c.xp = 0; });
  a.ataquesEnviados.push({ id: 'atq1', membros: ['c1', 'c2'] });
  ctx.ataque = ataqueResolvido('A');
  run('aplicarResultadoAtaque(ataque, "atacante")');
  assert.deepEqual(simples(a.bando.map(c => [c.id, c.xp])), [['c1', 20]]); // c2 morreu
  assert.deepEqual(simples(a.relatorios[0].baixas.ganharam), ['Rafa']);
  const d = criarJogo();
  d.ctx.ataque = ataqueResolvido('A', { lutadores: [{ id: 'z1', lado: 'A', vida: 5 }, { id: 'c1', lado: 'B', vida: 20 }, { id: 'c2', lado: 'B', vida: 40 }] });
  d.run('aplicarResultadoAtaque(ataque, "defensor")');
  assert.deepEqual(simples(d.a.bando.map(c => c.xp)), [8, 8]); // defensor derrotado
});

```

(Uma linha em branco depois do `});`, antes do teste seguinte.)

- [ ] **Step 2: Ver falhar**

Run: `node --test tests/online.test.js`
Expected: o teste novo falha (XP continua 0).

- [ ] **Step 3: Implementar**

Em `online.js`, troque exatamente:

```js
    baixas = aplicarResultadoCombate(res, 'A');
```
por
```js
    baixas = aplicarResultadoCombate(res, 'A', venceu);
```

e

```js
    if (!res.milicia) baixas = aplicarResultadoCombate(res, 'B');
```
por
```js
    if (!res.milicia) baixas = aplicarResultadoCombate(res, 'B', venceu);
```

(`venceu` já é calculado antes nessa função; a milícia não é do Bando e não ganha XP.)

- [ ] **Step 4: Ver passar**

Run: `node --test tests/` → `# pass 69`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add online.js tests/online.test.js
git commit -m "feat: XP de combate nos ataques online"
```

---

### Task 4: Limites novos no servidor

**Files:**
- Create: `supabase_bando_evolucao.sql`
- Modify: `supabase_bando_online.sql` (`_lutador_valido`), `tests/servidor/cenarios-sql.js`

- [ ] **Step 1: Cenários**

Salve no scratchpad como `t4b-cenarios.js` e rode a partir da raiz: `node <scratchpad>/t4b-cenarios.js tests/servidor/cenarios-sql.js`

```js
// Ajusta os cenários SQL para os limites da evolução (validação)
const fs = require('fs');
const f = process.argv[2] || 'tests/servidor/cenarios-sql.js';
const raw = fs.readFileSync(f, 'utf8'); const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
const rep = (a, b) => { const c = s.split(a).length - 1; if (c !== 1) throw new Error(c + 'x: ' + a.slice(0, 70)); s = s.replace(a, b); };

rep("[B, JSON.stringify([lut('a1', 18, 8, 55)])], /inválido/);", "[B, JSON.stringify([lut('a1', 22, 8, 55)])], /inválido/);");

const fim = '  console.log(`\\n${ok} cenários ok`);';
rep(fim, `  await caso('evolução: limites 21/22/90 (supabase_bando_evolucao.sql) e helper continua fechado', async () => {
    await db.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase_bando_evolucao.sql'), 'utf8'));
    await rpc(F, 'select publicar_perfil($1)', [perfil('Vila F', 0, [lut('f1', 21, 22, 90)])]);
    assert.deepEqual((await ler(F)).defensores, [lut('f1', 21, 22, 90)]);
    await erro(F, 'select publicar_perfil($1)', [perfil('Vila F', 0, [lut('f1', 22, 22, 90)])], /defensores/);
    await erro(F, 'select publicar_perfil($1)', [perfil('Vila F', 0, [lut('f1', 21, 23, 90)])], /defensores/);
    await erro(F, 'select publicar_perfil($1)', [perfil('Vila F', 0, [lut('f1', 21, 22, 91)])], /defensores/);
    await db.exec('set role authenticated');
    try { await assert.rejects(db.query("select _lutador_valido('{}')"), /permission denied/); } finally { await db.exec('reset role'); }
  });

` + fim);

fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('ok', f);
```

- [ ] **Step 2: Ver falhar**

Run: `node tests/servidor/cenarios-sql.js`
Expected: `FALHOU:` (o arquivo `supabase_bando_evolucao.sql` ainda não existe).

- [ ] **Step 3: SQL novo**

Crie `supabase_bando_evolucao.sql`:

```sql
-- Evolução dos combatentes do Bando: limites novos para os lutadores do online.
-- Pior caso: Elite nível 5 com Machado, Capacete Tático e Colete Balístico
-- (⚔️ 9+4+8 = 21, 🛡️ 6+4+5+7 = 22, ❤️ 70+20 = 90).
-- Rode no SQL Editor do Supabase ANTES de publicar a versão do jogo com a evolução.
-- O "create or replace" mantém as permissões da função; o revoke abaixo só reforça.

begin;

create or replace function _lutador_valido(l jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(l) = 'object'
     and coalesce(char_length(l ->> 'id'), 0) between 1 and 40
     and coalesce(char_length(l ->> 'nome'), 0) between 1 and 24
     and (l ->> 'nome') !~ '[<>]'
     and case when jsonb_typeof(l -> 'atq') = 'number' and (l ->> 'atq') ~ '^\d{1,3}$'
              then (l ->> 'atq')::int <= 21 else false end
     and case when jsonb_typeof(l -> 'def') = 'number' and (l ->> 'def') ~ '^\d{1,3}$'
              then (l ->> 'def')::int <= 22 else false end
     and case when jsonb_typeof(l -> 'vida') = 'number' and (l ->> 'vida') ~ '^\d{1,3}$'
              then (l ->> 'vida')::int between 1 and 90 else false end;
$$;

revoke execute on function _lutador_valido(jsonb) from public, anon, authenticated;

commit;
```

- [ ] **Step 4: SQL base com os mesmos limites**

Salve no scratchpad como `t4a-sql.js` e rode a partir da raiz: `node <scratchpad>/t4a-sql.js`

```js
// Limites novos em _lutador_valido no SQL base (Tarefa 4)
const fs = require('fs');
const f = 'supabase_bando_online.sql';
const raw = fs.readFileSync(f, 'utf8'); const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
const rep = (a, b) => { const c = s.split(a).length - 1; if (c !== 1) throw new Error(c + 'x: ' + a.slice(0, 70)); s = s.replace(a, b); };
rep(`then (l ->> 'atq')::int <= 17 else false end`, `then (l ->> 'atq')::int <= 21 else false end`);
rep(`then (l ->> 'def')::int <= 18 else false end`, `then (l ->> 'def')::int <= 22 else false end`);
rep(`then (l ->> 'vida')::int between 1 and 70 else false end;`, `then (l ->> 'vida')::int between 1 and 90 else false end;`);
fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('ok', f);
```

- [ ] **Step 5: Ver passar**

Run: `node tests/servidor/cenarios-sql.js` → última linha `12 cenários ok`
Run: `node tests/servidor/paridade-sql.js` → `paridade: 600/600 idênticos`
Run: `node --test tests/` → `# pass 69`, `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add supabase_bando_evolucao.sql supabase_bando_online.sql tests/servidor/cenarios-sql.js
git commit -m "feat: limites do online para combatentes evoluídos (21/22/90)"
```

---

### Task 5: Estilos e manual

**Files:**
- Modify: `style.css` (depois de `.comb-vida-txt`), `manual.html` (card de exemplo, textos `combatente`, `comb-treinar` novo, `soldo`)

- [ ] **Step 1: Implementar (script de patch)**

Salve no scratchpad como `t5-visual.js` e rode a partir da raiz: `node <scratchpad>/t5-visual.js`

```js
// Evolução dos combatentes: estilos do card e manual (validação)
const fs = require('fs');
const edit = (f, pares) => {
  const raw = fs.readFileSync(f, 'utf8'); const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  for (const [a, b] of pares) { const c = s.split(a).length - 1; if (c !== 1) throw new Error(f + ' ' + c + 'x: ' + a.slice(0, 70)); s = s.replace(a, b); }
  fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
  console.log('ok', f);
};
const dir = process.argv[2] || '.';

edit(`${dir}/style.css`, [
  [`.comb-vida-txt { font-family: var(--font-mono); font-size: .68rem; color: var(--text-sec); }\n`,
`.comb-vida-txt { font-family: var(--font-mono); font-size: .68rem; color: var(--text-sec); }
.comb-nivel { font-family: var(--font-mono); font-size: .62rem; font-weight: 400; color: #e2b44c; }
.comb-xp { height: 4px; background: var(--bg-0); border: 1px solid var(--border); border-radius: 2px; overflow: hidden; }
.comb-xp-fill { height: 100%; background: #e2b44c; transition: width .4s ease; }
.comb-xp-txt { font-family: var(--font-mono); font-size: .64rem; color: var(--text-sec); }
`],
]);

edit(`${dir}/manual.html`, [
  [`<b style="font-weight:600">Bruno</b> <span class="chip">Veterano</span><div class="dim" style="font-size:13.5px">🟢 Pronto · ⚔️ 11 🛡️ 9</div>`,
   `<b style="font-weight:600">Bruno</b> <span class="chip">Veterano</span> <span class="chip" style="color:var(--amber)">Nv 2</span><div class="dim" style="font-size:13.5px">🟢 Pronto · ⚔️ 11 🛡️ 9</div>`],
  [`          <div class="bar"><i style="width:80%;background:var(--red)"></i></div>
          <div class="row" data-h="comb-equip" tabindex="0">`,
`          <div class="bar"><i style="width:80%;background:var(--red)"></i></div>
          <div class="stack" data-h="comb-treinar" tabindex="0"><div class="bar" style="height:4px"><i style="width:100%;background:var(--amber)"></i></div><span class="mono dim" style="font-size:12px">⭐ 128 / 120 XP</span><span class="btn sm" style="justify-self:start">⭐ Treinar → Nv 3 (30 🔋)</span></div>
          <div class="row" data-h="comb-equip" tabindex="0">`],
  [`  combatente: ['Combatente', 'Mostra categoria (Novato, Veterano ou Elite), estado, Ataque, Defesa e vida.`,
   `  combatente: ['Combatente', 'Mostra categoria (Novato, Veterano ou Elite), <b>nível</b> (Nv 1 a 5), estado, Ataque, Defesa e vida.`],
  [`  'comb-equip': [`,
`  'comb-treinar': ['Evolução e treino', 'Quem <b>sobrevive</b> a um combate ganha ⭐ XP: <b>+20</b> na vitória, <b>+8</b> na derrota (missões, invasões e ataques online). Com o XP do próximo nível, aparece o botão <b>Treinar</b>, que custa Baterias: Nv 2 (50 XP, 15 🔋), Nv 3 (120 XP, 30 🔋), Nv 4 (220 XP, 50 🔋), Nv 5 (350 XP, 80 🔋). Cada nível dá <b>+1 ⚔️, +1 🛡️ e +5 ❤️ máx.</b> Não dá para treinar quem está em missão ou parado. <span class="warn">O soldo sobe 2 Baterias por nível.</span>'],
  'comb-equip': [`],
  [`(Novato 5, Veterano 10, Elite 15 Baterias).`, `(Novato 5, Veterano 10, Elite 15 Baterias, mais 2 por nível acima do 1).`],
]);
```

- [ ] **Step 2: Conferir**

Run: `node --test tests/` → `# pass 69`, `# fail 0`
Run: `grep -c "comb-treinar" manual.html` → `2` (o card de exemplo e o texto da dica)

- [ ] **Step 3: Commit**

```bash
git add style.css manual.html
git commit -m "feat: selo de nível, barra de XP e manual da evolução"
```

---

## Depois das tarefas (com o usuário)

1. O usuário roda `supabase_bando_evolucao.sql` no SQL Editor do Supabase (**antes** de publicar o jogo).
2. `node tests/paridade-servidor.js` → 200/200.
3. Publicar (merge `dev` → `main`) só com o ok do usuário.
