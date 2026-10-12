# Vício como dependência — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o vício numa dependência com tolerância e abstinência ao parar (estágios leve/moderada/grave), com recuperação pelo tempo e por um morador Médico.

**Architecture:** Regras puras num arquivo novo `vicio-regras.js` (mesmo padrão de `bando-regras.js`: globais no navegador, `module.exports` no Node), com testes `node --test`. `script.js` só chama essas regras: dose e tolerância em `usarItem`, `tickVicio` no loop e no progresso offline, avisos e causa da morte. A dose de cada item continua em `ITENS` (`efeitos.vicio`). Desenho: `docs/superpowers/specs/2026-10-12-vicio-dependencia-design.md`.

**Tech Stack:** HTML/CSS/JS puro; testes `node --test`.

---

## Antes de começar

- O working tree usa CRLF (`core.autocrlf=true`). **Não** use `sed`/`awk` com barras invertidas. Depois de editar, `grep -c $'\x08' <arquivo>` deve dar `0`.
- A integração vem como **script de patch em Node**: cada par `[a, b]` troca um trecho exato `a` (que deve aparecer uma única vez) por `b`, preservando CRLF. Salve o script **no diretório de rascunho (scratchpad), não no repositório**, e rode-o a partir da raiz do repositório. Se ele acusar `0x` ou `2x`, pare e reporte.
- Testes: `node --test tests/` (71 hoje; 80 ao final).
- O código abaixo já foi validado sobre o `dev` atual.

## Mapa de arquivos

| Arquivo | Mudança |
|---|---|
| `vicio-regras.js` (novo) | Constantes, estágios, `tickVicio`, `aplicarDose`, `aliviarComTolerancia`, `estagioAbstinencia`, `estagioDependencia`, `minutosParaAbstinencia` |
| `tests/vicio-regras.test.js` (novo) | Testes das regras |
| `index.html` | Carrega `vicio-regras.js` antes de `script.js` |
| `script.js` | Doses em `ITENS`, `semUso` no estado e em saves antigos, `usarItem`, loop, avisos, causa da morte, offline, `temMedicoAtivo` |
| `manual.html` | Textos do Vício, da Vida, da Bebida e do Analgésico |

---

### Task 1: Regras do vício

**Files:**
- Create: `tests/vicio-regras.test.js`, `vicio-regras.js`

- [ ] **Step 1: Testes**

Crie `tests/vicio-regras.test.js`:

