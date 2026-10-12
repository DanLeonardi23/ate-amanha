// Paridade do motor de combate: SQL (supabase_bando_online.sql) × combate.js, num PostgreSQL local (PGlite).
// Uso (uma vez): cd tests/servidor && npm install
// Depois:        node tests/servidor/paridade-sql.js
const fs = require('fs');
const path = require('path');
const util = require('util');
const { PGlite } = require('@electric-sql/pglite');
const raiz = path.join(__dirname, '..', '..');
const { simularCombate, criarRng } = require(path.join(raiz, 'combate.js'));
const { prepararBanco } = require('./banco-teste.js');

(async () => {
  const db = await prepararBanco(PGlite, fs.readFileSync(path.join(raiz, 'supabase_bando_online.sql'), 'utf8'));
  const gen = criarRng(2024);
  const int = (a, b) => a + Math.floor(gen() * (b - a + 1));
  const time = (p, n) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, nome: `${p}-${i}`, atq: int(0, 20), def: int(0, 20), vida: int(0, 90) }));
  let iguais = 0;
  const total = 600;
  for (let caso = 0; caso < total; caso++) {
    const A = time('A', int(0, 6)), B = time('B', int(0, 6));
    const semente = int(0, 2 ** 32 - 1);
    const js = simularCombate(A, B, semente);
    const { rows } = await db.query('select simular_combate_publico($1, $2, $3) as r', [JSON.stringify(A), JSON.stringify(B), semente]);
    if (util.isDeepStrictEqual(js, rows[0].r)) iguais++;
    else console.log('DIFERENTE: caso', caso, 'semente', semente);
  }
  console.log(`paridade: ${iguais}/${total} idênticos`);
  process.exit(iguais === total ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
