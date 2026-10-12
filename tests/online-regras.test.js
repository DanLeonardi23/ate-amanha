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