```js
// Vício como dependência: regras puras (vicio-regras.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../vicio-regras.js');

const stats = (extra = {}) => ({ vida: 80, vidaMax: 100, estresse: 20, vicio: 0, semUso: 0, ...extra });
const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('dose soma dependência (até 100) e zera o tempo sem usar', () => {
  const s = stats({ vicio: 95, semUso: 300 });
  V.aplicarDose(s, 12);
  assert.deepEqual([s.vicio, s.semUso], [100, 0]);
  const t = stats({ semUso: undefined });
  V.aplicarDose(t, 4);
  assert.deepEqual([t.vicio, t.semUso], [4, 0]);
});

test('dependência cai 12 por dia de jogo; o dobro com Médico; nunca abaixo de 0', () => {
  const s = stats({ vicio: 60 });
  V.tickVicio(s, 420);
  perto(s.vicio, 48);
  const m = stats({ vicio: 60 });
  V.tickVicio(m, 420, { medico: true });
  perto(m.vicio, 36);
  const z = stats({ vicio: 0.01 });
  V.tickVicio(z, 1);
  assert.equal(z.vicio, 0);
});

test('abstinência só com dependência >= 25 e 210 s sem usar', () => {
  assert.equal(V.estagioAbstinencia(24.9, 999), null);
  assert.equal(V.estagioAbstinencia(25, 209), null);
  assert.equal(V.estagioAbstinencia(25, 210).id, 'leve');
  assert.equal(V.estagioAbstinencia(50, 210).id, 'moderada');
  assert.equal(V.estagioAbstinencia(75, 210).id, 'grave');
  assert.equal(V.estagioAbstinencia(100, undefined), null); // save antigo: semUso ausente
  assert.equal(V.estagioDependencia(30).id, 'leve');
  assert.equal(V.estagioDependencia(10), null);
});

test('efeitos por estágio, por segundo, com traço', () => {
  const leve = stats({ vicio: 30, semUso: 210 });
  assert.equal(V.tickVicio(leve, 10).id, 'leve');
  perto(leve.estresse, 20 + 0.4);
  assert.equal(leve.vida, 80);
  const mod = stats({ vicio: 60, semUso: 300 });
  V.tickVicio(mod, 10, { estresseMulti: 1.5 });
  perto(mod.estresse, 20 + 0.08 * 1.5 * 10);
  const grave = stats({ vicio: 90, semUso: 300 });
  V.tickVicio(grave, 10, { vidaDecay: 2 });
  perto(grave.estresse, 20 + 1.2);
  perto(grave.vida, 80 - 0.05 * 2 * 10);
});

test('Médico corta os efeitos da abstinência pela metade', () => {
  const g = stats({ vicio: 90, semUso: 300 });
  V.tickVicio(g, 10, { medico: true });
  perto(g.estresse, 20 + 0.6);
  perto(g.vida, 80 - 0.25);
});

test('sem efeitos (fora do jogo): dependência cai e o tempo sem usar soma, sem dano', () => {
  const s = stats({ vicio: 90, semUso: 300 });
  assert.equal(V.tickVicio(s, 600, { efeitos: false }), null);
  assert.deepEqual([s.estresse, s.vida, s.semUso], [20, 80, 900]);
  assert.ok(s.vicio < 90);
});

test('estresse e vida ficam dentro dos limites', () => {
  const s = stats({ vicio: 100, semUso: 300, estresse: 99.9, vida: 0.1 });
  V.tickVicio(s, 100);
  assert.deepEqual([s.estresse, s.vida], [100, 0]);
});

test('tolerância: alívio cheio sem dependência, metade com 100; não mexe em aumentos', () => {
  assert.equal(V.aliviarComTolerancia(-20, 0), -20);
  assert.equal(V.aliviarComTolerancia(-20, 50), -15);
  assert.equal(V.aliviarComTolerancia(-40, 100), -20);
  assert.equal(V.aliviarComTolerancia(-5, 100), -3); // alívio de 2,5 arredonda para 3
  assert.equal(V.aliviarComTolerancia(10, 100), 10);
});

test('minutos até a abstinência', () => {
  assert.equal(V.minutosParaAbstinencia(0), 4);   // 210 s → 3,5 min → 4
  assert.equal(V.minutosParaAbstinencia(180), 1);
  assert.equal(V.minutosParaAbstinencia(300), 0);
});
```

- [ ] **Step 2: Ver falhar**

Run: `node --test tests/vicio-regras.test.js`
Expected: falha ao carregar (`Cannot find module '../vicio-regras.js'`).

- [ ] **Step 3: Implementar**

Crie `vicio-regras.js`:

