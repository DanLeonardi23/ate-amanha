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

