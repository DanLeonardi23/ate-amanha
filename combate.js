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