```js
/**
 * ATÉ AMANHÃ — vicio-regras.js
 * Regras puras do vício como dependência: tolerância, abstinência por estágio e recuperação.
 * Sem acesso ao estado do jogo. Roda no navegador (globais) e no Node (testes).
 * A dose de cada substância fica em ITENS (efeitos.vicio): Bebida 12, Whisky 25, Analgésico 4.
 */
(function (raiz) {
  'use strict';

  const DIA_SEGUNDOS = 420; // um dia de jogo (300 s de dia + 120 s de noite)

  const VICIO = {
    quedaPorSegundo: 12 / DIA_SEGUNDOS, // dependência cai 12 por dia de jogo
    limiarDependencia: 25,
    graca: 210,                          // meio dia sem usar até a abstinência
    toleranciaMax: 0.5,                  // com 100 de dependência, metade do alívio de estresse
    medico: { queda: 2, abstinencia: 0.5 },
  };

  // Do mais grave para o mais leve; efeitos por segundo em abstinência
  const ESTAGIOS_ABSTINENCIA = [
    { id: 'grave',    nome: 'grave',    min: 75, estresse: 0.12, vida: 0.05 },
    { id: 'moderada', nome: 'moderada', min: 50, estresse: 0.08, vida: 0 },
    { id: 'leve',     nome: 'leve',     min: 25, estresse: 0.04, vida: 0 },
  ];

  const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

  // Estágio pela dependência (ou null abaixo do limiar), sem olhar o tempo sem usar
  function estagioDependencia(vicio) {
    return ESTAGIOS_ABSTINENCIA.find(e => (vicio || 0) >= e.min) || null;
  }

  // Estágio da abstinência em curso, ou null se não há abstinência
  function estagioAbstinencia(vicio, semUso) {
    if ((semUso || 0) < VICIO.graca) return null;
    return estagioDependencia(vicio);
  }

  // Minutos (reais) até a abstinência começar, arredondado para cima
  function minutosParaAbstinencia(semUso) {
    return Math.ceil(Math.max(0, VICIO.graca - (semUso || 0)) / 60);
  }

  // Redução de estresse de uma dose, diminuída pela tolerância (dependência antes da dose)
  function aliviarComTolerancia(valorEstresse, vicio) {
    if (valorEstresse >= 0) return valorEstresse;
    const fator = 1 - VICIO.toleranciaMax * (limitar(vicio || 0, 0, 100) / 100);
    return -Math.round(-valorEstresse * fator); // arredonda o alívio (2,5 → 3)
  }

  // Uma dose: soma dependência e zera o tempo sem usar
  function aplicarDose(stats, dose) {
    stats.vicio = limitar((stats.vicio || 0) + dose, 0, 100);
    stats.semUso = 0;
  }

  // Avança 'segundos' de jogo: efeitos da abstinência (se 'efeitos'), queda da dependência
  // e tempo sem usar. Retorna o estágio de abstinência aplicado (ou null).
  function tickVicio(stats, segundos, opcoes = {}) {
    const { medico = false, estresseMulti = 1, vidaDecay = 1, efeitos = true } = opcoes;
    let estagio = null;
    if (efeitos) {
      estagio = estagioAbstinencia(stats.vicio, stats.semUso);
      if (estagio) {
        const f = medico ? VICIO.medico.abstinencia : 1;
        stats.estresse = limitar(stats.estresse + estagio.estresse * f * estresseMulti * segundos, 0, 100);
        if (estagio.vida) stats.vida = limitar(stats.vida - estagio.vida * f * vidaDecay * segundos, 0, stats.vidaMax);
      }
    }
    const queda = VICIO.quedaPorSegundo * (medico ? VICIO.medico.queda : 1) * segundos;
    stats.vicio = limitar((stats.vicio || 0) - queda, 0, 100);
    stats.semUso = (stats.semUso || 0) + segundos;
    return estagio;
  }

  const api = {
    VICIO, ESTAGIOS_ABSTINENCIA, estagioDependencia, estagioAbstinencia, minutosParaAbstinencia,
    aliviarComTolerancia, aplicarDose, tickVicio,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(raiz, api);
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Ver passar**

Run: `node --test tests/` → `# pass 80`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add vicio-regras.js tests/vicio-regras.test.js
git commit -m "feat: regras do vício como dependência"
```

---

### Task 2: Integração no jogo e manual

**Files:**
- Modify: `index.html` (scripts), `script.js` (`ITENS`, estado inicial, `iniciarJogo`/novo personagem, `aplicarDadosSave`, `usarItem`, `atualizarStatus`, avisos, causa da morte, `aplicarProgressoOffline`, antes de `moradores()`), `manual.html` (dicas `vicio`, `vida` e linhas da Bebida e do Analgésico)

`script.js` depende do DOM e não tem testes automáticos; a verificação aqui é sintaxe, suíte verde e a lista de conferência abaixo. O teste de comportamento é feito no navegador pelo usuário depois.

- [ ] **Step 1: Aplicar o patch**

Salve no scratchpad como `t2-integracao.js` e rode a partir da raiz: `node <scratchpad>/t2-integracao.js` (deve imprimir `ok` para `index.html`, `script.js` e `manual.html`).

```js
// Vício como dependência: integração em script.js, index.html e manual.html (Tarefa 2)
const fs = require('fs');
const edit = (f, pares) => {
  const raw = fs.readFileSync(f, 'utf8'); const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  for (const [a, b] of pares) { const c = s.split(a).length - 1; if (c !== 1) throw new Error(f + ' ' + c + 'x: ' + a.slice(0, 70)); s = s.replace(a, b); }
  fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
  console.log('ok', f);
};

edit('index.html', [
  [`  <script src="online.js"></script>\n`, `  <script src="online.js"></script>\n  <script src="vicio-regras.js"></script>\n`],
]);

