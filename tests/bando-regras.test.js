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
