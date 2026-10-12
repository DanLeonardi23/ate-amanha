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

  // Avança 'segundos' de jogo: queda da dependência e tempo sem usar; depois, os efeitos da
  // abstinência (se 'efeitos') pelo estado já atualizado, para que quem lê o estágio depois
  // (avisos, causa da morte) veja o mesmo que foi aplicado. Retorna esse estágio (ou null).
  function tickVicio(stats, segundos, opcoes = {}) {
    const { medico = false, estresseMulti = 1, vidaDecay = 1, efeitos = true } = opcoes;
    const queda = VICIO.quedaPorSegundo * (medico ? VICIO.medico.queda : 1) * segundos;
    stats.vicio = limitar((stats.vicio || 0) - queda, 0, 100);
    stats.semUso = (stats.semUso || 0) + segundos;
    if (!efeitos) return null;
    const estagio = estagioAbstinencia(stats.vicio, stats.semUso);
    if (estagio) {
      const f = medico ? VICIO.medico.abstinencia : 1;
      stats.estresse = limitar(stats.estresse + estagio.estresse * f * estresseMulti * segundos, 0, 100);
      if (estagio.vida) stats.vida = limitar(stats.vida - estagio.vida * f * vidaDecay * segundos, 0, stats.vidaMax);
    }
    return estagio;
  }

  const api = {
    VICIO, ESTAGIOS_ABSTINENCIA, estagioDependencia, estagioAbstinencia, minutosParaAbstinencia,
    aliviarComTolerancia, aplicarDose, tickVicio,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(raiz, api);
})(typeof window !== 'undefined' ? window : globalThis);
