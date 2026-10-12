/**
 * ATÉ AMANHÃ — bando-regras.js
 * Regras puras do Bando e da identidade do Assentamento: tabelas e cálculos, sem acesso
 * ao estado do jogo. Roda no navegador (globais) e no Node (testes).
 */
(function (raiz) {
  'use strict';

  // XP acumulada necessária para chegar a cada nível (índice 0 = nível 1)
  const XP_NIVEIS = [0, 100, 250, 450, 700, 1000, 1350, 1750];
  const NIVEL_MAX = XP_NIVEIS.length;

  const XP_EVENTO = { moradia: 30, morador: 20, invasaoVitoria: 50, derrota: 10 };

  const CATEGORIAS = {
    novato:   { nome: 'Novato',   atq: 4, def: 2, vida: 40, preco: [15, 25], soldo: 5 },
    veterano: { nome: 'Veterano', atq: 6, def: 4, vida: 55, preco: [35, 50], soldo: 10 },
    elite:    { nome: 'Elite',    atq: 9, def: 6, vida: 70, preco: [70, 90], soldo: 15 },
  };

  // Valores de combate dos itens equipáveis que os combatentes podem usar
  const COMBATE_EQUIP = {
    faca:             { slot: 'arma',   atq: 3, def: 0 },
    arco:             { slot: 'arma',   atq: 4, def: 0 },
    lanca:            { slot: 'arma',   atq: 5, def: 0 },
    revolver:         { slot: 'arma',   atq: 5, def: 0 },
    machado:          { slot: 'arma',   atq: 8, def: 0 },
    capuz:            { slot: 'cabeca', atq: 0, def: 1 },
    capacete:         { slot: 'cabeca', atq: 0, def: 2 },
    capacete_tatico:  { slot: 'cabeca', atq: 0, def: 5 },
    jaqueta_couro:    { slot: 'peito',  atq: 0, def: 2 },
    colete:           { slot: 'peito',  atq: 0, def: 1 },
    colete_balistico: { slot: 'peito',  atq: 0, def: 7 },
  };
  const SLOTS_COMBATENTE = ['arma', 'cabeca', 'peito'];

  // Nomes por gênero do retrato (mesma convenção de CHARS_GENERO: 'M' mulher, 'H' homem)
  const NOMES_COMBATENTE = {
    M: ['Jana', 'Rita', 'Luíza', 'Kátia', 'Bia', 'Nalu', 'Tereza', 'Iara', 'Dora', 'Cida'],
    H: ['Bruno', 'Caio', 'Edson', 'Fábio', 'Gil', 'Hugo', 'Ivo', 'Jonas', 'Léo', 'Otávio'],
  };

  // Alvos de missão. Inimigos crescem a cada 2 níveis do assentamento (h = ⌊nível/2⌋).
  const MISSOES = {
    acampamento: {
      nome: 'Acampamento de saqueadores', icone: '⛺', inimigo: 'Saqueador',
      qtd: 2, atq: 4, def: 1, vida: 30, vidaPorNivel: 3, duracaoMin: 3, xp: 40, baterias: [10, 20],
      itens: [{ id: 'sucata', qtd: [2, 4] }, { id: 'madeira', qtd: [2, 4] }, { id: 'pano', qtd: [1, 3] }],
      sorteios: 2, raro: null,
    },
    posto: {
      nome: 'Posto de bandidos', icone: '🏚️', inimigo: 'Bandido',
      qtd: 3, atq: 5, def: 2, vida: 36, vidaPorNivel: 4, duracaoMin: 6, xp: 80, baterias: [20, 35],
      itens: [{ id: 'atadura', qtd: [1, 3] }, { id: 'remedio', qtd: [1, 2] }, { id: 'kit', qtd: [1, 1] }, { id: 'faca', qtd: [1, 1] }, { id: 'lanca', qtd: [1, 1] }],
      sorteios: 2, raro: null,
    },
    deposito_militar: {
      nome: 'Depósito militar abandonado', icone: '🎖️', inimigo: 'Mercenário',
      qtd: 4, atq: 6, def: 3, vida: 42, vidaPorNivel: 5, duracaoMin: 10, xp: 120, baterias: [35, 60],
      itens: [{ id: 'arame', qtd: [2, 4] }, { id: 'sucata', qtd: [3, 5] }, { id: 'kit', qtd: [1, 2] }],
      sorteios: 2,
      raro: { chance: 0.3, ids: ['capacete_tatico', 'colete_balistico', 'farda_militar', 'municao', 'radio_militar'] },
    },
  };

  const intEntre = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

  function nivelPorXp(xp) {
    let nivel = 1;
    for (let i = 1; i < XP_NIVEIS.length; i++) if (xp >= XP_NIVEIS[i]) nivel = i + 1;
    return nivel;
  }

  // XP acumulada para chegar ao próximo nível (null no nível máximo)
  function xpParaNivel(nivel) {
    return nivel >= NIVEL_MAX ? null : XP_NIVEIS[nivel];
  }

  function limiteBando(nivel) {
    return Math.min(8, 1 + nivel);
  }

  function sortearCategoria(rng) {
    const r = rng();
    return r < 0.60 ? 'novato' : r < 0.92 ? 'veterano' : 'elite';
  }

  // generoPorChar: mapa charId → 'M'|'H' (CHARS_GENERO do jogo)
  function gerarRecruta(rng, generoPorChar) {
    const charId = intEntre(rng, 1, 12);
    const nomes = NOMES_COMBATENTE[generoPorChar[charId] === 'M' ? 'M' : 'H'];
    const categoria = sortearCategoria(rng);
    const cat = CATEGORIAS[categoria];
    return {
      id: 'c' + intEntre(rng, 0, 2 ** 31).toString(36) + intEntre(rng, 0, 2 ** 31).toString(36),
      nome: nomes[intEntre(rng, 0, nomes.length - 1)],
      charId,
      categoria,
      atqBase: cat.atq,
      defBase: cat.def,
      vida: cat.vida,
      vidaMax: cat.vida,
      preco: intEntre(rng, cat.preco[0], cat.preco[1]),
    };
  }

  // Lutador para o motor de combate: atributos base + equipamento (+ bônus de defesa do assentamento)
  function statsLutador(c, bonusDef = 0) {
    let atq = c.atqBase, def = c.defBase + bonusDef;
    for (const slot of SLOTS_COMBATENTE) {
      const e = COMBATE_EQUIP[c.equip?.[slot]];
      if (e) { atq += e.atq; def += e.def; }
    }
    return { id: c.id, nome: c.nome, atq, def, vida: c.vida };
  }

  function gerarInimigos(tipo, nivel) {
    const m = MISSOES[tipo], h = Math.floor(nivel / 2);
    return Array.from({ length: m.qtd + h }, (_, i) => ({
      id: `${tipo}-${i + 1}`, nome: `${m.inimigo} ${i + 1}`,
      atq: m.atq + h, def: m.def + h, vida: m.vida + m.vidaPorNivel * nivel,
    }));
  }

  function gerarInvasores(nivel) {
    const h = Math.floor(nivel / 2);
    return Array.from({ length: 2 + h }, (_, i) => ({
      id: `invasor-${i + 1}`, nome: `Invasor ${i + 1}`,
      atq: 4 + h, def: 1 + h, vida: 30 + 3 * nivel,
    }));
  }

  function curaDiaria(temMedico, medicoNoPosto) {
    return medicoNoPosto ? 25 : temMedico ? 15 : 5;
  }

  function estadoAposCombate(vida, vidaMax) {
    if (vida <= 0) return 'morto';
    return vida < vidaMax * 0.3 ? 'ferido' : 'pronto';
  }

  function sortearLoot(tipo, rng) {
    const m = MISSOES[tipo];
    const itens = [];
    for (let i = 0; i < m.sorteios; i++) {
      const opcao = m.itens[intEntre(rng, 0, m.itens.length - 1)];
      const qtd = intEntre(rng, opcao.qtd[0], opcao.qtd[1]);
      const existente = itens.find(x => x.id === opcao.id);
      if (existente) existente.qtd += qtd;
      else itens.push({ id: opcao.id, qtd });
    }
    if (m.raro && rng() < m.raro.chance) itens.push({ id: m.raro.ids[intEntre(rng, 0, m.raro.ids.length - 1)], qtd: 1 });
    return { baterias: intEntre(rng, m.baterias[0], m.baterias[1]), itens };
  }

  // ── Online (Etapa 2) ── espelho das regras do servidor (supabase_bando_online.sql);
  // aqui só servem para a interface explicar bloqueios antes de chamar o servidor.
  const LIMITES_LUTADOR = { atq: 17, def: 18, vida: 70 };
  const PVP = {
    viagemMin: 5, escudoHoras: 6, ataquesPorDia: 3, faixaNivel: 2, onlineMin: 5,
    saquePct: 0.15, saqueMaxBaterias: 200, saqueItens: 3, saqueItemPct: 0.25,
    milicia: { atq: 2, def: 1, vida: 25 },
    pontos: { vitoria: 10, defesa: 5, derrota: -3 },
    xp: { vitoria: 60, defesa: 50, derrota: 10 },
  };

  // Moradores lutam como milícia quando não há defensores (no mínimo 1 miliciano)
  function montarMilicia(moradores, bonusDef) {
    return Array.from({ length: Math.max(1, moradores) }, (_, i) => ({
      id: `milicia-${i + 1}`, nome: `Miliciano ${i + 1}`,
      atq: PVP.milicia.atq, def: PVP.milicia.def + bonusDef, vida: PVP.milicia.vida,
    }));
  }

  // Dia de jogo dos limites diários (horário de Brasília), no formato AAAA-MM-DD
  function hojeBrasilia(agora) {
    return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }

  function estaOnline(vistoEm, agora) {
    return agora - new Date(vistoEm) < PVP.onlineMin * 60000;
  }

  // ⚔️/🛡️ estimados de um perfil público (defensores com bônus, ou a milícia)
  function poderPerfil(perfil) {
    const time = perfil.defensores?.length
      ? perfil.defensores.map(l => ({ ...l, def: l.def + (perfil.bonus_def || 0) }))
      : montarMilicia(perfil.moradores || 0, perfil.bonus_def || 0);
    return time.reduce((p, l) => ({ atq: p.atq + l.atq, def: p.def + l.def }), { atq: 0, def: 0 });
  }

  // Motivo para não poder atacar (null = pode). eu/alvo: linhas de assentamentos_publicos.
  function motivoBloqueio(eu, alvo, agora, temProntos) {
    if (!temProntos) return 'Sem combatentes prontos';
    if (Math.abs(eu.nivel - alvo.nivel) > PVP.faixaNivel) return 'Fora da sua faixa de nível';
    if (alvo.escudo_ate && new Date(alvo.escudo_ate) > agora) {
      return `Protegido até ${new Date(alvo.escudo_ate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    }
    const mesmoDia = eu.ataques_dia === hojeBrasilia(agora);
    if (mesmoDia && eu.ataques_qtd >= PVP.ataquesPorDia) return `Limite de ${PVP.ataquesPorDia} ataques hoje`;
    if (mesmoDia && (eu.alvos_dia || []).includes(alvo.user_id)) return 'Já atacado hoje';
    return null;
  }

  const api = {
    XP_NIVEIS, NIVEL_MAX, XP_EVENTO, CATEGORIAS, COMBATE_EQUIP, SLOTS_COMBATENTE, NOMES_COMBATENTE, MISSOES,
    nivelPorXp, xpParaNivel, limiteBando, sortearCategoria, gerarRecruta, statsLutador,
    gerarInimigos, gerarInvasores, curaDiaria, estadoAposCombate, sortearLoot,
    LIMITES_LUTADOR, PVP, montarMilicia, hojeBrasilia, estaOnline, poderPerfil, motivoBloqueio,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(raiz, api);
})(typeof window !== 'undefined' ? window : globalThis);
