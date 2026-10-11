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