edit('script.js', [
  // Doses (efeitos.vicio): Bebida 12, Analgésico 4 (Whisky continua 25)
  [`efeitos: { estresse: -20, vida: -5, vicio: 10 } },`, `efeitos: { estresse: -20, vida: -5, vicio: 12 } },`],
  [`tipo: 'medicinal',  efeitos: { vida: 15, estresse: -5 } },`, `tipo: 'medicinal',  efeitos: { vida: 15, estresse: -5, vicio: 4 } },`],

  // Estado inicial e personagem novo com o tempo sem usar
  [`  stats: { vida: 100, vidaMax: 100, fome: 0, sede: 0, estresse: 0, vicio: 0 },`,
   `  stats: { vida: 100, vidaMax: 100, fome: 0, sede: 0, estresse: 0, vicio: 0, semUso: 0 },`],
  [`  estado.stats              = { vida: vidaMax, vidaMax, fome: 0, sede: 0, estresse: 0, vicio: 0 };`,
   `  estado.stats              = { vida: vidaMax, vidaMax, fome: 0, sede: 0, estresse: 0, vicio: 0, semUso: 0 };`],

  // Save antigo
  [`  estado.stats              = s.stats;\n`,
   `  estado.stats              = s.stats;\n  if (typeof estado.stats.semUso !== 'number') estado.stats.semUso = 0; // vício como dependência\n`],

  // Usar item: tolerância no alívio de estresse e dose de dependência
  [`  const efeitos   = item.efeitos || {};
  const tracoData = TRACOS[estado.personagem.traco];

  for (const [stat, val] of Object.entries(efeitos)) {
    let v = val;`,
`  const efeitos   = item.efeitos || {};
  const tracoData = TRACOS[estado.personagem.traco];
  const dose      = efeitos.vicio || 0; // substância que vicia (Bebida, Whisky, Analgésico)

  for (const [stat, val] of Object.entries(efeitos)) {
    if (stat === 'vicio') continue;      // aplicado abaixo como dose
    let v = val;
    if (dose && stat === 'estresse') v = aliviarComTolerancia(v, estado.stats.vicio);`],
  [`  // Água suja → intoxicação (90 ticks de efeito)`,
`  if (dose) aplicarDose(estado.stats, dose);

  // Água suja → intoxicação (90 ticks de efeito)`],

  // Loop: dependência, abstinência e Médico
  [`  if (s.vicio > 0) s.vicio = clamp(s.vicio - 0.05, 0, 100);

  // Vício → pressiona estresse e drena vida em abstinência
  if (s.vicio > 30) {
    const fatorVicio = (s.vicio - 30) / 70;
    s.estresse = clamp(s.estresse + fatorVicio * 0.08 * m.estresseMulti, 0, 100);
    if (s.vicio > 70)
      s.vida = clamp(s.vida - fatorVicio * 0.06 * m.vidaDecay, 0, s.vidaMax);
  }`,
`  // Vício: abstinência (sem usar, dependente) e queda da dependência
  tickVicio(s, 1, { medico: temMedicoAtivo(), estresseMulti: m.estresseMulti, vidaDecay: m.vidaDecay });`],

  // Avisos
  [`  if (s.vicio >= 70)    av('💊 Abstinência! Vício drenando vida', 'perigo');
  else if (s.vicio >= 50) av('💊 Dependência se formando', 'alerta');`,
`  const abst = estagioAbstinencia(s.vicio, s.semUso);
  if (abst) av(\`🍶 Abstinência \${abst.nome}\${abst.vida ? ', drenando vida' : ''}: beber alivia, ficar limpo cura\`, abst.id === 'leve' ? 'alerta' : 'perigo');
  else if (estagioDependencia(s.vicio)) av(\`💊 Dependente: abstinência em \${minutosParaAbstinencia(s.semUso)} min sem usar\`, 'alerta');`],

  // Causa da morte
  [`  } else if (s.vicio > 70) {
    causa = 'abstinência';`,
`  } else if (estagioAbstinencia(s.vicio, s.semUso)?.id === 'grave') {
    causa = 'abstinência';`],

  // Fora do jogo: dependência cai, tempo sem usar soma, sem dano
  [`  s.sede = clamp(s.sede + eff * 0.22 * m.consumoMulti, 0, 100);
  // Progresso offline não reduz vida`,
`  s.sede = clamp(s.sede + eff * 0.22 * m.consumoMulti, 0, 100);
  tickVicio(s, eff, { medico: temMedicoAtivo(), efeitos: false });
  // Progresso offline não reduz vida`],

  // Médico ativo em qualquer moradia (vício cai mais rápido e a abstinência pesa menos)
  [`function moradores() {`,
`function temMedicoAtivo() {
  return moradores().some(({ npc }) => npcAtivo(npc) && habCanonica(npc.habilidade) === 'medico');
}

function moradores() {`],
]);

