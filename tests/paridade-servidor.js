// Paridade com o Supabase de produção: chama simular_combate_publico (só cálculo, sem dados)
// e compara com combate.js. Rode depois de aplicar supabase_bando_online.sql:
//   node tests/paridade-servidor.js
const fs = require('fs');
const path = require('path');
const util = require('util');
const raiz = path.join(__dirname, '..');
const { simularCombate, criarRng } = require(path.join(raiz, 'combate.js'));

const config = fs.readFileSync(path.join(raiz, 'config.js'), 'utf8');
const URL = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(config)[1];
const KEY = /SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(config)[1];

(async () => {
  const gen = criarRng(77);
  const int = (a, b) => a + Math.floor(gen() * (b - a + 1));
  const time = (p, n) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, nome: `${p}-${i}`, atq: int(0, 17), def: int(0, 18), vida: int(1, 70) }));
  let iguais = 0;
  const total = 200;
  for (let caso = 0; caso < total; caso++) {
    const A = time('A', int(1, 6)), B = time('B', int(1, 6));
    const semente = int(1, 2147483646);
    const resp = await fetch(`${URL}/rest/v1/rpc/simular_combate_publico`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_a: A, time_b: B, semente }),
    });
    if (!resp.ok) { console.error('Erro do servidor:', resp.status, await resp.text()); process.exit(1); }
    if (util.isDeepStrictEqual(simularCombate(A, B, semente), await resp.json())) iguais++;
    else console.log('DIFERENTE: caso', caso, 'semente', semente);
  }
  console.log(`paridade com o Supabase: ${iguais}/${total} idênticos`);
  process.exit(iguais === total ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
