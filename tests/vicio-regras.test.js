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