edit('manual.html', [
  [`  vicio: ['💊 Vício', 'Sobe ao usar bebidas e certas substâncias, e cai devagar com o tempo. Acima de <b>30</b> aumenta o estresse; acima de <b>70</b> vira abstinência e <b>drena vida</b>.'],`,
   `  vicio: ['💊 Vício', 'Mede a sua <b>dependência</b>. Sobe a cada dose de Bebida (+12), Whisky (+25) ou Analgésico (+4) e cai devagar, cerca de 12 por dia. Com <b>25 ou mais</b> você é dependente: passar <b>meio dia</b> sem usar nenhuma delas causa <b>abstinência</b>. Leve (25+) e moderada (50+) aumentam o estresse; <span class="warn">grave (75+) também drena vida</span>. Qualquer dose alivia na hora. <b>Tolerância:</b> quanto maior a dependência, menos estresse cada dose tira (até metade). Um morador <b>Médico</b> no assentamento faz a dependência cair duas vezes mais rápido e corta a abstinência pela metade.'],`],
  [`  vida: ['❤️ Vida', 'Chegou a zero, o personagem <b>morre de vez</b>. Cai com fome, sede, vício alto e condições`,
   `  vida: ['❤️ Vida', 'Chegou a zero, o personagem <b>morre de vez</b>. Cai com fome, sede, abstinência grave e condições`],
  [`{estresse:-20,vida:-5,vicio:10},'Alivia o estresse na hora, mas causa dependência.'],`,
   `{estresse:-20,vida:-5,vicio:12},'Alivia o estresse na hora, mas causa dependência. Quanto mais dependente, menos alivia.'],`],
  [`{vida:15,estresse:-5},'Alivia a dor e reduz um pouco o estresse.'],`,
   `{vida:15,estresse:-5,vicio:4},'Alivia a dor e reduz um pouco o estresse. Usado demais, também causa dependência.'],`],
]);
```

O que muda:
1. `index.html` carrega `vicio-regras.js` depois de `online.js` e antes de `script.js`.
2. Doses: Bebida 12 (era 10), Analgésico 4 (novo); Whisky segue 25.
3. `semUso` no estado inicial, no personagem novo e em saves antigos (0 se faltar).
4. `usarItem`: `vicio` não é mais somado direto; a redução de estresse das substâncias passa por `aliviarComTolerancia` (dependência antes da dose) e, depois dos efeitos, `aplicarDose` soma a dependência e zera `semUso`.
5. `atualizarStatus`: o bloco antigo de vício vira `tickVicio(s, 1, …)` com Médico e multiplicadores do traço.
6. Avisos de abstinência por estágio e de dependência com minutos até a abstinência.
7. Causa da morte "abstinência" só em abstinência grave.
8. `aplicarProgressoOffline`: `tickVicio(s, eff, { …, efeitos: false })` (cai a dependência, soma `semUso`, sem dano).
9. `temMedicoAtivo()`: algum morador Médico ativo em qualquer moradia.
10. Manual: textos novos.

- [ ] **Step 2: Conferir**

Run: `node --check script.js` → sem saída
Run: `node --test tests/` → `# pass 80`, `# fail 0`
Run: `grep -c $'\x08' script.js manual.html index.html` → `0` em todos
Run: `grep -n "s.vicio - 0.05\|fatorVicio\|s.vicio > 70" script.js` → nenhuma linha (lógica antiga removida)
Run: `grep -n "vicio-regras.js" index.html` → 1 linha, antes de `script.js`

- [ ] **Step 3: Commit**

```bash
git add index.html script.js manual.html
git commit -m "feat: vício como dependência no jogo (tolerância, abstinência, Médico)"
```

---

## Depois das tarefas (com o usuário)

Teste no navegador: beber 3 Bebidas seguidas (dependência 36, aviso "Dependente: abstinência em 4 min"), ver o alívio de estresse diminuir a cada dose, esperar ~3,5 min sem usar (aviso "Abstinência leve"), beber de novo (aviso some). Publicar (merge `dev` → `main`) só com o ok do usuário.
