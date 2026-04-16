/**
 * ============================================================
 * ATÉ AMANHÃ — script.js
 * Jogo idle de sobrevivência pós-apocalíptico
 * ============================================================
 */

'use strict';

// ============================================================
// SUPABASE — inicialização e autenticação
// ============================================================

// Garante que apenas uma tela fica visível por vez
function mostrarTela(id) {
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  document.getElementById(id)?.classList.add('ativa');
}

let _sb = null; // cliente Supabase (null = modo offline)

function getSB() {
  if (_sb) return _sb;
  try {
    if (
      typeof window.supabase === 'undefined' ||
      typeof SUPABASE_URL === 'undefined'    ||
      SUPABASE_URL === 'COLE_AQUI_SUA_URL'
    ) return null;
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    _sb.auth.onAuthStateChange((_event, session) => {
      _sbUser = session?.user ?? null;
    });
    return _sb;
  } catch (e) { return null; }
}

let _sbUser = null; // usuário autenticado atual

// ── Autenticação ────────────────────────────────────────────

async function sbLogin(email, senha) {
  const sb = getSB();
  if (!sb) throw new Error('Supabase não configurado.');
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
  _sbUser = data.user;
  return data.user;
}

async function sbRegistrar(email, senha) {
  const sb = getSB();
  if (!sb) throw new Error('Supabase não configurado.');
  const { data, error } = await sb.auth.signUp({ email, password: senha });
  if (error) throw error;
  _sbUser = data.user;
  return data.user;
}

async function sbLogout() {
  const sb = getSB();
  if (!sb) return;
  await sb.auth.signOut();
  _sbUser = null;
}

async function sbGetSession() {
  const sb = getSB();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  if (data?.session?.user) { _sbUser = data.session.user; }
  return data?.session ?? null;
}

// ── Cloud save ──────────────────────────────────────────────

async function sbSalvar(dados) {
  const sb = getSB();
  if (!sb || !_sbUser) return false;
  const { error } = await sb.from('saves').upsert({
    user_id:    _sbUser.id,
    data:       dados,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) console.error('[Save] Falha ao salvar na nuvem:', error.message);
  return !error;
}

async function sbCarregar() {
  const sb = getSB();
  if (!sb || !_sbUser) return null;
  const { data, error } = await sb
    .from('saves')
    .select('data')
    .eq('user_id', _sbUser.id)
    .single();
  if (error) { console.error('[Save] Falha ao carregar da nuvem:', error.message); return null; }
  if (!data) return null;
  return data.data;
}

// ── Bazar ───────────────────────────────────────────────────

async function sbCarregarBazar() {
  const sb = getSB();
  if (!sb || !_sbUser) return [];
  const { data } = await sb
    .from('bazar')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(60);
  return data || [];
}

async function sbAnunciarBazar(itemId, itemNome, itemIcone, qtd, preco) {
  const sb = getSB();
  if (!sb || !_sbUser) return false;
  const { error } = await sb.from('bazar').insert({
    vendedor_id:   _sbUser.id,
    vendedor_nome: estado.personagem.nome || 'Anônimo',
    item_id:    itemId,
    item_nome:  itemNome,
    item_icone: itemIcone,
    qtd,
    preco
  });
  return !error;
}

async function sbRetirarAnuncio(listingId) {
  const sb = getSB();
  if (!sb || !_sbUser) return false;
  const { error } = await sb.from('bazar').delete().eq('id', listingId).eq('vendedor_id', _sbUser.id);
  return !error;
}

async function sbComprarDoBazar(listingId, preco) {
  const sb = getSB();
  if (!sb || !_sbUser) return { ok: false, erro: 'Offline' };
  const { data, error } = await sb.rpc('comprar_do_bazar', {
    p_listing_id: listingId,
    p_buyer_id:   _sbUser.id,
    p_preco:      preco
  });
  if (error) return { ok: false, erro: error.message };
  return data;
}

// ── Aplicar pilhas pendentes (crédito de vendas) ─────────────

function aplicarPilhasPendentes(saveData) {
  const pendentes = saveData?.pilhas_pendentes;
  if (!pendentes || pendentes <= 0) return;
  adicionarItem(ITENS.pilha, pendentes);
  log(`🔋 +${pendentes} Pilhas recebidas de vendas na Barraca!`, 'log-sucesso');
  mostrarToast(`🔋 +${pendentes} Pilhas da Barraca`);
  // Limpar pendentes no save
  sbSalvar(montarDadosSave());
}

// ============================================================
// DADOS: PERSONAGEM
// ============================================================

const AVATARES = ['🧔', '👩', '🧓', '🧒'];

const TRACOS = {
  resistente: {
    nome: 'Resistente', icone: '💪',
    desc: 'Vida máx +20%. Perde vida mais devagar.',
    efeitos: { vidaMax: 120, vidaDecay: 0.7 }
  },
  ansioso: {
    nome: 'Ansioso', icone: '😰',
    desc: '+15% chance de loot raro. Estresse acumula mais rápido.',
    efeitos: { lootBonus: 1.15, estresseMulti: 1.3 }
  },
  economico: {
    nome: 'Econômico', icone: '🧠',
    desc: 'Fome/sede aumentam 25% mais devagar.',
    efeitos: { consumoMulti: 0.75 }
  },
  medico: {
    nome: 'Ex-Médico', icone: '🩹',
    desc: 'Itens de cura 50% mais eficazes. Começa com kit de primeiros socorros.',
    efeitos: { curaBonus: 1.5 }
  }
};

// ============================================================
// DADOS: CATÁLOGO DE ITENS
// tipo: consumivel | material | medicinal | leitura | ferramenta
// ============================================================

const ITENS = {
  // Materiais brutos
  sucata:       { id: 'sucata',       nome: 'Sucata',              icone: '🔩', tipo: 'material'   },
  pano:         { id: 'pano',         nome: 'Trapo',               icone: '🧻', tipo: 'material'   },
  pilha:        { id: 'pilha',        nome: 'Bateria',             icone: '🔋', tipo: 'material'   },
  faca:         { id: 'faca',         nome: 'Faca de Cozinha',     icone: '🔪', tipo: 'ferramenta' },
  arame:        { id: 'arame',        nome: 'Arame',               icone: '〰️',  tipo: 'material'   },
  madeira:      { id: 'madeira',      nome: 'Madeira',             icone: '🪵', tipo: 'material'   },

  // Consumíveis
  comida:       { id: 'comida',       nome: 'Comida Enlatada',     icone: '🥫', tipo: 'consumivel', efeitos: { fome: -30 } },
  agua_suja:    { id: 'agua_suja',    nome: 'Água Suja',           icone: '🪣', tipo: 'consumivel', efeitos: { sede: -20, vida: -5 } },
  agua_limpa:   { id: 'agua_limpa',   nome: 'Água Limpa',          icone: '💧', tipo: 'consumivel', efeitos: { sede: -35 } },
  bebida:       { id: 'bebida',       nome: 'Bebida Alcoólica',    icone: '🍶', tipo: 'consumivel', efeitos: { estresse: -20, vida: -5, vicio: 10 } },

  // Medicinais de campo
  remedio:      { id: 'remedio',      nome: 'Analgésico',          icone: '💊', tipo: 'medicinal',  efeitos: { vida: 15, estresse: -10 } },
  kit:          { id: 'kit',          nome: 'Kit Primeiros Socorros', icone: '🩹', tipo: 'medicinal', efeitos: { vida: 35, estresse: -5 } },
  soro:         { id: 'soro',         nome: 'Soro Fisiológico',    icone: '💉', tipo: 'medicinal',  efeitos: { sede: -40, vida: 10 } },
  atadura:      { id: 'atadura',      nome: 'Atadura',             icone: '🩺', tipo: 'medicinal',  efeitos: { vida: 10 } },
  kit_raro:     { id: 'kit_raro',     nome: 'Kit Cirúrgico',       icone: '🔬', tipo: 'medicinal',  efeitos: { vida: 60 } },

  // Craftáveis básicos (mochila)
  curativo:      { id: 'curativo',      nome: 'Curativo Caseiro',     icone: '🩸', tipo: 'medicinal',  efeitos: { vida: 20 } },
  agua_filtrada: { id: 'agua_filtrada', nome: 'Água Filtrada',        icone: '🫗', tipo: 'consumivel', efeitos: { sede: -30 } },
  tocha:         { id: 'tocha',         nome: 'Tocha Improvisada',    icone: '🔦', tipo: 'ferramenta' },
  lanterna:      { id: 'lanterna',      nome: 'Lanterna Improvisada', icone: '💡', tipo: 'ferramenta' },

  // Craftáveis de bancada
  armadilha:    { id: 'armadilha',    nome: 'Armadilha',           icone: '🪤', tipo: 'ferramenta' },
  lanca:        { id: 'lanca',        nome: 'Lança Improvisada',   icone: '🗡️', tipo: 'ferramenta' },
  arco:         { id: 'arco',         nome: 'Arco Rudimentar',     icone: '🏹', tipo: 'ferramenta' },
  kit_avancado: { id: 'kit_avancado', nome: 'Kit Médico Avançado', icone: '💼', tipo: 'medicinal',  efeitos: { vida: 55, estresse: -15 } },
  carvao_ativado: { id: 'carvao_ativado', nome: 'Carvão Ativado', icone: '🖤', tipo: 'medicinal', efeitos: { vida: 5 }, desc: 'Adsorvente de toxinas. Trata envenenamentos e intoxicações.' },
  tala:           { id: 'tala',           nome: 'Tala Improvisada',  icone: '🦯', tipo: 'medicinal', efeitos: { vida: 5 }, desc: 'Imobiliza e protege um tornozelo torcido. Trata contusão.' },
  filtro:         { id: 'filtro',         nome: 'Filtro de Água',       icone: '🧪', tipo: 'ferramenta' },

  // Cultivo — sementes e colheitas
  semente_canhamo:  { id: 'semente_canhamo',  nome: 'Semente de Cânhamo',  icone: '🌱', tipo: 'material' },
  semente_erva:     { id: 'semente_erva',     nome: 'Semente de Erva',     icone: '🌿', tipo: 'material' },
  semente_abobora:  { id: 'semente_abobora',  nome: 'Semente de Abóbora',  icone: '🎃', tipo: 'material' },
  canhamo:          { id: 'canhamo',          nome: 'Cânhamo',             icone: '🌾', tipo: 'material' },
  erva_medicinal:   { id: 'erva_medicinal',   nome: 'Erva Medicinal',      icone: '🍃', tipo: 'material' },
  abobora:          { id: 'abobora',          nome: 'Abóbora',             icone: '🎃', tipo: 'consumivel', efeitos: { fome: -35 } },

  // ── Itens raros — encontrados apenas em eventos de busca ──
  revolver:       { id: 'revolver',       nome: 'Revólver .38',          icone: '🔫', tipo: 'raro',      desc: 'Calibre .38, sem munição. Vale uma fortuna no mercado certo.' },
  faca_tatica:    { id: 'faca_tatica',    nome: 'Faca Tática Militar',   icone: '🗡️',  tipo: 'raro',      desc: 'Lâmina de aço inoxidável, cabo emborrachado. Nunca enferrujou.' },
  machado:        { id: 'machado',        nome: 'Machado de Bombeiro',   icone: '🪓', tipo: 'raro',      desc: 'Vermelho, pesado, com a marca do Corpo de Bombeiros. Ainda cortante.' },
  relogio_ouro:   { id: 'relogio_ouro',  nome: 'Relógio de Ouro',       icone: '⌚', tipo: 'raro',      desc: 'Ainda funciona. Vale mais do que qualquer item que você já carregou.' },
  joias:          { id: 'joias',          nome: 'Joias Diversas',        icone: '💍', tipo: 'raro',      desc: 'Um punhado de anéis e correntes. Ouro e prata — os únicos valores que sobraram.' },
  camera:         { id: 'camera',         nome: 'Câmera Digital',        icone: '📷', tipo: 'raro',      desc: 'A bateria ainda segura carga. As fotos dentro são de outra época.' },
  binoculo:       { id: 'binoculo',       nome: 'Binóculo Militar',      icone: '🔭', tipo: 'raro',      desc: 'Alcance de 8x, revestimento anti-reflexo. Quem vigia vive mais.' },
  pen_drive:      { id: 'pen_drive',      nome: 'Pen Drive Criptografado', icone: '💾', tipo: 'raro',    desc: 'Dados militares ou apenas fotos de família? Ninguém sabe. Todos pagam para descobrir.' },
  doc_classificado: { id: 'doc_classificado', nome: 'Documento Classificado', icone: '📁', tipo: 'raro', desc: 'Carimbo vermelho: RESTRITO. Coordenadas, listas, nomes riscados.' },
  whisky_fino:    { id: 'whisky_fino',    nome: 'Whisky 18 Anos',        icone: '🥃', tipo: 'raro',      efeitos: { estresse: -40, vicio: 25, vida: -5 }, desc: 'Garrafa selada, lacre intacto. Drena estresse — e também você.' },
  remedio_exp:    { id: 'remedio_exp',    nome: 'Medicamento Experimental', icone: '🧬', tipo: 'raro',   efeitos: { vida: 50, estresse: -20 }, desc: 'Rótulo apagado. Embalagem hospitalar. Alto risco, alto retorno.' },
  colar_id:       { id: 'colar_id',       nome: 'Placa de Identificação Militar', icone: '🪖', tipo: 'raro', desc: 'Dog tag. Nome, número de série, tipo sanguíneo. De quem era isso?' },

  // Culinária (produzidos na Fogueira)
  comida_quente:  { id: 'comida_quente',  nome: 'Refeição Quente',      icone: '🍲', tipo: 'consumivel', efeitos: { fome: -55, estresse: -10 }, desc: 'Uma refeição quente faz tudo parecer menos terrível.' },
  sopa:           { id: 'sopa',           nome: 'Sopa de Emergência',   icone: '🥣', tipo: 'consumivel', efeitos: { fome: -25, sede: -20, vida: 8 }, desc: 'Água e sobras cozidas. Nutre e hidrata.' },

  // Entretenimento
  revista_hq: {
    id: 'revista_hq',
    nome: 'Revisita em Quadrinhos',
    icone: '📔',
    tipo: 'consumivel',
    efeitos: { estresse: -25 },
    desc: '"Sombra de Ferro #47 — O último bunker". Um herói blindado tentando salvar o que sobrou da humanidade. As páginas estão amassadas, mas a história ainda prende.'
  },
  // O sistema escolhe automaticamente qual receita ensinar no momento do drop
  manual_socorros: {
    id: 'manual_socorros', nome: 'Manual de Primeiros Socorros', icone: '📕', tipo: 'leitura',
    catalogoId: 'socorros',
    desc: 'Um manual médico rasgado. Ensina técnicas de primeiros socorros.'
  },
  guia_sobrev: {
    id: 'guia_sobrev', nome: 'Guia de Sobrevivência', icone: '📗', tipo: 'leitura',
    catalogoId: 'sobrevivencia',
    desc: 'Um guia prático de sobrevivência em situações extremas.'
  },
  catalogo_ferramentas: {
    id: 'catalogo_ferramentas', nome: 'Catálogo de Ferramentas', icone: '📘', tipo: 'leitura',
    catalogoId: 'ferramentas',
    desc: 'Um catálogo ilustrado de construção de ferramentas improvisadas.'
  },

  // Anotações — desbloqueiam locais
  anotacao_hospital: {
    id: 'anotacao_hospital',
    nome: 'Anotação: Hospital Regional',
    icone: '📄',
    tipo: 'anotacao',
    localId: 'hospital',
    lore: `"Fui até o Regional ontem. Ainda tem remédio lá dentro — vi pela janela do segundo andar. Mas tem gente acampada no estacionamento. Não pareciam amigáveis. Se você for, vai pelo corredor de serviço, nos fundos. Evita o saguão principal."`,
    revelaLocal: { nome: 'Hospital Regional', perigo: 'alto', tempo: '30s', icone: '🏥' }
  },
  anotacao_floresta: {
    id: 'anotacao_floresta',
    nome: 'Anotação: Mata do Cônego',
    icone: '📄',
    tipo: 'anotacao',
    localId: 'floresta',
    lore: `"A mata atrás do bairro ainda tá intacta. Encontrei armadilhas de caça lá — alguém passou antes de mim. Tem fruta, cogumelo, e um riacho que não tá completamente seco. Longe de tudo, mas vale o caminho se você precisar de água."`,
    revelaLocal: { nome: 'Mata do Cônego', perigo: 'medio', tempo: '25s', icone: '🌲' }
  },
  anotacao_posto: {
    id: 'anotacao_posto',
    nome: 'Anotação: Posto Km 14',
    icone: '📄',
    tipo: 'anotacao',
    localId: 'posto',
    lore: `"O posto na beira da estrada ainda tem algumas latas e ferramentas na oficina. Alguém já roubou o combustível todo, mas a loja de conveniência não foi completamente esvaziada. Cuidado com o cachorro solto que ficou por lá. Não late. Só ataca."`,
    revelaLocal: { nome: 'Posto Km 14', perigo: 'medio', tempo: '15s', icone: '⛽' }
  },
  anotacao_deposito: {
    id: 'anotacao_deposito',
    nome: 'Anotação: Depósito Logístico',
    icone: '📄',
    tipo: 'anotacao',
    localId: 'deposito_logistico',
    lore: `"Tem um galpão enorme perto da antiga zona industrial. Prateleiras ainda cheias — parece que o pessoal saiu às pressas e não levou tudo. Vi caixas de comida não perecível, paletes de madeira, bebidas. O problema é que virou ponto de encontro de grupos. Vá cedo, rápido, e saia antes de chamar atenção."`,
    revelaLocal: { nome: 'Depósito Logístico', perigo: 'medio', tempo: '45s', icone: '🏭' }
  },
  anotacao_garagem: {
    id: 'anotacao_garagem',
    nome: 'Anotação: Garagem Industrial',
    icone: '📄',
    tipo: 'anotacao',
    localId: 'garagem',
    lore: `"A oficina mecânica no fim da Rua 7 ainda tem muita coisa útil. Carros enfileirados, ferramentas espalhadas pelo chão, prateleiras com peças. Um grupo passou por lá semana passada mas não levou tudo — era pesado demais pra carregar. Cuidado com o buraco no piso da fossa de troca de óleo."`,
    revelaLocal: { nome: 'Garagem Industrial', perigo: 'medio', tempo: '55s', icone: '🔧' }
  },
  anotacao_fabrica: {
    id: 'anotacao_fabrica',
    nome: 'Anotação: Fábrica Têxtil',
    icone: '📄',
    tipo: 'anotacao',
    localId: 'fabrica_textil',
    lore: `"A fábrica de tecidos perto do viaduto ainda tem rolos e rolos de pano. O maquinário enferrujou mas a matéria-prima sobrou. Tem fiação elétrica exposta em alguns corredores — não encoste. Vi arame e metal suficiente pra abastecer uma oficina inteira. Leva um canivete, tem lacres de aço em todo lugar."`,
    revelaLocal: { nome: 'Fábrica Têxtil', perigo: 'medio', tempo: '65s', icone: '🏗️' }
  },
  anotacao_subestacao: {
    id: 'anotacao_subestacao',
    nome: 'Anotação: Subestação Elétrica',
    icone: '📄',
    tipo: 'anotacao',
    localId: 'subestacao',
    lore: `"A subestação ainda tem pilhas industriais nos armários de controle — baterias de backup que nunca foram usadas. Lugar perigoso, metal cortante em todo canto, mas quem precisa de energia elétrica não tem escolha. Fui uma vez só. Saí com arranhões e pilhas suficientes pra três semanas."`,
    revelaLocal: { nome: 'Subestação Elétrica', perigo: 'alto', tempo: '75s', icone: '⚡' }
  },
  anotacao_silo: {
    id: 'anotacao_silo',
    nome: 'Anotação: Silo de Grãos',
    icone: '📄',
    tipo: 'anotacao',
    localId: 'silo',
    lore: `"Os silos no limite da zona industrial ainda têm grãos. Boa parte estragou com a umidade, mas o que ficou nos níveis mais altos ainda serve. Leva máscara se tiver — o pó lá dentro é sufocante. Longe de tudo e ninguém passa por lá, então é relativamente seguro. Só o silêncio incomoda."`,
    revelaLocal: { nome: 'Silo de Grãos', perigo: 'medio', tempo: '85s', icone: '🌾' }
  },
};

// ============================================================
// CATÁLOGOS DE RECEITAS
// Cada catálogo tem uma lista ordenada de receitas.
// Guias do mesmo tipo ensinam a próxima receita ainda não aprendida.
// ============================================================

const CATALOGOS = {
  socorros: {
    receitas: ['curativo', 'kit_avancado'],
    nomes:    ['Curativo Caseiro', 'Kit Médico Avançado'],
  },
  sobrevivencia: {
    receitas: ['agua_filtrada', 'tocha', 'armadilha'],
    nomes:    ['Água Filtrada', 'Tocha Improvisada', 'Armadilha'],
  },
  ferramentas: {
    receitas: ['lanca', 'arco', 'filtro', 'lanterna'],
    nomes:    ['Lança Improvisada', 'Arco Rudimentar', 'Filtro de Água', 'Lanterna Improvisada'],
  },
};

/**
 * Retorna a próxima receita não aprendida de um catálogo.
 * Retorna null se todas já foram aprendidas.
 */
function proximaReceitaCatalogo(catalogoId) {
  const cat = CATALOGOS[catalogoId];
  if (!cat) return null;
  return cat.receitas.find(id => !estado.receitasAprendidas.includes(id)) || null;
}

// ============================================================
// ITENS EQUIPÁVEIS
// slot: cabeca | peito | maos | pernas | pes | arma | acessorio
// efeitos de equipamento são passivos enquanto equipados
// ============================================================

const ITENS_EQUIPAVEIS = {
  // Armas (craftáveis existentes reaproveitados)
  lanca: {
    slot: 'arma',
    efeitos: { vidaDecayMulti: 0.85 }, // menos dano em eventos
    desc: 'Reduz dano recebido em eventos de exploração.'
  },
  arco: {
    slot: 'arma',
    efeitos: { lootBonus: 0.1 },
    desc: '+10% chance de loot em explorações.'
  },
  faca: {
    slot: 'arma',
    efeitos: { vidaDecayMulti: 0.9 },
    desc: 'Alguma proteção. Menos dano em confrontos.'
  },

  machado: {
    slot: 'arma',
    efeitos: { vidaDecayMulti: 0.75, lootBonus: 0.1 },
    desc: 'Pesado e intimidador. Reduz bastante o dano recebido e melhora o loot.'
  },

  // Ferramentas como equipamento
  lanterna: {
    slot: 'acessorio',
    efeitos: { lootBonus: 0.05 },
    desc: 'Ilumina o caminho. Leve bônus de loot.'
  },
  tocha: {
    slot: 'acessorio',
    efeitos: { estresseRedux: 0.5 }, // estresse reduz mais rápido
    desc: 'A luz reconforta. Estresse diminui mais depressa.'
  },
};

const SLOTS_EQUIP = ['cabeca', 'peito', 'maos', 'pernas', 'pes', 'arma', 'acessorio'];

const SLOT_LABELS = {
  cabeca:    'Cabeça',
  peito:     'Peito',
  maos:      'Mãos',
  pernas:    'Pernas',
  pes:       'Pés',
  arma:      'Arma',
  acessorio: 'Acessório',
};
// Preço em Pilhas Velhas (id: 'pilha')
// ============================================================

// Preço base reflete raridade e escassez. O preço final flutua dia a dia.
// peso: chance de aparecer no estoque (maior = mais comum)
const MERCADO_POOL = [
  // Tier 1 — materiais brutos (comuns, baratos)
  { itemId: 'sucata',     precoBase: 1, qtd: 3, peso: 18 },
  { itemId: 'pano',       precoBase: 1, qtd: 3, peso: 18 },
  { itemId: 'madeira',    precoBase: 1, qtd: 3, peso: 16 },
  { itemId: 'agua_suja',  precoBase: 1, qtd: 2, peso: 12 },
  // Tier 2 — recursos processados (moderados)
  { itemId: 'comida',     precoBase: 2, qtd: 2, peso: 16 },
  { itemId: 'agua_limpa', precoBase: 2, qtd: 2, peso: 14 },
  { itemId: 'arame',      precoBase: 2, qtd: 2, peso: 12 },
  { itemId: 'bebida',     precoBase: 3, qtd: 1, peso: 10 },
  // Tier 3 — itens úteis (incomuns)
  { itemId: 'atadura',    precoBase: 3, qtd: 1, peso: 10 },
  { itemId: 'curativo',   precoBase: 4, qtd: 1, peso: 9  },
  { itemId: 'remedio',    precoBase: 4, qtd: 1, peso: 9  },
  { itemId: 'faca',       precoBase: 4, qtd: 1, peso: 8  },
  { itemId: 'revista_hq', precoBase: 3, qtd: 1, peso: 8  },
  // Tier 4 — raros e valiosos
  { itemId: 'carvao_ativado', precoBase: 5, qtd: 1, peso: 5 },
  { itemId: 'soro',           precoBase: 5, qtd: 1, peso: 5 },
  { itemId: 'tocha',          precoBase: 5, qtd: 1, peso: 5 },
  { itemId: 'kit',            precoBase: 7, qtd: 1, peso: 4 },
  { itemId: 'lanterna',       precoBase: 7, qtd: 1, peso: 3 },
  { itemId: 'kit_raro',       precoBase: 10, qtd: 1, peso: 2 },
];

const MERCADO_MAX_ITENS = 5;

// Custos de construção/upgrade do depósito por nível (índice = nível a construir).
const DEPOSITO_CUSTOS = [
  null,                                             // L0 — estado inicial (não construído)
  { madeira: 6,  sucata: 4  },                     // L1 — construir
  { madeira: 8,  sucata: 6  },                     // L2
  { madeira: 10, sucata: 8,  arame: 2 },           // L3
  { madeira: 12, sucata: 10, arame: 4 },           // L4
  { madeira: 15, sucata: 12, arame: 6 },           // L5
];

// Preço de venda de cada item (em Pilhas Velhas). Itens ausentes não são vendáveis.
// Preços base de venda (itens brutos / encontrados / comprados)
// Preços de venda base (itens brutos/encontrados). Multiplicados pelo fatorVenda do dia.
const VENDA_PRECOS = {
  // Tier 1
  sucata:        1,
  pano:          1,
  madeira:       1,
  agua_suja:     1,
  // Tier 2
  comida:        1,
  agua_limpa:    2,
  arame:         2,
  bebida:        2,
  pilha:         2,
  // Tier 3
  atadura:       2,
  curativo:      3,
  remedio:       3,
  faca:          3,
  revista_hq:    2,
  // Tier 4
  carvao_ativado: 4,
  soro:          4,
  tocha:         3,
  kit:           5,
  lanterna:      5,
  kit_raro:      8,
  // Tier 5 — Itens raros de eventos de busca
  faca_tatica:   14,
  machado:       16,
  binoculo:      18,
  camera:        20,
  colar_id:      22,
  whisky_fino:   24,
  revolver:      30,
  remedio_exp:   32,
  pen_drive:     36,
  canhamo:       1,
  erva_medicinal:3,
  abobora:       2,
  semente_canhamo: 1,
  semente_erva:    2,
  semente_abobora: 2,
  joias:         38,
  relogio_ouro:  45,
  doc_classificado: 50,
};

/**
 * Retorna o preço de venda de um item.
 * Itens craftados valem: soma dos preços dos ingredientes + 5.
 * Itens brutos usam VENDA_PRECOS diretamente.
 * Retorna null se o item não for vendável.
 */
function getPrecoVenda(itemId) {
  const fator = estado?.mercado?.fatorVenda ?? 1;

  // Itens craftados: soma dos ingredientes + bônus fixo, com fator do dia
  const receita = (typeof RECEITAS !== 'undefined' ? RECEITAS : []).find(r => r.id === itemId)
    || (typeof RECEITAS_FOGUEIRA !== 'undefined' ? RECEITAS_FOGUEIRA : []).find(r => r.id === itemId);
  if (receita) {
    const soma = Object.entries(receita.ingredientes)
      .reduce((total, [id, qtd]) => total + (VENDA_PRECOS[id] || 1) * qtd, 0);
    return Math.max(1, Math.round((soma + 5) * fator));
  }

  const base = VENDA_PRECOS[itemId];
  if (base == null) return null;
  return Math.max(1, Math.round(base * fator));
}

// ============================================================
// DADOS: RECEITAS
// ============================================================

const RECEITAS = [
  // Básicas — visíveis desde o início
  {
    id: 'arame',
    ingredientes: { sucata: 2 },
    bancada: false,
    revelada: true
  },
  // Básicas — precisam de leitura
  {
    id: 'curativo',
    ingredientes: { pano: 2 },
    bancada: false,
    revelada: false
  },
  {
    id: 'agua_filtrada',
    ingredientes: { agua_suja: 1, pano: 1 },
    bancada: false,
    revelada: false
  },
  {
    id: 'tocha',
    ingredientes: { pano: 1, pilha: 1, sucata: 1 },
    bancada: false,
    revelada: false
  },
  {
    id: 'lanterna',
    ingredientes: { pilha: 1, sucata: 2 },
    bancada: false,
    revelada: false
  },
  // Bancada — precisam de leitura
  {
    id: 'armadilha',
    ingredientes: { arame: 2, sucata: 2 },
    bancada: true,
    revelada: false
  },
  {
    id: 'lanca',
    ingredientes: { sucata: 3, faca: 1, pano: 1 },
    bancada: true,
    revelada: false
  },
  {
    id: 'arco',
    ingredientes: { madeira: 2, arame: 1 },
    bancada: true,
    revelada: false
  },
  {
    id: 'kit_avancado',
    ingredientes: { kit: 1, remedio: 2, pano: 2 },
    bancada: true,
    revelada: false
  },
  {
    id: 'filtro',
    ingredientes: { sucata: 4, pano: 3, arame: 1 },
    bancada: true,
    revelada: false
  },
  {
    id: 'tala',
    ingredientes: { madeira: 1, pano: 2 },
    bancada: false,
    revelada: true
  },
  {
    id: 'pano',
    ingredientes: { canhamo: 2 },
    bancada: false,
    revelada: true
  },
];

const CUSTO_BANCADA = { sucata: 8, pano: 3 };

const CULTIVO_CONFIG = {
  semente_canhamo: { nome: 'Cânhamo',       itemId: 'canhamo',        qtd: 2, dias: 2, icone: '🌾' },
  semente_erva:    { nome: 'Erva Medicinal', itemId: 'erva_medicinal', qtd: 1, dias: 3, icone: '🍃' },
  semente_abobora: { nome: 'Abóbora',        itemId: 'abobora',        qtd: 2, dias: 2, icone: '🎃' },
};

// ============================================================
// DADOS: RECEITAS DA FOGUEIRA
// ============================================================
const RECEITAS_FOGUEIRA = [
  {
    id: 'comida_quente',
    ingredientes: { comida: 2 },
    desc: 'Dobra o valor nutricional da comida enlatada.'
  },
  {
    id: 'sopa',
    ingredientes: { comida: 1, agua_suja: 1 },
    desc: 'Cozinhar neutraliza parte das toxinas da água suja.'
  },
  {
    id: 'remedio',
    ingredientes: { erva_medicinal: 2 },
    desc: 'Ferva as ervas até virar um chá concentrado. Alivia dores e ferimentos.'
  },
];

// ============================================================
// DADOS: LOOT
// ============================================================

const LOOT_TABLE = {
  ruinas: [
    { ...ITENS.sucata,         peso: 40, qtd: [1,3] },
    { ...ITENS.comida,         peso: 28, qtd: [1,2] },
    { ...ITENS.pano,           peso: 25, qtd: [1,2] },
    { ...ITENS.agua_suja,      peso: 18, qtd: [1,1] },
    { ...ITENS.pilha,          peso: 14, qtd: [1,2] },
    { ...ITENS.madeira,        peso: 10, qtd: [1,2] },
    { ...ITENS.carvao_ativado, peso: 5,  qtd: [1,1] },
    { ...ITENS.guia_sobrev,          peso: 15, qtd: [1,1] },
    { ...ITENS.anotacao_floresta,    peso: 15, qtd: [1,1] },
    { ...ITENS.anotacao_posto,       peso: 15, qtd: [1,1] },
    { ...ITENS.anotacao_deposito,    peso: 10, qtd: [1,1] },
  ],
  mercado: [
    { ...ITENS.comida,    peso: 35, qtd: [1,3] },
    { ...ITENS.agua_limpa,peso: 28, qtd: [1,2] },
    { ...ITENS.faca,      peso: 10, qtd: [1,1] },
    { ...ITENS.remedio,   peso: 14, qtd: [1,2] },
    { ...ITENS.sucata,    peso: 22, qtd: [1,2] },
    { ...ITENS.bebida,    peso: 9,  qtd: [1,1] },
    { ...ITENS.semente_canhamo,  peso: 10, qtd: [1,2] },
    { ...ITENS.semente_abobora,  peso: 10, qtd: [1,1] },
    { ...ITENS.catalogo_ferramentas, peso: 15, qtd: [1,1] },
    { ...ITENS.anotacao_hospital,    peso: 15, qtd: [1,1] },
  ],
  hospital: [
    { ...ITENS.kit,            peso: 20, qtd: [1,1] },
    { ...ITENS.remedio,        peso: 20, qtd: [1,3] },
    { ...ITENS.soro,           peso: 14, qtd: [1,2] },
    { ...ITENS.atadura,        peso: 14, qtd: [1,2] },
    { ...ITENS.carvao_ativado, peso: 18, qtd: [1,2] },
    { ...ITENS.comida,         peso: 9,  qtd: [1,1] },
    { ...ITENS.kit_raro,       peso: 4,  qtd: [1,1] },
    { ...ITENS.manual_socorros, peso: 15, qtd: [1,1] },
  ],
  floresta: [
    { ...ITENS.madeira,         peso: 40, qtd: [2,4] },
    { ...ITENS.pano,            peso: 20, qtd: [1,2] },
    { ...ITENS.agua_suja,       peso: 25, qtd: [1,2] },
    { ...ITENS.comida,          peso: 15, qtd: [1,1] },
    { ...ITENS.sucata,          peso: 10, qtd: [1,2] },
    { ...ITENS.guia_sobrev,     peso: 12, qtd: [1,1] },
    { ...ITENS.semente_canhamo, peso: 22, qtd: [1,2] },
    { ...ITENS.semente_erva,    peso: 18, qtd: [1,1] },
    { ...ITENS.semente_abobora, peso: 18, qtd: [1,1] },
  ],
  posto: [
    { ...ITENS.sucata,    peso: 35, qtd: [2,4] },
    { ...ITENS.pilha,     peso: 25, qtd: [1,3] },
    { ...ITENS.comida,    peso: 20, qtd: [1,2] },
    { ...ITENS.faca,      peso: 10, qtd: [1,1] },
    { ...ITENS.pano,      peso: 15, qtd: [1,2] },
    { ...ITENS.agua_limpa,peso: 12, qtd: [1,1] },
    { ...ITENS.catalogo_ferramentas, peso: 12, qtd: [1,1] },
    { ...ITENS.revista_hq,           peso: 18, qtd: [1,1] },
    { ...ITENS.anotacao_garagem,     peso: 10, qtd: [1,1] },
  ],
  deposito_logistico: [
    { ...ITENS.comida,    peso: 40, qtd: [2,4] },
    { ...ITENS.madeira,   peso: 35, qtd: [2,5] },
    { ...ITENS.sucata,    peso: 30, qtd: [1,3] },
    { ...ITENS.bebida,    peso: 20, qtd: [1,2] },
    { ...ITENS.pano,      peso: 18, qtd: [1,2] },
    { ...ITENS.agua_limpa,peso: 15, qtd: [1,1] },
    { ...ITENS.pilha,     peso: 10, qtd: [1,2] },
    { ...ITENS.remedio,   peso: 6,  qtd: [1,1] },
    { ...ITENS.anotacao_subestacao, peso: 8, qtd: [1,1] },
  ],
  garagem: [
    { ...ITENS.sucata,    peso: 45, qtd: [2,5] },
    { ...ITENS.faca,      peso: 22, qtd: [1,2] },
    { ...ITENS.madeira,   peso: 20, qtd: [1,3] },
    { ...ITENS.pilha,     peso: 18, qtd: [1,3] },
    { ...ITENS.pano,      peso: 14, qtd: [1,2] },
    { ...ITENS.bebida,    peso: 10, qtd: [1,1] },
    { ...ITENS.arame,     peso: 16, qtd: [1,3] },
    { ...ITENS.anotacao_fabrica, peso: 10, qtd: [1,1] },
  ],
  fabrica_textil: [
    { ...ITENS.pano,      peso: 50, qtd: [2,5] },
    { ...ITENS.arame,     peso: 35, qtd: [2,4] },
    { ...ITENS.sucata,    peso: 28, qtd: [1,3] },
    { ...ITENS.madeira,   peso: 18, qtd: [1,2] },
    { ...ITENS.pilha,     peso: 12, qtd: [1,2] },
    { ...ITENS.faca,      peso: 8,  qtd: [1,1] },
    { ...ITENS.anotacao_silo, peso: 10, qtd: [1,1] },
  ],
  subestacao: [
    { ...ITENS.pilha,     peso: 50, qtd: [2,5] },
    { ...ITENS.arame,     peso: 40, qtd: [2,4] },
    { ...ITENS.sucata,    peso: 35, qtd: [2,4] },
    { ...ITENS.faca,      peso: 15, qtd: [1,1] },
    { ...ITENS.catalogo_ferramentas, peso: 12, qtd: [1,1] },
    { ...ITENS.madeira,   peso: 8,  qtd: [1,2] },
  ],
  silo: [
    { ...ITENS.comida,    peso: 55, qtd: [2,5] },
    { ...ITENS.madeira,   peso: 30, qtd: [2,4] },
    { ...ITENS.pano,      peso: 20, qtd: [1,2] },
    { ...ITENS.agua_suja, peso: 25, qtd: [1,2] },
    { ...ITENS.sucata,    peso: 12, qtd: [1,2] },
    { ...ITENS.bebida,    peso: 8,  qtd: [1,1] },
    { ...ITENS.semente_canhamo,  peso: 18, qtd: [1,2] },
    { ...ITENS.semente_erva,     peso: 14, qtd: [1,1] },
    { ...ITENS.semente_abobora,  peso: 18, qtd: [1,2] },
  ],
};

const EVENTOS_NEGATIVOS = {
  baixo: [
    { msg: 'Você torceu o tornozelo nas ruínas.', efeitos: { vida: -10, estresse: 5 }, condicao: 'contundido' },
    { msg: 'Um animal te assustou. Coração na garganta.', efeitos: { estresse: 15 } },
    { msg: 'Você cortou a mão em vidro quebrado.', efeitos: { vida: -8 }, condicao: 'sangramento' },
  ],
  medio: [
    { msg: 'Sobreviventes hostis te avistaram. Você fugiu com dificuldade.', efeitos: { vida: -15, estresse: 20 }, condicao: 'sangramento' },
    { msg: 'Você caiu em uma armadilha improvisada.', efeitos: { vida: -20, estresse: 10 }, condicao: 'contundido' },
    { msg: 'O cheiro do lugar te deixou enjoado.', efeitos: { vida: -5, estresse: 15 } },
    { msg: 'Tiros ao longe. Você se escondeu por horas.', efeitos: { estresse: 25 } },
  ],
  alto: [
    { msg: 'Confronto com pilhadores armados. Você sobreviveu, por pouco.', efeitos: { vida: -30, estresse: 30 }, condicao: 'sangramento' },
    { msg: 'O piso do hospital cedeu. Você se machucou ao cair.', efeitos: { vida: -25, estresse: 20 }, condicao: 'contundido' },
    { msg: 'Contaminação. O ambiente era mais perigoso do que parecia.', efeitos: { vida: -20, estresse: 15 } },
    { msg: 'Você foi cercado. Perdeu parte do loot para escapar.', efeitos: { vida: -15, estresse: 35 } },
  ]
};

const TICK_MS        = 1000;
const DIA_DURACAO    = 300;   // segundos de dia
const NOITE_DURACAO  = 120;   // segundos de noite
const CICLO_DURACAO  = DIA_DURACAO + NOITE_DURACAO; // 420s por ciclo completo

// Mensagens temáticas por local — sorteadas aleatoriamente em cada fase
const LOGS_ZONA = {
  ruinas: {
    saida:     ['Você deixa o abrigo e entra nas ruínas do bairro.', 'O asfalto rachado range sob seus pés.', 'Fumaça distante no horizonte. Você segue assim mesmo.'],
    chegada:   ['O silêncio aqui é pesado demais. Algo está errado.', 'Paredes desmoronadas escondem mais do que revelam.', 'Cheiro de mofo e concreto úmido. Lugar familiar, mesmo assim assustador.'],
    explorando:['Você vasculha os escombros com cuidado.', 'Cada cômodo pode esconder algo — ou alguém.', 'O vento move poeira. Você para. Escuta. Nada.', 'Marcas de fogo antigas nas paredes. Alguém esteve aqui antes.'],
    retorno:   ['Você carrega o que encontrou e volta pelo mesmo caminho.', 'Passos rápidos. Ficar parado nas ruínas de noite é suicídio.', 'Você sente os olhos nas costas. Pode ser paranoia. Pode não ser.'],
  },
  mercado: {
    saida:     ['O mercado abandonado ainda tem vida — do tipo errado.', 'Você vai de olho aberto. Saqueadores frequentam esse lugar.', 'Prateleiras vazias, mas nem todas. Você vai conferir.'],
    chegada:   ['O cheiro de alimento estragado domina o ar.', 'Corredores escuros, gôndolas tombadas. Parece um labirinto.', 'Alguém esteve aqui recentemente. As marcas no pó são frescas.'],
    explorando:['Você move caixas com cuidado para não fazer barulho.', 'Fundo do depósito — é aqui que sobra alguma coisa útil.', 'Cada som te faz segurar a respiração.', 'Você trabalha rápido. Ficar parado aqui é perigoso.'],
    retorno:   ['Você sai pelos fundos, longe da entrada principal.', 'De volta ao ar livre. Você respira fundo pela primeira vez em horas.', 'Caminho de volta mais longo — mas mais seguro.'],
  },
  hospital: {
    saida:     ['O Regional. Você preferia não precisar ir até lá.', 'Remédio não cresce em árvore. Vai ter que enfrentar o lugar.', 'Hospital Regional. Dizem que tem gente acampada lá. Dizem muita coisa.'],
    chegada:   ['As portas automáticas estão presas na metade. Você passa de lado.', 'Corredores imensos, luzes mortas. Cada passo ecoa.', 'Cheiro de éter e coisa pior. Você engole o enjoo e segue em frente.'],
    explorando:['Você verifica armário por armário no corredor de serviço.', 'A farmácia foi saqueada, mas nem tudo foi levado.', 'Um som de passos no andar de cima. Você congela. Espera. Some.', 'UTI vazia. Equipamentos tombados. Você não olha para as camas.'],
    retorno:   ['Você sai pelo corredor dos fundos, como foi instruído.', 'Ar fresco do lado de fora. Nunca pareceu tão bom.', 'Você jura para si mesmo que essa foi a última vez. Sabe que não foi.'],
  },
  floresta: {
    saida:     ['A mata do Cônego. Verde, úmida, e cheia de coisas vivas.', 'Você deixa o concreto para trás e entra na vegetação.', 'Dizem que a floresta ainda está intacta. Você vai ver com seus próprios olhos.'],
    chegada:   ['A mata fecha acima de você como um teto vivo.', 'Barulho de água em algum lugar. Você vai encontrar.', 'Insetos, pássaros, galhos. Mais vida aqui do que em qualquer rua da cidade.'],
    explorando:['Você segue o riacho procurando algo aproveitável.', 'Armadilhas antigas no chão — alguém caçou aqui. Você pisa com cuidado.', 'Cogumelos, raízes, galhos secos. Tudo serve para alguma coisa.', 'A floresta abafa o som. Você perde a noção de distância.'],
    retorno:   ['Você marca mentalmente o caminho de volta para a próxima vez.', 'De volta ao bairro. A mata some atrás de você como um sonho.', 'Pernas pesadas de barro, mas a mochila vale a lama.'],
  },
  posto: {
    saida:     ['O Posto Km 14. Longe, mas pode valer a pena.', 'Você pega a estrada sem saber bem o que vai encontrar.', 'Asfalto vazio em linha reta. Qualquer coisa na paisagem chama atenção.'],
    chegada:   ['As bombas de gasolina estão secas há meses. Mas a loja não foi esvaziada.', 'O letreiro piscava antes. Agora só enferruja.', 'Um cachorro avança de dentro da sombra. Você recua. Ele para. Vocês se observam.'],
    explorando:['Loja de conveniência: prateleiras na metade. Você trabalha rápido.', 'A oficina nos fundos ainda tem ferramentas na parede.', 'Você encontra uma caixa esquecida atrás do balcão.', 'O silêncio da estrada lá fora é diferente do silêncio da cidade.'],
    retorno:   ['Você volta pela lateral da estrada, fora do asfalto.', 'Km 14 some no horizonte. Você não olha para trás.', 'Pés doloridos. Valeu a caminhada — ou não. Você só vai saber quando chegar.'],
  },
  deposito_logistico: {
    saida:     ['O galpão industrial. Grande, cheio, e movimentado demais.', 'Você vai cedo para evitar os grupos que frequentam o lugar.', 'Zona industrial. Horizonte de concreto e silêncio mecânico.'],
    chegada:   ['Prateleiras de aço até o teto, a maioria ainda com carga.', 'O cheiro de papelão úmido e plástico velho domina o galpão.', 'Entrada pelos fundos. Você ouve vozes no setor A. Vai pelo B.'],
    explorando:['Caixas lacradas, paletes de madeira, produtos embalados. Você escolhe com calma.', 'O galpão é enorme. Você mal arranhou a superfície.', 'Rodas de carrinho enferrujado rangem. Você para. Escuta. Continua.', 'Luz entra pelas claraboias quebradas. Poeira flutua. Silêncio pesado.'],
    retorno:   ['Você sai pelos fundos antes que o movimento aumente.', 'Carga nas costas. Você força o passo de volta.', 'O galpão some atrás de você. Tem muito mais lá dentro para uma próxima vez.'],
  },
  garagem: {
    saida:     ['A garagem da Rua 7. Ferramentas e sucata esperando.', 'Você conhece o tipo de lugar — pesado, escuro, cheio de cantos cegos.', 'Oficina industrial. Não foi o primeiro a ir lá. Não será o último.'],
    chegada:   ['Carros enfileirados, capôs abertos, ferrugem por toda parte.', 'Cheiro de graxa e óleo queimado. O tipo de cheiro que lembra que o mundo funcionou um dia.', 'Fossa de óleo no meio do galpão. Você anota mentalmente: não cair.'],
    explorando:['Você desmonta o que pode carregar e deixa o resto.', 'Prateleiras de peças. Maioria inútil sem eletricidade. Mas o metal serve.', 'Alguém deixou ferramentas espalhadas no chão. Você recolhe o que cabe.', 'Um carro trancado. Você arromba com cuidado. Às vezes vale a pena.'],
    retorno:   ['Sucata pesada nas costas. Cada passo é deliberado.', 'Você sai pela porta lateral, longe da rua principal.', 'A garagem fica para trás. Tem mais lá dentro — quando você tiver forças.'],
  },
  fabrica_textil: {
    saida:     ['A fábrica de tecidos perto do viaduto. Você vai buscar o que sobrou.', 'Zona industrial fechada. Ninguém passa por lá sem motivo.', 'Fábrica têxtil. Maquinário parado, matéria-prima esquecida.'],
    chegada:   ['Rolos e rolos de pano empilhados até o teto do galpão.', 'Máquinas enferrujadas, fiação exposta. Você toma nota de onde não tocar.', 'O silêncio dentro da fábrica tem uma qualidade diferente — abafado, industrial.'],
    explorando:['Você corta o que precisa e enrola para carregar.', 'Fios de aço nos depósitos dos fundos. Não eram para isso, mas servem.', 'Pó de fibra no ar. Você tosse baixo e continua trabalhando.', 'Corredor após corredor de maquinário. Você vai pelo meio sem encostar em nada.'],
    retorno:   ['Mais leve do que parece, mais pesado do que você queria.', 'Você sai pela entrada de carga. Rua vazia. Bom sinal.', 'De volta ao ar aberto. O pó de fibra ainda gruda na garganta.'],
  },
  subestacao: {
    saida:     ['A subestação. Você vai uma vez só — e rápido.', 'Metal cortante, tensão residual, silêncio elétrico. Lugar de respeito.', 'Pilhas industriais. Ninguém foi buscar porque ninguém quer se arriscar. Você vai.'],
    chegada:   ['O zumbido baixo ainda está lá, mesmo sem energia na rede.', 'Armários de controle enfileirados. É aqui que ficam as baterias de backup.', 'Cercas derrubadas, avisos de perigo enferrujados. Você entra mesmo assim.'],
    explorando:['Você abre cada armário com cuidado, sem encostar nas chapas metálicas.', 'Baterias pesadas. Você leva o que consegue carregar sem forçar a coluna.', 'Um chiado elétrico do nada. Você recua. Para. Respira. Continua.', 'Metal cortante em todo canto. Você move devagar, de olho no chão.'],
    retorno:   ['Você sai pelo mesmo caminho que entrou — sem atalhos aqui.', 'Arranhões novos, mas nada sério. Poderia ter sido pior.', 'A subestação some atrás de você. Você não pretende voltar tão cedo.'],
  },
  silo: {
    saida:     ['Os silos de grãos no limite da zona industrial. Longe de tudo.', 'Lugar isolado, mas é isso que torna seguro. Relativamente.', 'Você pega o caminho mais longo — passa despercebido por aqui.'],
    chegada:   ['Cilindros enormes de aço contra o céu cinza. Escala humana zero.', 'Porta do silo cede com um rangido longo. Você espera. Nada reage.', 'Penumbra e cheiro de grão fermentado. Você respira pela boca.'],
    explorando:['Você sobe pelos degraus internos até o nível menos afetado pela umidade.', 'Grãos parcialmente estragados, mas parte ainda serve. Você separa com cuidado.', 'O pó do silo flutua em nuvens densas. Você pisca e continua.', 'Silêncio total aqui dentro. Só o seu próprio som de respiração.'],
    retorno:   ['Você desce e fecha a porta atrás de si. Hábito antigo.', 'Caminho longo de volta, mas você sabe que veio só.', 'O silo some no horizonte industrial. Ninguém sabe que você foi. Bom assim.'],
  },
};

// ============================================================
// EVENTOS COM ESCOLHA (disparados durante exploração)
// ============================================================

const EVENTOS_ESCOLHA = [
  {
    id: 'sobrevivente_ferido',
    titulo: 'Sobrevivente Ferido',
    desc: 'Você encontra um homem caído entre escombros. Ainda respira — mal. A mochila dele está aberta ao lado.',
    perigo_min: null,
    escolhas: [
      {
        texto: 'Usar um kit de primeiros socorros',
        icone: '🩹', risco: 'baixo',
        requer: { item: 'kit', qtd: 1 },
        resultados: [
          { chance: 70, msg: 'Ele acorda. Com voz fraca, aponta um esconderijo próximo. Você encontra mantimentos.', efeitos: { estresse: -10 }, loot: [{id:'comida',qtd:2},{id:'remedio',qtd:1}], consumir: [{id:'kit',qtd:1}] },
          { chance: 30, msg: 'Você fez o que pôde. Não foi suficiente. O kit foi usado em vão.', efeitos: { estresse: 22 }, consumir: [{id:'kit',qtd:1}] }
        ]
      },
      {
        texto: 'Pegar a mochila e seguir',
        icone: '🎒', risco: 'medio',
        requer: null,
        resultados: [
          { chance: 60, msg: 'A mochila tinha pouca coisa, mas era algo. Você não olha para trás.', efeitos: { estresse: 18 }, loot: [{id:'sucata',qtd:2},{id:'pano',qtd:1}] },
          { chance: 40, msg: 'Ao pegar a mochila, ele acorda e resiste. A confusão te custa energia.', efeitos: { vida: -12, estresse: 28 } }
        ]
      },
      {
        texto: 'Deixar ele para lá e continuar',
        icone: '🚶', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 75, msg: 'Você passa reto. A imagem fica gravada na cabeça.', efeitos: { estresse: 12 } },
          { chance: 25, msg: 'Você passa reto. Mais tarde ouve um tiro distante. Pode não ser relacionado.', efeitos: { estresse: 20 } }
        ]
      }
    ]
  },
  {
    id: 'saqueiro_adormecido',
    titulo: 'Saqueador Adormecido',
    desc: 'Um homem armado dorme encostado numa parede, cercado por sacos cheios. Ele não te viu.',
    perigo_min: 'medio',
    escolhas: [
      {
        texto: 'Roubar silenciosamente',
        icone: '🤫', risco: 'alto',
        requer: null,
        resultados: [
          { chance: 55, msg: 'Com cuidado extremo, você pega alguns itens e recua sem fazer barulho.', efeitos: { estresse: 12 }, loot: [{id:'comida',qtd:2},{id:'pilha',qtd:2}] },
          { chance: 45, msg: 'Ele acorda. Você corre. Sai do local com um corte no braço.', efeitos: { vida: -20, estresse: 32 }, condicao: 'sangramento' }
        ]
      },
      {
        texto: 'Recuar e encontrar outro caminho',
        icone: '🔙', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 100, msg: 'Você contorna pelo corredor lateral. Perde tempo mas chega inteiro.', efeitos: { estresse: 6 } }
        ]
      }
    ]
  },
  {
    id: 'comida_suspeita',
    titulo: 'Latas Suspeitas',
    desc: 'Você encontra latas empilhadas num canto. Fechadas, mas sem rótulo e sem data. O cheiro é difícil de avaliar.',
    perigo_min: null,
    escolhas: [
      {
        texto: 'Comer na hora mesmo — a fome dói mais',
        icone: '🥫', risco: 'alto',
        requer: null,
        resultados: [
          { chance: 55, msg: 'Estava boa. Sorte sua.', efeitos: { fome: -35, estresse: -5 } },
          { chance: 45, msg: 'Estava estragada. Seu estômago reage em minutos.', efeitos: { vida: -15, fome: -15 }, condicao: 'intoxicado' }
        ]
      },
      {
        texto: 'Levar para a base e decidir depois',
        icone: '🎒', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 100, msg: 'Você leva as latas. Melhor analisar com calma.', loot: [{id:'comida',qtd:2}] }
        ]
      },
      {
        texto: 'Não vale o risco — deixar',
        icone: '🚫', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 100, msg: 'Você deixa para lá. Fome ou não, prudência primeiro.', efeitos: { estresse: -3 } }
        ]
      }
    ]
  },
  {
    id: 'armadilha_no_caminho',
    titulo: 'Armadilha na Passagem',
    desc: 'Uma armadilha caseira bloqueia a rota mais direta. Parece recente — alguém ainda frequenta este lugar.',
    perigo_min: 'medio',
    escolhas: [
      {
        texto: 'Tentar desativar e guardar as peças',
        icone: '🔧', risco: 'alto',
        requer: null,
        resultados: [
          { chance: 60, msg: 'Com cuidado, você desmonta a armadilha. Guarda o material.', efeitos: { estresse: 10 }, loot: [{id:'arame',qtd:2},{id:'sucata',qtd:1}] },
          { chance: 40, msg: 'A armadilha dispara na sua mão. Dói muito.', efeitos: { vida: -22, estresse: 28 }, condicao: 'sangramento' }
        ]
      },
      {
        texto: 'Contornar com cuidado',
        icone: '🚶', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 100, msg: 'Você dá a volta pelo corredor lateral. Chega ao destino por um caminho mais longo.', efeitos: { estresse: 5 } }
        ]
      }
    ]
  },
  {
    id: 'sinal_de_radio',
    titulo: 'Sinal de Rádio',
    desc: 'Um rádio num cômodo vizinho transmite coordenadas em loop. A voz é gravada — parece antiga. As coordenadas estão perto.',
    perigo_min: null,
    escolhas: [
      {
        texto: 'Seguir as coordenadas',
        icone: '📡', risco: 'medio',
        requer: null,
        resultados: [
          { chance: 50, msg: 'As coordenadas levavam a um esconderijo bem conservado. Vale a pena.', efeitos: { estresse: -5 }, loot: [{id:'remedio',qtd:2},{id:'pilha',qtd:2},{id:'pano',qtd:1}] },
          { chance: 30, msg: 'O lugar estava vazio. Alguém chegou antes de você.', efeitos: { estresse: 10 } },
          { chance: 20, msg: 'Era uma isca. Você cai numa emboscada e precisa fugir.', efeitos: { vida: -18, estresse: 32 } }
        ]
      },
      {
        texto: 'Ignorar e continuar',
        icone: '🚶', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 100, msg: 'Você deixa o rádio para trás. Curiosidade é luxo que não pode pagar.', efeitos: { estresse: 3 } }
        ]
      }
    ]
  },
  {
    id: 'cadaver_com_mochila',
    titulo: 'Cadáver com Mochila',
    desc: 'Há um corpo numa cadeira. A decomposição diz que faz dias. A mochila ainda está às costas.',
    perigo_min: null,
    escolhas: [
      {
        texto: 'Revistar rápido e sair',
        icone: '🎒', risco: 'medio',
        requer: null,
        resultados: [
          { chance: 65, msg: 'Você encontra algo útil. Não pensa muito nisso.', efeitos: { estresse: 14 }, loot: [{id:'sucata',qtd:2},{id:'remedio',qtd:1}] },
          { chance: 35, msg: 'A mochila estava armadilhada. A explosão é pequena mas te joga no chão.', efeitos: { vida: -25, estresse: 32 } }
        ]
      },
      {
        texto: 'Verificar com calma antes de tocar',
        icone: '🔍', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 80, msg: 'Com cuidado, você identifica e evita a armadilha. Pega o que tinha de útil.', efeitos: { estresse: 8 }, loot: [{id:'sucata',qtd:1},{id:'pano',qtd:1}] },
          { chance: 20, msg: 'Nada de útil. Você respeita o silêncio e segue.', efeitos: { estresse: 4 } }
        ]
      },
      {
        texto: 'Deixar em paz',
        icone: '🙏', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 100, msg: 'Alguns têm o direito de descansar em paz. Você segue.', efeitos: { estresse: -5 } }
        ]
      }
    ]
  },
  {
    id: 'cao_feroz',
    titulo: 'Cão Selvagem',
    desc: 'Um cão enorme bloqueia sua rota. Está rodeando você, rosnando baixo. Sem coleira. Sem medo.',
    perigo_min: 'medio',
    escolhas: [
      {
        texto: 'Oferecer comida e recuar devagar',
        icone: '🥫', risco: 'baixo',
        requer: { item: 'comida', qtd: 1 },
        resultados: [
          { chance: 85, msg: 'O animal aceita e abre passagem. Um acordo tácito.', consumir: [{id:'comida',qtd:1}], efeitos: { estresse: -5 } },
          { chance: 15, msg: 'Ele pega a comida e avança de qualquer jeito. Você corre.', consumir: [{id:'comida',qtd:1}], efeitos: { vida: -14, estresse: 22 } }
        ]
      },
      {
        texto: 'Gritar e fazer barulho para assustar',
        icone: '📢', risco: 'medio',
        requer: null,
        resultados: [
          { chance: 50, msg: 'O animal recua. Você passa rapidamente.', efeitos: { estresse: 10 } },
          { chance: 50, msg: 'O barulho o provoca ainda mais. Você leva uma mordida antes de escapar.', efeitos: { vida: -18, estresse: 26 }, condicao: 'sangramento' }
        ]
      },
      {
        texto: 'Recuar devagar sem confronto',
        icone: '🔙', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 100, msg: 'Você recua sem perder o contato visual. O animal não persegue.', efeitos: { estresse: 8 } }
        ]
      }
    ]
  },
  {
    id: 'nota_no_muro',
    titulo: 'Mensagem na Parede',
    desc: '"Subsolo. Porta vermelha. Mantimentos intactos. Mas não vá depois do entardecer — eles voltam." A tinta ainda está fresca.',
    perigo_min: null,
    escolhas: [
      {
        texto: 'Ir até o subsolo agora',
        icone: '🚪', risco: 'alto',
        requer: null,
        resultados: [
          { chance: 50, msg: 'A porta vermelha estava lá. Os mantimentos também.', efeitos: { estresse: 12 }, loot: [{id:'comida',qtd:3},{id:'agua_limpa',qtd:1}] },
          { chance: 30, msg: 'O local estava revirado. Chegou tarde.', efeitos: { estresse: 16 } },
          { chance: 20, msg: 'Eles ainda estavam lá. Você escapa, mas não sem danos.', efeitos: { vida: -22, estresse: 36 }, condicao: 'contundido' }
        ]
      },
      {
        texto: 'Ignorar — pode ser uma armadilha',
        icone: '🚶', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 100, msg: 'Você continua. Quem deixou essa nota pode ter tido boas razões.', efeitos: { estresse: 3 } }
        ]
      }
    ]
  },
  {
    id: 'estrutura_instavel',
    titulo: 'Passagem Bloqueada',
    desc: 'Uma viga está prestes a ceder. Por baixo dela, você vê claramente suprimentos intactos. A estrutura range com o vento.',
    perigo_min: null,
    escolhas: [
      {
        texto: 'Entrar rápido antes de ceder',
        icone: '💨', risco: 'alto',
        requer: null,
        resultados: [
          { chance: 60, msg: 'Você passa como uma sombra. A viga cede quando você já está do outro lado.', efeitos: { estresse: 16 }, loot: [{id:'sucata',qtd:3},{id:'madeira',qtd:2}] },
          { chance: 40, msg: 'A viga cede antes do previsto. Você sai torto com dores no tornozelo.', efeitos: { vida: -20, estresse: 28 }, condicao: 'contundido' }
        ]
      },
      {
        texto: 'Escorar com madeira e entrar com calma',
        icone: '🪵', risco: 'medio',
        requer: { item: 'madeira', qtd: 1 },
        resultados: [
          { chance: 80, msg: 'O escoro segura. Você pega o que queria sem pressa.', efeitos: { estresse: 8 }, loot: [{id:'sucata',qtd:2},{id:'arame',qtd:2}], consumir: [{id:'madeira',qtd:1}] },
          { chance: 20, msg: 'A madeira não era suficiente. Você recua antes do colapso.', efeitos: { estresse: 12 }, consumir: [{id:'madeira',qtd:1}] }
        ]
      },
      {
        texto: 'Não vale o risco — seguir em frente',
        icone: '🚫', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 100, msg: 'Você decide não arriscar. Há outros dias para isso.', efeitos: { estresse: -3 } }
        ]
      }
    ]
  },
  {
    id: 'grupo_negociacao',
    titulo: 'Bloqueio de Rota',
    desc: 'Dois sobreviventes armados bloqueiam sua passagem. Não parecem hostis — mas também não parecem dispostos a deixar você passar de graça.',
    perigo_min: 'medio',
    escolhas: [
      {
        texto: 'Entregar comida e passar',
        icone: '🤝', risco: 'baixo',
        requer: { item: 'comida', qtd: 1 },
        resultados: [
          { chance: 90, msg: 'Troca feita. Eles abrem passagem sem problemas.', consumir: [{id:'comida',qtd:1}], efeitos: { estresse: 5 } },
          { chance: 10, msg: 'Após a troca, um deles pede mais. Você recusa e segue na pressão.', consumir: [{id:'comida',qtd:1}], efeitos: { estresse: 22 } }
        ]
      },
      {
        texto: 'Fingir aceitar e correr',
        icone: '🏃', risco: 'alto',
        requer: null,
        resultados: [
          { chance: 40, msg: 'Você finge aceitar, espera a abertura e sai em disparada. Eles ficam pra trás.', efeitos: { estresse: 16 } },
          { chance: 60, msg: 'Eles percebem antes. A briga é curta mas dolorosa.', efeitos: { vida: -26, estresse: 32 }, condicao: 'sangramento' }
        ]
      },
      {
        texto: 'Dar meia-volta',
        icone: '🔙', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 100, msg: 'Você vira e vai por outro caminho. Perda de tempo, mas seguro.', efeitos: { estresse: 8 } }
        ]
      }
    ]
  },
  {
    id: 'crianca_escondida',
    titulo: 'Criança Escondida',
    desc: 'Você ouve um choro abafado. Numa despensa, uma criança de uns oito anos se esconde sozinha. Assustada. Sem adultos por perto.',
    perigo_min: null,
    escolhas: [
      {
        texto: 'Deixar comida e ir sem dizer nada',
        icone: '🥫', risco: 'baixo',
        requer: { item: 'comida', qtd: 1 },
        resultados: [
          { chance: 100, msg: 'Você deixa os mantimentos sem dizer nada. Ela para de chorar quando você sai.', consumir: [{id:'comida',qtd:1}], efeitos: { estresse: -18 } }
        ]
      },
      {
        texto: 'Vasculhar o andar para encontrar um adulto',
        icone: '🔍', risco: 'medio',
        requer: null,
        resultados: [
          { chance: 40, msg: 'Você encontra a mãe dela, inconsciente mas viva. Ela acorda. A gratidão é real.', efeitos: { estresse: -20 }, loot: [{id:'remedio',qtd:1}] },
          { chance: 60, msg: 'Não havia ninguém. Você volta, deixa o que tem e segue. O peso fica.', efeitos: { estresse: 18 } }
        ]
      },
      {
        texto: 'Continuar sem se envolver',
        icone: '🚶', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 100, msg: 'Você continua. O choro vai sumindo conforme você se afasta.', efeitos: { estresse: 28 } }
        ]
      }
    ]
  },
  {
    id: 'farmacia_fundo',
    titulo: 'Farmácia Saqueada',
    desc: 'As prateleiras da frente estão vazias. Mas ao fundo, atrás de um balcão tombado, você vê caixas intactas. O teto ali acima parece comprometido.',
    perigo_min: null,
    escolhas: [
      {
        texto: 'Ir até o fundo e pegar as caixas',
        icone: '💊', risco: 'alto',
        requer: null,
        resultados: [
          { chance: 65, msg: 'Você chega lá. As caixas têm remédios que ainda servem.', efeitos: { estresse: 10 }, loot: [{id:'remedio',qtd:2},{id:'kit',qtd:1}] },
          { chance: 35, msg: 'O teto cede parcialmente. Você escapa mas leva pedaços na cabeça.', efeitos: { vida: -28, estresse: 30 }, condicao: 'contundido' }
        ]
      },
      {
        texto: 'Pegar apenas o que está ao alcance',
        icone: '🤏', risco: 'baixo',
        requer: null,
        resultados: [
          { chance: 100, msg: 'Você pega o que dá sem se arriscar. Pouco, mas é algo.', efeitos: { estresse: 3 }, loot: [{id:'atadura',qtd:1}] }
        ]
      }
    ]
  }
];

// ============================================================
// EVENTOS DE NPC ANDARILHO (disparados durante exploração)
// Oferecem trocas: itens por itens ou pilhas.
// ============================================================

const EVENTOS_NPC = [
  {
    id: 'npc_mercador',
    nome: 'Mercador Andarilho',
    icone: '🧳',
    desc: 'Um homem carregado de bugigangas para na sua frente. O olhar cauteloso, mas o sorriso calculado. "Pode escolher à vontade. Preço é o preço."',
    perigo_min: null,
    trocas: [
      { oferecem: [{id:'remedio',qtd:2}],            querem: [{id:'pilha',qtd:6}] },
      { oferecem: [{id:'pilha',qtd:8}],              querem: [{id:'comida',qtd:3}] },
      { oferecem: [{id:'kit',qtd:1}],                querem: [{id:'pilha',qtd:10}] },
      { oferecem: [{id:'agua_limpa',qtd:3}],         querem: [{id:'sucata',qtd:4}] },
    ]
  },
  {
    id: 'npc_catador',
    nome: 'Catador de Sucata',
    icone: '🔧',
    desc: '"Só preciso de comida. Em troca, tenho tudo que tirei das ruínas hoje." Ele abre a mochila com orgulho.',
    perigo_min: null,
    trocas: [
      { oferecem: [{id:'sucata',qtd:5}],             querem: [{id:'comida',qtd:2}] },
      { oferecem: [{id:'madeira',qtd:4}],            querem: [{id:'comida',qtd:1}] },
      { oferecem: [{id:'pilha',qtd:3}],              querem: [{id:'comida',qtd:2}] },
      { oferecem: [{id:'sucata',qtd:3},{id:'pano',qtd:1}], querem: [{id:'comida',qtd:2}] },
    ]
  },
  {
    id: 'npc_enfermeira',
    nome: 'Enfermeira Errante',
    icone: '🩺',
    desc: 'Uma mulher com braçadeira improvisada de cruz vermelha. "Tenho remédios de sobra, mas preciso de pilhas pra minha lanterna. Negócio?"',
    perigo_min: null,
    trocas: [
      { oferecem: [{id:'remedio',qtd:3}],            querem: [{id:'pilha',qtd:5}] },
      { oferecem: [{id:'kit',qtd:1}],                querem: [{id:'pilha',qtd:8}] },
      { oferecem: [{id:'atadura',qtd:3}],            querem: [{id:'pilha',qtd:3}] },
      { oferecem: [{id:'remedio',qtd:1},{id:'atadura',qtd:2}], querem: [{id:'pilha',qtd:4}] },
    ]
  },
  {
    id: 'npc_crianca',
    nome: 'Criança Sozinha',
    icone: '👧',
    desc: 'Uma criança de uns 10 anos, suja mas alerta, segura um saco. "Achei isso mas não sei o que fazer. Você tem comida?"',
    perigo_min: null,
    trocas: [
      { oferecem: [{id:'semente_canhamo',qtd:2}],    querem: [{id:'comida',qtd:1}] },
      { oferecem: [{id:'semente_abobora',qtd:2}],    querem: [{id:'comida',qtd:1}] },
      { oferecem: [{id:'semente_erva',qtd:2}],       querem: [{id:'comida',qtd:1}] },
      { oferecem: [{id:'erva_medicinal',qtd:2}],     querem: [{id:'comida',qtd:1}] },
    ]
  },
  {
    id: 'npc_ex_soldado',
    nome: 'Ex-Soldado',
    icone: '🪖',
    desc: '"Fui da guarda até o colapso. Agora só ando, não fico em lugar nenhum." Ele fala pouco, mas mostra o que tem.',
    perigo_min: 'medio',
    trocas: [
      { oferecem: [{id:'kit',qtd:2}],                querem: [{id:'pilha',qtd:12}] },
      { oferecem: [{id:'kit_avancado',qtd:1}],       querem: [{id:'pilha',qtd:18}] },
      { oferecem: [{id:'remedio',qtd:2},{id:'kit',qtd:1}], querem: [{id:'pilha',qtd:14}] },
      { oferecem: [{id:'pilha',qtd:15}],             querem: [{id:'comida',qtd:4},{id:'agua_limpa',qtd:2}] },
    ]
  },
  {
    id: 'npc_professora',
    nome: 'Professora Aposentada',
    icone: '📚',
    desc: 'Uma senhora de óculos consertados com arame. "Ainda guardo algumas coisas úteis. Toco em frente se tiver o que preciso."',
    perigo_min: null,
    trocas: [
      { oferecem: [{id:'agua_filtrada',qtd:2}],      querem: [{id:'pano',qtd:3}] },
      { oferecem: [{id:'comida',qtd:2}],             querem: [{id:'sucata',qtd:5}] },
      { oferecem: [{id:'remedio',qtd:1}],            querem: [{id:'pano',qtd:2},{id:'sucata',qtd:2}] },
    ]
  },
];

// ============================================================
// EVENTOS DE DESCOBERTA (passivos, sem escolha, raros)
// Disparam silenciosamente durante a fase explorando.
// Produzem itens encontráveis apenas por este canal.
// ============================================================

const EVENTOS_DESCOBERTA = [
  {
    id: 'caixa_forte',
    msg: 'Atrás de um quadro tombado você encontra uma caixa-forte aberta — deixaram algo dentro.',
    loot: { id: 'relogio_ouro', qtd: 1 },
    perigo_min: null,
  },
  {
    id: 'policial_caido',
    msg: 'Um policial militar ainda de farda, imóvel entre dois carros. O coldre estava vazio — mas não a jaqueta.',
    loot: { id: 'revolver', qtd: 1 },
    perigo_min: 'medio',
  },
  {
    id: 'armazem_escondido',
    msg: 'Você tropeça numa alçapão disfarçada. Lá embaixo: um cache esquecido com documentos empacotados.',
    loot: { id: 'doc_classificado', qtd: 1 },
    perigo_min: null,
  },
  {
    id: 'viatura_abandonada',
    msg: 'Uma viatura com as portas fechadas. Janela traseira quebrada. No banco, uma faca com bainha tática.',
    loot: { id: 'faca_tatica', qtd: 1 },
    perigo_min: 'medio',
  },
  {
    id: 'joalheria',
    msg: 'O forro de uma mala rasgada deixa escapar um brilho. Joias escondidas por alguém que não voltou para buscá-las.',
    loot: { id: 'joias', qtd: 1 },
    perigo_min: null,
  },
  {
    id: 'quartel_bombeiros',
    msg: 'Um bombeiro imóvel na entrada. O machado ainda estava preso no cinto — pesado, mas intacto.',
    loot: { id: 'machado', qtd: 1 },
    perigo_min: 'baixo',
  },
  {
    id: 'laboratorio',
    msg: 'Um kit hospitalar selado numa caixa de isopor. Rótulo rasurado. O lacre nunca foi aberto.',
    loot: { id: 'remedio_exp', qtd: 1 },
    perigo_min: 'medio',
  },
  {
    id: 'adega_entupida',
    msg: 'Atrás de uma prateleira tombada você encontra uma garrafa de whisky — 18 anos, lacre intacto. Impecável.',
    loot: { id: 'whisky_fino', qtd: 1 },
    perigo_min: null,
  },
  {
    id: 'servidor_derrubado',
    msg: 'Um servidor de rack caído no corredor. Entre os cabos, um pen drive com trava de segurança física.',
    loot: { id: 'pen_drive', qtd: 1 },
    perigo_min: 'medio',
  },
  {
    id: 'repórter_caido',
    msg: 'Uma câmera jornalística num bolso de mochila rasgada. Ainda liga. O que está gravado nela é assunto seu.',
    loot: { id: 'camera', qtd: 1 },
    perigo_min: null,
  },
  {
    id: 'posto_de_observacao',
    msg: 'Uma torre improvisada com binóculo militar preso por cordas. Ainda estava lá, como se esperasse alguém.',
    loot: { id: 'binoculo', qtd: 1 },
    perigo_min: 'baixo',
  },
  {
    id: 'soldado_desaparecido',
    msg: 'Uma mão saindo de baixo de escombros. Uma placa de identificação militar ainda no pescoço.',
    loot: { id: 'colar_id', qtd: 1 },
    perigo_min: null,
  },
];

// Nomes legíveis das zonas (usado em logs)
const nomesZona = {
  ruinas:             'Ruínas Residenciais',
  mercado:            'Mercado Abandonado',
  hospital:           'Hospital Regional',
  floresta:           'Mata do Cônego',
  posto:              'Posto Km 14',
  deposito_logistico: 'Depósito Logístico',
  garagem:            'Garagem Industrial',
  fabrica_textil:     'Fábrica Têxtil',
  subestacao:         'Subestação Elétrica',
  silo:               'Silo de Grãos',
};

// ============================================================
// ESTADO DO JOGO
// ============================================================

let estado = {
  criado: false,
  personagem: { nome: 'Sobrevivente', avatar: 0, traco: 'resistente' },
  stats: { vida: 100, vidaMax: 100, fome: 0, sede: 0, estresse: 0, vicio: 0 },
  inventario: [],
  capInventario: 10,
  receitasAprendidas: [],
  temBancada: false,
  base: [],
  tatica: 'furtivo',
  deposito:  { nivel: 0, itens: [] },
  cisterna:  { aguaAcumulada: 0 },
  seguranca: { armadilhasInstaladas: 0 },
  condicoes: { intoxicado: 0 },
  locaisDesbloqueados: [],
  exploracoesZona: {},   // { zona: contagem } — quantas vezes explorou cada local
  respawnTicks: {},      // { zona: ticks desde última exploração } — para recuperação
  placar: { exploracoes: 0, crafts: 0, construcoes: 0 },
  ultimoSaque: null,
  mercado: { itens: [], diaGerado: 0, fatorVenda: 1 },
  equipamento: { cabeca: null, peito: null, maos: null, pernas: null, pes: null, arma: null, acessorio: null },
  exploracao: { ativa: false, zona: 'ruinas', perigo: 'baixo', duracao: 10, progresso: 0, timer: null },
  dia: 1,
  segundos: 0,
  ultimoSave: null,
  loop: null
};

let craftSelecionado = null; // { item, el } — item selecionado na mochila para combinar
let itemModalAtual   = null; // item aberto no modal de uso

// ============================================================
// UTILITÁRIOS
// ============================================================

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
function randInt(min, max)    { return Math.floor(Math.random() * (max - min + 1)) + min; }

function sortearPorPeso(lista) {
  const total = lista.reduce((s, i) => s + i.peso, 0);
  let r = Math.random() * total;
  for (const item of lista) { r -= item.peso; if (r <= 0) return item; }
  return lista[lista.length - 1];
}

// ============================================================
// LOG
// ============================================================

function log(msg, classe = 'log-sistema') {
  const el = document.getElementById('log-eventos');
  const p  = document.createElement('p');
  p.className = `log-item ${classe}`;
  let prefixo = '';
  if (estado.criado) {
    const { hora, min } = getFase();
    const hStr = String(hora).padStart(2, '0');
    const mStr = String(min).padStart(2, '0');
    prefixo = `D${estado.dia} ${hStr}:${mStr} › `;
  }
  p.textContent = `${prefixo}${msg}`;
  el.prepend(p);
  while (el.children.length > 80) el.removeChild(el.lastChild);
}

// ============================================================
// TOAST
// ============================================================

let _toastTimer = null;

function mostrarToast(msg, dur = 2400) {
  const t = document.getElementById('toast');
  t.classList.remove('oculto');
  t.textContent = msg;
  clearTimeout(_toastTimer);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('visivel')));
  _toastTimer = setTimeout(() => {
    t.classList.remove('visivel');
    setTimeout(() => t.classList.add('oculto'), 300);
  }, dur);
}

// ============================================================
// INVENTÁRIO
// ============================================================

function adicionarItem(base, qtd = 1) {
  const ex = estado.inventario.find(i => i.id === base.id);
  if (ex) { ex.qtd += qtd; renderizarInventario(); return true; }
  if (estado.inventario.length >= estado.capInventario) return false;
  estado.inventario.push({
    id:            base.id,
    nome:          base.nome,
    icone:         base.icone,
    tipo:          base.tipo,
    qtd,
    efeitos:       base.efeitos        || {},
    revelaReceitas:base.revelaReceitas || [],
    catalogoId:    base.catalogoId     || null,
    desc:          base.desc           || null,
    // Campos específicos de anotação
    localId:       base.localId        || null,
    revelaLocal:   base.revelaLocal    || null,
    lore:          base.lore           || null,
  });
  renderizarInventario();
  return true;
}

function removerItem(id, qtd = 1) {
  let restante = qtd;

  // 1º — consumir da mochila
  const invIdx = estado.inventario.findIndex(i => i.id === id);
  if (invIdx !== -1) {
    const tirar = Math.min(restante, estado.inventario[invIdx].qtd);
    estado.inventario[invIdx].qtd -= tirar;
    if (estado.inventario[invIdx].qtd <= 0) estado.inventario.splice(invIdx, 1);
    restante -= tirar;
    renderizarInventario();
  }

  // 2º — se ainda falta, consumir do depósito
  if (restante > 0) {
    const depIdx = estado.deposito.itens.findIndex(i => i.id === id);
    if (depIdx !== -1) {
      const tirar = Math.min(restante, estado.deposito.itens[depIdx].qtd);
      estado.deposito.itens[depIdx].qtd -= tirar;
      if (estado.deposito.itens[depIdx].qtd <= 0) estado.deposito.itens.splice(depIdx, 1);
      restante -= tirar;
      renderizarDeposito();
    }
  }

  return restante === 0;
}

function temItem(id, qtd = 1) {
  const invItem = estado.inventario.find(i => i.id === id);
  const invQtd  = invItem ? (invItem.qtd || 0) : 0;
  const depItem = estado.deposito.itens.find(i => i.id === id);
  const depQtd  = depItem ? (depItem.qtd || 0) : 0;
  return (invQtd + depQtd) >= qtd;
}

// ============================================================
// CRAFTING
// ============================================================

function receitaVisivel(r) {
  return r.revelada || estado.receitasAprendidas.includes(r.id);
}

function podeCraftar(r) {
  if (r.bancada && !estado.temBancada) return false;
  return Object.entries(r.ingredientes).every(([id, q]) => temItem(id, q));
}

/**
 * Clique em item da mochila:
 *  - 1º clique → seleciona (highlight)
 *  - 2º clique no mesmo → abre modal de uso
 *  - 2º clique em outro → tenta combinação
 */
function clicarItemMochila(item, el) {
  // Item equipável e sem craft pendente → equipa direto
  if (!craftSelecionado && getSlotItem(item.id)) {
    equiparItem(item.id);
    return;
  }

  // Nenhum item selecionado → seleciona este
  if (!craftSelecionado) {
    craftSelecionado = { item, el };
    el.classList.add('item-craft-selecionado');
    mostrarToast(`${item.icone} Selecionado — clique em outro para combinar.`);
    return;
  }

  // Clicou no mesmo → limpa seleção e abre modal
  if (craftSelecionado.item.id === item.id) {
    craftSelecionado.el.classList.remove('item-craft-selecionado');
    craftSelecionado = null;
    abrirModal(item);
    return;
  }

  // Clicou em item diferente → tenta combinar
  const idA = craftSelecionado.item.id;
  const idB = item.id;
  craftSelecionado.el.classList.remove('item-craft-selecionado');
  craftSelecionado = null;

  const combinou = tentarCombinar(idA, idB);
  if (!combinou) {
    // Receita existe mas não foi aprendida?
    const receitaOculta = RECEITAS.find(r => {
      const ids = Object.keys(r.ingredientes);
      return ids.includes(idA) && ids.includes(idB) && !receitaVisivel(r);
    });
    if (receitaOculta) {
      mostrarToast('🔒 Combinação desconhecida. Procure manuais.');
      log('Você tentou combinar os itens, mas não sabe como. Talvez um manual ajude.', 'log-sistema');
    } else {
      mostrarToast('❌ Esses itens não se combinam.');
    }
  }
}

function tentarCombinar(idA, idB) {
  // Procura receita visível que contenha ambos os itens
  const receita = RECEITAS.find(r => {
    const ids = Object.keys(r.ingredientes);
    return ids.includes(idA) && ids.includes(idB) && receitaVisivel(r);
  });
  if (!receita) return false;

  if (!podeCraftar(receita)) {
    // Sabe a receita mas faltam ingredientes
    const faltam = Object.entries(receita.ingredientes)
      .filter(([id, q]) => !temItem(id, q))
      .map(([id]) => ITENS[id]?.nome || id).join(', ');
    if (faltam) {
      mostrarToast(`⚗️ Falta: ${faltam}`);
      log(`Você sabe como fazer ${ITENS[receita.id]?.nome}, mas faltam: ${faltam}.`, 'log-alerta');
    } else if (receita.bancada && !estado.temBancada) {
      mostrarToast('🔨 Esta receita precisa de bancada.');
      log('Você sabe a receita, mas precisa construir uma bancada antes.', 'log-alerta');
    }
    return false;
  }

  executarCraft(receita);
  return true;
}

function executarCraft(receita) {
  // Consome ingredientes
  for (const [id, q] of Object.entries(receita.ingredientes)) removerItem(id, q);

  const resultado = ITENS[receita.id];
  if (!adicionarItem(resultado, 1)) {
    // Mochila cheia — devolve tudo
    for (const [id, q] of Object.entries(receita.ingredientes)) adicionarItem(ITENS[id], q);
    mostrarToast('⚠️ Mochila cheia! Não foi possível craftar.');
    return;
  }

  estado.placar.crafts++;
  log(`⚗️ Craftou: ${resultado.icone} ${resultado.nome}`, 'log-sucesso');
  mostrarToast(`✅ ${resultado.icone} ${resultado.nome} criado!`);
  renderizarCrafting();
}

function usarLeitura(item) {
  const catalogoId = item.catalogoId;

  if (!catalogoId) {
    mostrarToast('Este item não ensina nenhuma receita.');
    fecharModal();
    return;
  }

  const proximaId = proximaReceitaCatalogo(catalogoId);

  if (!proximaId) {
    log(`${item.icone} Você já conhece todas as receitas deste tipo.`, 'log-sistema');
    mostrarToast('Nada novo aprendido. Você já sabe tudo isso.');
    // Consome o item mesmo assim (é um exemplar inútil)
    removerItem(item.id, 1);
    fecharModal();
    salvarJogo();
    return;
  }

  // Aprender a receita e consumir o item
  estado.receitasAprendidas.push(proximaId);
  removerItem(item.id, 1);

  const nomeReceita = ITENS[proximaId]?.nome || proximaId;
  const cat         = CATALOGOS[catalogoId];
  const restantes   = cat.receitas.filter(id => !estado.receitasAprendidas.includes(id)).length;

  log(`📖 Leu: ${item.nome}. Aprendeu: ${nomeReceita}.`, 'log-sucesso');

  if (restantes > 0) {
    log(`   Ainda há ${restantes} receita(s) deste tipo para descobrir. Encontre mais exemplares.`, 'log-sistema');
    mostrarToast(`📖 Aprendeu: ${nomeReceita}!`, 3000);
  } else {
    log(`   Você aprendeu todas as receitas deste catálogo.`, 'log-sucesso');
    mostrarToast(`📖 ${nomeReceita} — catálogo completo!`, 3000);
  }

  fecharModal();
  renderizarCrafting();
  salvarJogo();
}

/**
 * Usa uma anotação: exibe o texto de lore e desbloqueia o local correspondente.
 */
function usarAnotacao(item) {
  const localId = item.localId;

  if (estado.locaisDesbloqueados.includes(localId)) {
    log(`${item.icone} Você já conhece esse local.`, 'log-sistema');
    mostrarToast('Local já desbloqueado.');
    fecharModal();
    return;
  }

  // Desbloquear
  estado.locaisDesbloqueados.push(localId);
  removerItem(item.id, 1);

  const rl = item.revelaLocal;
  log(`📄 Leu anotação: "${item.nome}"`, 'log-loot');
  log(`🗺 Local desbloqueado: ${rl.icone} ${rl.nome} — ${rl.perigo} risco · ${rl.tempo}`, 'log-sucesso');
  mostrarToast(`🗺 ${rl.nome} desbloqueado!`, 3500);

  fecharModal();
  renderizarLocais();
  salvarJogo();
}

/**
 * Atualiza o visual dos cards de locais conforme o estado de desbloqueio.
 */
function renderizarLocais() {
  document.querySelectorAll('.local-card[data-local-id]').forEach(card => {
    const localId   = card.dataset.localId;
    const anotacaoId= card.dataset.anotacao;
    if (!anotacaoId) return; // sempre desbloqueado

    const desbloqueado = estado.locaisDesbloqueados.includes(localId);
    const anotacao     = ITENS[anotacaoId];
    const btn          = card.querySelector('.btn-explorar-local');
    const nomeEl       = card.querySelector('.local-nome');
    const tempoEl      = card.querySelector('.local-tempo');
    const imgEl        = card.querySelector('.local-img');
    const perigoEl     = card.querySelector('.local-perigo');

    if (desbloqueado && anotacao?.revelaLocal) {
      const rl = anotacao.revelaLocal;
      card.classList.remove('local-bloqueado');
      if (imgEl)    imgEl.classList.remove('local-img-blur');
      if (nomeEl)   nomeEl.textContent = `${rl.icone} ${rl.nome}`;
      if (tempoEl)  tempoEl.textContent = `⏱ ${rl.tempo}`;
      if (perigoEl) {
        const cls = { 'baixo': 'perigo-baixo', 'medio': 'perigo-medio', 'alto': 'perigo-alto' }[rl.perigo] || 'perigo-medio';
        perigoEl.className = `local-perigo ${cls}`;
        perigoEl.textContent = { 'baixo': 'Baixo risco', 'medio': 'Médio risco', 'alto': 'Alto risco' }[rl.perigo];
      }
      if (btn) {
        btn.disabled        = false;
        btn.style.opacity   = '1';
        btn.textContent     = 'Explorar';
        // Garantir data-* no botão para o event delegation
        btn.dataset.zona    = card.dataset.zona;
        btn.dataset.perigo  = card.dataset.perigo;
        btn.dataset.duracao = card.dataset.duracao;
      }
    } else {
      card.classList.add('local-bloqueado');
      if (imgEl)    imgEl.classList.add('local-img-blur');
      if (nomeEl)   nomeEl.textContent = '???';
      if (tempoEl)  tempoEl.textContent = 'Encontre a anotação para revelar';
      if (perigoEl) { perigoEl.className = 'local-perigo perigo-bloqueado'; perigoEl.textContent = '🔒 Bloqueado'; }
      if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; btn.textContent = 'Bloqueado'; }
    }
  });
}

// construirBancada mantida por compatibilidade — delega ao sistema genérico
function construirBancada() {
  const slot = document.querySelector('.base-slot[data-id="bancada"]');
  if (slot) tentarConstruir(slot);
}

// ============================================================
// USAR ITEM (modal)
// ============================================================

function usarItem(id) {
  const item = estado.inventario.find(i => i.id === id);
  if (!item) return;

  if (item.tipo === 'leitura')   { usarLeitura(item);   return; }
  if (item.tipo === 'anotacao')  { usarAnotacao(item);  return; }

  const efeitos   = item.efeitos || {};
  const tracoData = TRACOS[estado.personagem.traco];

  for (const [stat, val] of Object.entries(efeitos)) {
    let v = val;
    if (val > 0 && stat === 'vida' && tracoData.efeitos.curaBonus)
      v = Math.round(v * tracoData.efeitos.curaBonus);
    estado.stats[stat] = clamp((estado.stats[stat] || 0) + v, 0,
      stat === 'vida' ? estado.stats.vidaMax : 100);
  }

  // Água suja → intoxicação (90 ticks de efeito)
  if (id === 'agua_suja') {
    estado.condicoes.intoxicado = 90;
    log('🤢 A água estava contaminada! Você ficou intoxicado.', 'log-perigo');
  }

  // Medicinais curam intoxicação (carvão ativado é o tratamento ideal)
  if (item.tipo === 'medicinal' && estado.condicoes.intoxicado > 0) {
    estado.condicoes.intoxicado = 0;
    const msgCura = id === 'carvao_ativado'
      ? '🖤 Carvão ativado adsorveu as toxinas. Intoxicação curada.'
      : '💉 Remédio aplicado. Intoxicação curada.';
    log(msgCura, 'log-sucesso');
  }

  // Tala Improvisada cura Contundido
  if (id === 'tala' && estado.condicoes.contundido) {
    estado.condicoes.contundido = false;
    log('🦯 Tala aplicada. Contusão tratada.', 'log-sucesso');
  }

  // Bandagem / kit / curativo caseiro curam Sangramento
  if (['atadura', 'kit', 'curativo', 'kit_avancado'].includes(id) && estado.condicoes.sangramento) {
    estado.condicoes.sangramento = false;
    log('🩸 Ferimento estancado. Sangramento tratado.', 'log-sucesso');
  }

  removerItem(id, 1);
  const fx = Object.entries(efeitos).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(', ');
  log(`Você usou: ${item.icone} ${item.nome} (${fx})`, 'log-sucesso');
  mostrarToast(`${item.icone} ${item.nome} utilizado`);
  fecharModal();
  atualizarUI();
}

// ============================================================
// MODAL
// ============================================================

function abrirModal(item) {
  itemModalAtual = item;
  document.getElementById('modal-item-nome').textContent = `${item.icone} ${item.nome}`;

  let desc = `Tipo: ${item.tipo} · Quantidade: ×${item.qtd}`;
  if (item.tipo === 'leitura') {
    const proximaId  = item.catalogoId ? proximaReceitaCatalogo(item.catalogoId) : null;
    const cat        = CATALOGOS[item.catalogoId];
    const aprendidas = cat ? cat.receitas.filter(id => estado.receitasAprendidas.includes(id)).length : 0;
    const total      = cat ? cat.receitas.length : 0;

    if (proximaId) {
      const nomeReceita = ITENS[proximaId]?.nome || proximaId;
      desc += `\n\nVai ensinar: ${nomeReceita}`;
      desc += `\nProgresso: ${aprendidas}/${total} receitas deste catálogo aprendidas.`;
    } else {
      desc += '\n\nVocê já conhece todas as receitas deste tipo. Este exemplar não serve mais.';
    }
    if (item.desc) desc += `\n\n${item.desc}`;
  } else if (item.tipo === 'anotacao') {
    const jaDesbloqueado = estado.locaisDesbloqueados.includes(item.localId);
    if (jaDesbloqueado) {
      desc += '\n\nVocê já conhece este local.';
    } else {
      desc += `\n\n${item.lore || 'Uma anotação rabiscada. Use para revelar um local desconhecido.'}`;
    }
  } else if (item.efeitos && Object.keys(item.efeitos).length) {
    const fx = Object.entries(item.efeitos).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(', ');
    desc += `\n\nEfeitos ao usar: ${fx}`;
    if (item.desc) desc += `\n\n${item.desc}`;
  } else {
    desc += '\n\nMaterial. Clique em outro item na mochila para tentar combinar.';
  }

  const descEl = document.getElementById('modal-item-desc');
  descEl.textContent = desc;
  descEl.className   = item.tipo === 'anotacao' ? 'modal-lore' : '';

  const btnUsar = document.getElementById('modal-btn-usar');
  const podeUsar = (item.efeitos && Object.keys(item.efeitos).length > 0)
    || item.tipo === 'leitura' || item.tipo === 'anotacao';
  btnUsar.disabled      = !podeUsar;
  btnUsar.style.opacity = podeUsar ? '1' : '0.4';
  btnUsar.textContent   = item.tipo === 'leitura' ? 'Ler'
    : item.tipo === 'anotacao' ? 'Ler anotação' : 'Usar';

  // Grupo Guardar — visível só se depósito construído e tem espaço
  const grupoGuardar = document.getElementById('modal-guardar-grupo');
  const btnGuardar   = document.getElementById('modal-btn-guardar');
  const inputQtd     = document.getElementById('modal-qtd-guardar');
  if (grupoGuardar && btnGuardar && inputQtd) {
    const dep = estado.deposito;
    const cap = capacidadeDeposito();
    const existeNoDep  = dep.itens.find(i => i.id === item.id);
    const temEspaco    = existeNoDep || dep.itens.length < cap;
    const guardavel    = dep.nivel > 0 && item.tipo !== 'anotacao' && item.tipo !== 'leitura';
    grupoGuardar.classList.toggle('oculto', !guardavel);
    if (guardavel) {
      const explorando = estado.exploracao?.ativa;
      const qtdMax = item.qtd;
      inputQtd.max   = qtdMax;
      inputQtd.value = Math.min(inputQtd.value || 1, qtdMax);
      const bloqueado = explorando || !temEspaco;
      btnGuardar.disabled      = bloqueado;
      btnGuardar.style.opacity = bloqueado ? '0.4' : '1';
      btnGuardar.textContent   = explorando  ? 'Volte primeiro'
                               : !temEspaco  ? 'Depósito cheio'
                               : 'Guardar';
      inputQtd.disabled      = explorando;
      inputQtd.style.opacity = explorando ? '0.4' : '1';
    }
  }

  document.getElementById('modal-item').classList.remove('oculto');
}

function fecharModal() {
  itemModalAtual = null;
  document.getElementById('modal-item').classList.add('oculto');
}

/**
 * Descarta (remove completamente) um item da mochila.
 */
function descartarItem(id) {
  const item = estado.inventario.find(i => i.id === id);
  if (!item) return;
  const nome = item.nome;
  // Remove todas as unidades
  estado.inventario = estado.inventario.filter(i => i.id !== id);
  fecharModal();
  renderizarInventario();
  log(`🗑 Descartou: ${item.icone} ${nome}`, 'log-sistema');
  mostrarToast(`🗑 ${nome} descartado.`);
  salvarJogo();
}

// ============================================================
// RENDERIZAR INVENTÁRIO
// ============================================================

function renderizarInventario() {
  const lista = document.getElementById('lista-inventario');
  const cap   = document.getElementById('cap-inventario');

  lista.innerHTML = '';
  cap.textContent = `${estado.inventario.length}/${estado.capInventario}`;

  if (estado.inventario.length === 0) {
    lista.innerHTML = '<p class="inventario-vazio">Nada aqui. Explore.</p>';
    return;
  }

  for (const item of estado.inventario) {
    const sel = craftSelecionado && craftSelecionado.item.id === item.id;
    const div = document.createElement('div');
    div.className = `item-slot item-${item.tipo}${sel ? ' item-craft-selecionado' : ''}`;
    div.innerHTML = `
      <span class="item-icone">${item.icone}</span>
      <div class="item-info">
        <div class="item-nome">${item.nome}</div>
        <div class="item-qtd">×${item.qtd} <span class="item-dica">· clique para opções</span></div>
      </div>
    `;
    div.addEventListener('click', () => clicarItemMochila(item, div));
    lista.appendChild(div);
  }

  // Atualizar crafting, base, mercado e equipamento sempre que o inventário mudar
  renderizarCrafting();
  renderizarBase();
  renderizarMercado();
  renderizarEquipamento();
  renderizarEquipResumo();
}

// ============================================================
// RENDERIZAR CRAFTING
// ============================================================

function renderizarCrafting() {
  const lista = document.getElementById('lista-receitas');
  if (!lista) return;

  lista.innerHTML = '';

  const visiveis = RECEITAS.filter(r => receitaVisivel(r));
  const ocultas  = RECEITAS.filter(r => !receitaVisivel(r));

  if (visiveis.length === 0) {
    lista.innerHTML = '<p class="inventario-vazio">Nenhuma receita conhecida.<br>Encontre manuais explorando.</p>';
  }

  for (const receita of visiveis) {
    const resultado      = ITENS[receita.id];
    const podeF          = podeCraftar(receita);
    const precisaBancada = receita.bancada && !estado.temBancada;

    const div = document.createElement('div');
    div.className = `receita-slot${podeF ? ' receita-disponivel' : ''}${precisaBancada ? ' receita-bloqueada' : ''}`;

    const ings = Object.entries(receita.ingredientes).map(([id, q]) => {
      const ing = ITENS[id];
      const ok  = temItem(id, q);
      return `<span class="ing${ok ? ' ing-ok' : ' ing-falta'}">${ing?.icone || '?'} ${ing?.nome || id} ×${q}</span>`;
    }).join('');

    div.innerHTML = `
      <div class="receita-resultado">
        <span class="receita-icone">${resultado?.icone || '?'}</span>
        <div class="receita-info">
          <span class="receita-nome">${resultado?.nome || receita.id}</span>
          <span class="receita-tag">${receita.bancada ? '🔨 Bancada' : '👜 Mochila'}</span>
        </div>
        ${podeF ? `<button class="btn-craft btn-primario" data-id="${receita.id}">Criar</button>` : ''}
      </div>
      <div class="receita-ings">${ings}</div>
      ${precisaBancada ? '<div class="receita-aviso">Requer bancada de trabalho</div>' : ''}
    `;

    const btn = div.querySelector('.btn-craft');
    if (btn) btn.addEventListener('click', e => { e.stopPropagation(); executarCraft(receita); });

    lista.appendChild(div);
  }

  if (ocultas.length > 0) {
    const p = document.createElement('p');
    p.className   = 'receitas-ocultas';
    p.textContent = `🔒 ${ocultas.length} receita(s) ainda desconhecida(s). Explore e leia manuais.`;
    lista.appendChild(p);
  }
}

// ============================================================
// SISTEMA DE BASE — construção de estruturas
// ============================================================

function baseTemEstrutura(id) {
  return Array.isArray(estado.base) && estado.base.includes(id);
}

function tentarConstruir(card) {
  const id     = card.dataset.id;
  const nome   = card.dataset.nome;
  const requer = card.dataset.requer || null;
  const custo  = JSON.parse(card.dataset.custo || '{}');

  if (baseTemEstrutura(id)) { mostrarToast(`${nome} já foi construída.`); return; }

  if (requer && !baseTemEstrutura(requer)) {
    const nomeReq = document.querySelector(`[data-id="${requer}"] .slot-nome`)?.textContent || requer;
    mostrarToast(`⚒️ Requer: ${nomeReq}`);
    log(`Para construir ${nome}, primeiro construa: ${nomeReq}.`, 'log-alerta');
    return;
  }

  const faltam = Object.entries(custo)
    .filter(([itemId, q]) => !temItem(itemId, q))
    .map(([itemId, q]) => `${ITENS[itemId]?.nome || itemId} ×${q}`).join(', ');

  if (faltam) {
    mostrarToast(`⚒️ Falta: ${faltam}`);
    log(`Não tem materiais para ${nome}. Precisa de: ${faltam}.`, 'log-alerta');
    return;
  }

  for (const [itemId, q] of Object.entries(custo)) removerItem(itemId, q);
  if (!Array.isArray(estado.base)) estado.base = [];
  estado.base.push(id);
  if (id === 'bancada') estado.temBancada = true;
  estado.placar.construcoes++;

  if (id === 'abrigo') {
    log(`⛺ Abrigo erguido! Agora você tem um lugar para se proteger. Construa o resto da base.`, 'log-sucesso');
  } else {
    log(`✅ ${nome} construída!`, 'log-sucesso');
  }
  mostrarToast(`✅ ${nome} construída!`);
  renderizarBase();
  renderizarCrafting();
  salvarJogo();
}

function renderizarBase() {
  if (!estado.criado) return;
  document.querySelectorAll('.base-slot[data-id]').forEach(slot => {
    const id      = slot.dataset.id;
    const requer  = slot.dataset.requer || null;
    const custo   = JSON.parse(slot.dataset.custo || '{}');
    const construida  = baseTemEstrutura(id);
    const reqOk       = !requer || baseTemEstrutura(requer);
    const temRecursos = Object.entries(custo).every(([itemId, q]) => temItem(itemId, q));

    slot.classList.remove('construida', 'disponivel', 'bloqueada', 'sem-recursos');

    if (construida) {
      slot.classList.add('construida');
      const sub = slot.querySelector('.slot-sub');
      if (sub) { sub.textContent = 'Construída · Ativo'; sub.classList.remove('slot-custo'); }
    } else if (!reqOk) {
      slot.classList.add('bloqueada');
      const sub = slot.querySelector('.slot-sub');
      const nomeReq = document.querySelector(`.base-slot[data-id="${requer}"] .slot-nome`)?.textContent || requer;
      if (sub) sub.textContent = `🔒 Requer ${nomeReq}`;
    } else if (temRecursos) {
      slot.classList.add('disponivel');
    } else {
      slot.classList.add('sem-recursos');
    }
  });

  // Mostrar/ocultar e re-renderizar seções das estruturas construídas
  const secoes = {
    fogueira:  { secId: 'sec-fogueira',  painelId: 'painel-fogueira',  html: htmlPainelFogueira,  wire: wirePainelFogueira  },
    cisterna:  { secId: 'sec-cisterna',  painelId: 'painel-cisterna',  html: htmlPainelCisterna,  wire: wirePainelCisterna  },
    cultivo:   { secId: 'sec-cultivo',   painelId: 'painel-cultivo',   html: htmlPainelCultivo,   wire: wirePainelCultivo   },
    seguranca: { secId: 'sec-seguranca', painelId: 'painel-seguranca', html: htmlPainelSeguranca, wire: wirePainelSeguranca },
  };
  for (const [id, cfg] of Object.entries(secoes)) {
    const construida = baseTemEstrutura(id);
    const sec = document.getElementById(cfg.secId);
    if (!sec) continue;
    sec.classList.toggle('oculto', !construida);
    if (construida) {
      const corpo = document.getElementById(cfg.painelId);
      if (corpo) { corpo.innerHTML = cfg.html(); cfg.wire(); }
    }
  }

  // Atualizar indicador do depósito no mapa
  const dep = estado.deposito;
  const nivelEl = document.getElementById('mapa-deposito-nivel');
  const slotDep = document.getElementById('mapa-slot-deposito');
  const abrigoOk = baseTemEstrutura('abrigo');
  if (nivelEl) {
    if (dep.nivel > 0) {
      nivelEl.textContent = `Nível ${dep.nivel} · ${dep.itens.length}/${capacidadeDeposito()} slots`;
    } else if (!abrigoOk) {
      nivelEl.textContent = '🔒 Requer Abrigo';
    } else {
      nivelEl.textContent = 'Não construído';
    }
  }
  if (slotDep) {
    slotDep.classList.toggle('construida', dep.nivel > 0);
    slotDep.classList.toggle('bloqueada', !abrigoOk && dep.nivel === 0);
  }

  // Atualizar indicador de segurança no mapa
  const slotSeg = document.querySelector('.slot-seguranca');
  if (slotSeg && baseTemEstrutura('seguranca')) {
    const inst = estado.seguranca.armadilhasInstaladas;
    const subEl = slotSeg.querySelector('.slot-sub');
    if (subEl) { subEl.textContent = `${inst} armadilha(s) instalada(s)`; subEl.classList.remove('slot-custo'); subEl.style.display = 'inline'; }
  }

  // Atualizar painel de defesa e depósito sempre que a base mudar
  renderizarDeposito();
  atualizarDefesaUI();
}

function abrirTooltipBase(slot) {
  const id     = slot.dataset.id;
  const requer = slot.dataset.requer || null;
  const custo  = JSON.parse(slot.dataset.custo || '{}');
  const tooltip = document.getElementById('base-tooltip');
  if (!tooltip) return;

  const construida  = baseTemEstrutura(id);
  const reqOk       = !requer || baseTemEstrutura(requer);
  const temRecursos = Object.entries(custo).every(([itemId, q]) => temItem(itemId, q));

  document.getElementById('btt-nome').textContent = slot.querySelector('.slot-nome').textContent;
  document.getElementById('btt-desc').textContent = slot.querySelector('.slot-desc')?.textContent || '';

  const custoTxt = Object.entries(custo)
    .map(([itemId, q]) => `${ITENS[itemId]?.icone || ''} ${ITENS[itemId]?.nome || itemId} ×${q}`)
    .join('  ·  ');
  document.getElementById('btt-custo').textContent = construida ? '✓ Construída' : (custoTxt || '');

  const btnConstruir = document.getElementById('btt-btn-construir');
  if (construida) {
    btnConstruir.textContent = '✓ Construída'; btnConstruir.disabled = true;
  } else if (!reqOk) {
    const nomeReq = document.querySelector(`.base-slot[data-id="${requer}"] .slot-nome`)?.textContent || requer;
    btnConstruir.textContent = `Requer ${nomeReq}`; btnConstruir.disabled = true;
  } else if (!temRecursos) {
    btnConstruir.textContent = 'Sem recursos'; btnConstruir.disabled = true;
  } else {
    btnConstruir.textContent = 'Construir'; btnConstruir.disabled = false;
  }

  btnConstruir.onclick = () => { tentarConstruir(slot); fecharTooltipBase(); };
  tooltip.classList.remove('oculto');
  tooltip._slotAtual = slot;
}

function fecharTooltipBase() {
  const tooltip = document.getElementById('base-tooltip');
  if (tooltip) tooltip.classList.add('oculto');
}

// ============================================================
// PAINÉIS DAS ESTRUTURAS DA BASE
// ============================================================

function abrirPainelBase(tipo) {
  fecharTooltipBase();
  const alvo = {
    fogueira:  'sec-fogueira',
    bancada:   'lista-receitas',
    cisterna:  'sec-cisterna',
    cultivo:   'sec-cultivo',
    deposito:  'deposito-painel',
    seguranca: 'sec-seguranca',
  }[tipo];
  if (alvo) {
    document.getElementById(alvo)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ── Fogueira ──
function htmlPainelFogueira() {
  let html = '<div class="painel-receitas">';
  for (const r of RECEITAS_FOGUEIRA) {
    const item  = ITENS[r.id];
    const pode  = Object.entries(r.ingredientes).every(([id, q]) => temItem(id, q));
    const ingr  = Object.entries(r.ingredientes)
      .map(([id, q]) => `${ITENS[id]?.icone || ''} ${ITENS[id]?.nome || id} ×${q}`).join(' + ');
    html += `<div class="painel-receita">
      <div class="painel-receita-info">
        <span class="painel-receita-nome">${item?.icone || ''} ${item?.nome || r.id}</span>
        <span class="painel-receita-ingred">${ingr}</span>
        <span class="painel-receita-desc">${r.desc}</span>
      </div>
      <button class="btn-primario btn-sm btn-cozinhar" data-id="${r.id}" ${pode ? '' : 'disabled style="opacity:.45"'}>
        ${pode ? 'Cozinhar' : 'Sem ingredientes'}
      </button>
    </div>`;
  }
  html += '</div>';
  return html;
}
function wirePainelFogueira() {
  document.querySelectorAll('#painel-fogueira .btn-cozinhar').forEach(btn => {
    btn.addEventListener('click', () => {
      const receita = RECEITAS_FOGUEIRA.find(r => r.id === btn.dataset.id);
      if (!receita) return;
      for (const [id, q] of Object.entries(receita.ingredientes)) removerItem(id, q);
      adicionarItem(ITENS[btn.dataset.id], 1);
      const item = ITENS[btn.dataset.id];
      log(`🔥 Cozinhou: ${item?.icone} ${item?.nome}`, 'log-sucesso');
      mostrarToast(`${item?.icone} ${item?.nome} pronto!`);
      salvarJogo();
      renderizarBase();
      abrirPainelBase('fogueira');
    });
  });
}

// ── Cisterna ──
function htmlPainelCisterna() {
  const acum        = estado.cisterna.aguaAcumulada;
  const filtroOk    = baseTemEstrutura('filtro') && estado.filtroInstalado.diasRestantes > 0;
  const diasRestantes = estado.filtroInstalado.diasRestantes;
  const tipoNome    = filtroOk ? '💧 Água Limpa' : '🪣 Água Suja';
  const temFiltroInv = temItem('filtro', 1);

  let filtroStatus = '';
  if (!baseTemEstrutura('filtro')) {
    filtroStatus = '<p class="painel-cist-info">⚠ Construa o Filtro na base para purificar a água.</p>';
  } else if (diasRestantes > 0) {
    filtroStatus = `<p class="painel-cist-info">🧪 Filtro ativo · ${diasRestantes} dia(s) restante(s). Coletando água limpa.</p>`;
  } else {
    filtroStatus = `<p class="painel-cist-info">⚠ Sem filtro instalado. Coletando água suja.
      ${temFiltroInv
        ? '<br><button class="btn-secundario btn-sm btn-instalar-filtro">🧪 Instalar Filtro</button>'
        : '<br><span style="color:var(--text-dim);font-size:.8rem">Crie um Filtro de Água na Bancada para instalar.</span>'}
    </p>`;
  }

  return `<div class="painel-cisterna">
    <div class="defesa-stat">
      <div class="status-label">
        <span>Água acumulada</span>
        <span class="status-val">${acum} / 5</span>
      </div>
      <div class="barra-bg"><div class="barra barra-sede" style="width:${acum / 5 * 100}%"></div></div>
    </div>
    ${filtroStatus}
    <button class="btn-primario btn-sm btn-coletar-cisterna" ${acum > 0 ? '' : 'disabled style="opacity:.45"'}>
      ${acum > 0 ? `Coletar ${acum}× ${tipoNome}` : 'Cisterna vazia'}
    </button>
  </div>`;
}
function wirePainelCisterna() {
  document.querySelector('#painel-cisterna .btn-coletar-cisterna')?.addEventListener('click', () => {
    const qtd = estado.cisterna.aguaAcumulada;
    if (qtd <= 0) return;
    const filtroOk = baseTemEstrutura('filtro') && estado.filtroInstalado.diasRestantes > 0;
    const itemId   = filtroOk ? 'agua_limpa' : 'agua_suja';
    adicionarItem(ITENS[itemId], qtd);
    estado.cisterna.aguaAcumulada = 0;
    log(`🪣 Coletou ${qtd}× ${ITENS[itemId].nome} da cisterna.`, 'log-sucesso');
    mostrarToast(`${qtd}× ${ITENS[itemId].icone} coletados`);
    salvarJogo();
    renderizarBase();
    abrirPainelBase('cisterna');
  });

  document.querySelector('#painel-cisterna .btn-instalar-filtro')?.addEventListener('click', () => {
    if (!temItem('filtro', 1)) { mostrarToast('Sem filtro no inventário.'); return; }
    removerItem('filtro', 1);
    const dias = randInt(1, 3);
    estado.filtroInstalado.diasRestantes = dias;
    log(`🧪 Filtro instalado! Durará ${dias} dia(s).`, 'log-sucesso');
    mostrarToast(`🧪 Filtro instalado · ${dias} dia(s)`);
    salvarJogo();
    renderizarBase();
    abrirPainelBase('cisterna');
  });
}

// ── Cultivo ──
function htmlPainelCultivo() {
  const slots = estado.cultivo.slots;
  const sementesInv = Object.keys(CULTIVO_CONFIG).filter(id => temItem(id, 1));

  const htmlSlots = slots.map((slot, i) => {
    if (!slot) {
      const opcoes = sementesInv.length
        ? `<select class="bazar-select cultivo-sel-semente" data-slot="${i}">
            <option value="">— escolha uma semente —</option>
            ${sementesInv.map(id => `<option value="${id}">${ITENS[id].icone} ${ITENS[id].nome}</option>`).join('')}
           </select>
           <button class="btn-primario btn-sm btn-plantar" data-slot="${i}">Plantar</button>`
        : `<span class="cultivo-vazio-txt">Sem sementes. Explore a Mata do Cônego.</span>`;
      return `<div class="cultivo-slot vazio">
        <span class="cultivo-slot-num">Slot ${i + 1}</span>
        <div class="cultivo-slot-acao">${opcoes}</div>
      </div>`;
    }
    if (slot.pronto) {
      return `<div class="cultivo-slot pronto">
        <span class="cultivo-slot-num">Slot ${i + 1}</span>
        <span class="cultivo-planta-icone">${slot.icone}</span>
        <span class="cultivo-planta-nome">${slot.nome} — PRONTO!</span>
        <span class="cultivo-aviso">Colha agora! Apodrece amanhã.</span>
        <button class="btn-sucesso btn-sm btn-colher" data-slot="${i}">🌾 Colher</button>
      </div>`;
    }
    const pct = ((slot.diasTotal - slot.diasRestantes) / slot.diasTotal) * 100;
    return `<div class="cultivo-slot crescendo">
      <span class="cultivo-slot-num">Slot ${i + 1}</span>
      <span class="cultivo-planta-icone">${slot.icone}</span>
      <span class="cultivo-planta-nome">${slot.nome} — ${slot.diasRestantes} dia(s) restante(s)</span>
      <div class="barra-bg"><div class="barra barra-sucesso" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  return `<div class="painel-cultivo">${htmlSlots}</div>`;
}

function wirePainelCultivo() {
  document.querySelectorAll('#painel-cultivo .btn-plantar').forEach(btn => {
    btn.addEventListener('click', () => {
      const i   = parseInt(btn.dataset.slot);
      const sel = document.querySelector(`#painel-cultivo .cultivo-sel-semente[data-slot="${i}"]`);
      const id  = sel?.value;
      if (!id) { mostrarToast('Escolha uma semente.'); return; }
      if (!temItem(id, 1)) { mostrarToast('Sem semente no inventário.'); return; }
      const cfg = CULTIVO_CONFIG[id];
      removerItem(id, 1);
      estado.cultivo.slots[i] = {
        sementeId: id, nome: cfg.nome, itemId: cfg.itemId,
        qtd: cfg.qtd, icone: cfg.icone,
        diasRestantes: cfg.dias, diasTotal: cfg.dias,
        pronto: false, diasEspera: 0
      };
      log(`🌱 Plantou ${ITENS[id].nome} no Slot ${i + 1}. Colheita em ${cfg.dias} dia(s).`, 'log-sucesso');
      mostrarToast(`🌱 ${cfg.nome} plantado!`);
      salvarJogo();
      renderizarBase();
      abrirPainelBase('cultivo');
    });
  });

  document.querySelectorAll('#painel-cultivo .btn-colher').forEach(btn => {
    btn.addEventListener('click', () => {
      const i    = parseInt(btn.dataset.slot);
      const slot = estado.cultivo.slots[i];
      if (!slot?.pronto) return;
      adicionarItem(ITENS[slot.itemId], slot.qtd);
      estado.cultivo.slots[i] = null;
      log(`🌾 Colheu ${slot.icone} ${slot.nome} ×${slot.qtd}! Item adicionado à mochila.`, 'log-sucesso');
      mostrarToast(`🌾 ${slot.nome} colhida!`);
      salvarJogo();
      renderizarInventario();
      renderizarBase();
      abrirPainelBase('cultivo');
    });
  });
}

// ── Segurança ──
function htmlPainelSeguranca() {
  const inst    = estado.seguranca.armadilhasInstaladas;
  const capMax  = 5;
  const pct     = Math.min(inst / capMax * 100, 100);
  const noMoch  = estado.inventario.find(i => i.id === 'armadilha')?.qtd || 0;
  return `<div class="painel-seguranca">
    <div class="defesa-stat">
      <div class="status-label">
        <span>Armadilhas instaladas</span>
        <span class="status-val">${inst} / ${capMax}</span>
      </div>
      <div class="barra-bg"><div class="barra" style="width:${pct}%;background:var(--accent)"></div></div>
    </div>
    <p class="painel-seg-info">Na mochila: ${noMoch}× Armadilha 🪤 · Cada armadilha reduz a chance de invasão.</p>
    <p class="painel-seg-info">⚠ Enquanto você explora, a base fica desprotegida — invasores roubam do depósito. Fique em casa para protegê-la.</p>
    <div class="painel-seg-acoes">
      <button class="btn-primario btn-sm btn-instalar-arm" ${noMoch > 0 && inst < capMax ? '' : 'disabled style="opacity:.45"'}>
        ＋ Instalar
      </button>
      <button class="btn-secundario btn-sm btn-remover-arm" ${inst > 0 ? '' : 'disabled style="opacity:.45"'}>
        − Remover
      </button>
    </div>
  </div>`;
}
function wirePainelSeguranca() {
  document.querySelector('#painel-seguranca .btn-instalar-arm')?.addEventListener('click', () => {
    if (!temItem('armadilha', 1)) return;
    removerItem('armadilha', 1);
    estado.seguranca.armadilhasInstaladas++;
    log('🪤 Armadilha instalada no perímetro.', 'log-sucesso');
    salvarJogo(); atualizarDefesaUI(); abrirPainelBase('seguranca');
  });
  document.querySelector('#painel-seguranca .btn-remover-arm')?.addEventListener('click', () => {
    if (estado.seguranca.armadilhasInstaladas <= 0) return;
    estado.seguranca.armadilhasInstaladas--;
    adicionarItem(ITENS.armadilha, 1);
    log('🪤 Armadilha removida do perímetro.', 'log-sistema');
    salvarJogo(); atualizarDefesaUI(); abrirPainelBase('seguranca');
  });
}

// ============================================================
// DEPÓSITO
// ============================================================

function capacidadeDeposito() {
  const n = estado.deposito.nivel;
  return n === 0 ? 0 : 3 + n * 2; // L1=5, L2=7, L3=9, L4=11, L5=13
}

function construirOuUpgradeDeposito() {
  if (!baseTemEstrutura('abrigo')) {
    mostrarToast('⚒️ Requer: Abrigo');
    log('Construa o Abrigo primeiro antes de erguer o Depósito.', 'log-alerta');
    return;
  }
  const nivelAtual = estado.deposito.nivel;
  const proximoNivel = nivelAtual + 1;
  if (proximoNivel > 5) return;

  const custo = DEPOSITO_CUSTOS[proximoNivel];
  for (const [id, q] of Object.entries(custo)) {
    if (!temItem(id, q)) {
      const nomeItem = ITENS[id]?.nome || id;
      mostrarToast(`Sem recursos: precisa de ${q}× ${nomeItem}.`);
      return;
    }
  }
  for (const [id, q] of Object.entries(custo)) removerItem(id, q);

  estado.deposito.nivel = proximoNivel;
  const cap = capacidadeDeposito();
  if (nivelAtual === 0) {
    log(`📦 Depósito construído! Nível 1 · ${cap} slots de armazenamento.`, 'log-sucesso');
    mostrarToast('📦 Depósito construído!');
  } else {
    log(`📦 Depósito aprimorado para Nível ${proximoNivel} · ${cap} slots.`, 'log-sucesso');
    mostrarToast(`📦 Depósito Nível ${proximoNivel}!`);
  }
  renderizarDeposito();
  salvarJogo();
}

function guardarNoDeposito(itemId, qtd) {
  qtd = Math.max(1, Math.floor(qtd) || 1);
  const cap = capacidadeDeposito();
  const dep = estado.deposito.itens;
  const existente = dep.find(i => i.id === itemId);
  if (!existente && dep.length >= cap) {
    mostrarToast('📦 Depósito cheio!');
    return;
  }
  const invItem = estado.inventario.find(i => i.id === itemId);
  if (!invItem) return;

  const qtdReal = Math.min(qtd, invItem.qtd);
  removerItem(itemId, qtdReal);
  if (existente) {
    existente.qtd += qtdReal;
  } else {
    dep.push({ ...ITENS[itemId], qtd: qtdReal });
  }
  fecharModal();
  log(`📦 Guardou ${invItem.icone} ${invItem.nome} ×${qtdReal} no depósito.`, 'log-sistema');
  renderizarDeposito();
  renderizarInventario();
  salvarJogo();
}

function retirarDoDeposito(itemId) {
  const dep = estado.deposito.itens;
  const idx = dep.findIndex(i => i.id === itemId);
  if (idx === -1) return;

  if (estado.inventario.length >= estado.capInventario) {
    mostrarToast('🎒 Mochila cheia!');
    return;
  }
  const depItem = dep[idx];
  adicionarItem(depItem, 1);
  depItem.qtd -= 1;
  if (depItem.qtd <= 0) dep.splice(idx, 1);

  log(`🎒 Retirou ${depItem.icone} ${depItem.nome} do depósito.`, 'log-sistema');
  renderizarDeposito();
  renderizarInventario();
  salvarJogo();
}

function renderizarDeposito() {
  const painel = document.getElementById('deposito-painel');
  if (!painel) return;

  const nivel = estado.deposito.nivel;
  const cap   = capacidadeDeposito();
  const dep   = estado.deposito.itens;
  const usado = dep.length;

  if (nivel === 0) {
    const custo = DEPOSITO_CUSTOS[1];
    const custoStr = Object.entries(custo).map(([id, q]) => `${q}× ${ITENS[id]?.nome || id}`).join(' · ');
    const temRecursos = Object.entries(custo).every(([id, q]) => temItem(id, q));
    painel.innerHTML = `
      <div class="deposito-nao-construido">
        <p class="deposito-info-txt">Nenhum depósito construído. Armazene itens com segurança, fora da mochila.</p>
        <div class="deposito-custo-linha">
          <span class="deposito-custo-txt">${custoStr}</span>
          <button class="btn-primario btn-deposito-acao" id="btn-build-deposito" ${temRecursos ? '' : 'disabled'}>
            ${temRecursos ? 'Construir' : 'Sem recursos'}
          </button>
        </div>
      </div>
    `;
  } else {
    const proximoNivel = nivel + 1;
    let upgradeHtml = '';
    if (proximoNivel <= 5) {
      const custoUp = DEPOSITO_CUSTOS[proximoNivel];
      const custoStr = Object.entries(custoUp).map(([id, q]) => `${q}× ${ITENS[id]?.nome || id}`).join(' · ');
      const temRecursos = Object.entries(custoUp).every(([id, q]) => temItem(id, q));
      upgradeHtml = `
        <div class="deposito-upgrade-linha">
          <span class="deposito-custo-txt">Nível ${proximoNivel}: ${custoStr}</span>
          <button class="btn-secundario btn-deposito-acao" id="btn-upgrade-deposito" ${temRecursos ? '' : 'disabled'}>
            ${temRecursos ? `Melhorar → Nv${proximoNivel}` : 'Sem recursos'}
          </button>
        </div>
      `;
    } else {
      upgradeHtml = `<p class="deposito-info-txt deposito-max">Nível máximo atingido.</p>`;
    }

    // Slots
    let slotsHtml = '';
    for (const item of dep) {
      slotsHtml += `
        <div class="deposito-slot ocupado">
          <span class="deposito-slot-icone">${item.icone}</span>
          <div class="deposito-slot-info">
            <span class="deposito-slot-nome">${item.nome}</span>
            <span class="deposito-slot-qtd">×${item.qtd}</span>
          </div>
          <button class="btn-secundario btn-retirar" data-id="${item.id}">Retirar</button>
        </div>
      `;
    }
    const vazios = cap - usado;
    for (let i = 0; i < vazios; i++) {
      slotsHtml += `<div class="deposito-slot vazio"><span class="deposito-slot-vazio-txt">— vazio —</span></div>`;
    }

    painel.innerHTML = `
      <div class="deposito-header">
        <span class="deposito-nivel-badge">Nível ${nivel}</span>
        <span class="deposito-cap-txt">${usado}/${cap} slots</span>
      </div>
      ${upgradeHtml}
      <div class="deposito-slots">${slotsHtml}</div>
    `;
  }

  // Eventos
  painel.querySelector('#btn-build-deposito')?.addEventListener('click', construirOuUpgradeDeposito);
  painel.querySelector('#btn-upgrade-deposito')?.addEventListener('click', construirOuUpgradeDeposito);
  painel.querySelectorAll('.btn-retirar').forEach(btn => {
    btn.addEventListener('click', () => retirarDoDeposito(btn.dataset.id));
  });
}

// ============================================================
// STATUS LOOP
// ============================================================

/**
 * Agrega todos os efeitos passivos dos itens equipados.
 * Retorna um objeto com os bônus combinados.
 */
function getEfeitosEquipamento() {
  const resultado = {
    vidaDecayMulti: 1,    // multiplicador de dano recebido (< 1 = menos dano)
    lootBonus:      0,    // bônus aditivo de loot (somado ao traço)
    estresseRedux:  0,    // redução extra de estresse por tick (> 0 = reduz mais)
  };

  for (const slot of SLOTS_EQUIP) {
    const itemId = estado.equipamento[slot];
    if (!itemId) continue;
    const ef = ITENS_EQUIPAVEIS[itemId]?.efeitos || {};

    if (ef.vidaDecayMulti !== undefined) resultado.vidaDecayMulti *= ef.vidaDecayMulti;
    if (ef.lootBonus      !== undefined) resultado.lootBonus      += ef.lootBonus;
    if (ef.estresseRedux  !== undefined) resultado.estresseRedux  += ef.estresseRedux;
  }

  return resultado;
}

function getMultiTraco() {
  const t = TRACOS[estado.personagem.traco]?.efeitos || {};
  return { consumoMulti: t.consumoMulti || 1, estresseMulti: t.estresseMulti || 1, vidaDecay: t.vidaDecay || 1 };
}

function getMultiTatica() {
  // estresseRedux: multiplicador sobre a redução de estresse no descanso
  // eventoChance:  multiplicador sobre a chance de evento negativo
  // lootBonus:     bônus aditivo de loot (mesma escala que eq.lootBonus)
  const tabela = {
    furtivo:     { estresseRedux: 1.8, eventoChance: 0.65, lootBonus: 0    },
    oportunista: { estresseRedux: 1.0, eventoChance: 1.0,  lootBonus: 0    },
    agressivo:   { estresseRedux: 0.5, eventoChance: 1.5,  lootBonus: 0.30 },
  };
  return tabela[estado.tatica] || tabela.oportunista;
}

// ============================================================
// CICLO DIA / NOITE
// ============================================================

/** Retorna a fase atual e o horário fictício do relógio. */
function getFase() {
  const cicloSeg = estado.segundos % CICLO_DURACAO;
  if (cicloSeg < DIA_DURACAO) {
    // Dia: 06:00 → 18:00 em DIA_DURACAO segundos
    const prog      = cicloSeg / DIA_DURACAO;
    const minTotais = Math.floor(prog * 720); // 12h × 60min
    return { fase: 'dia', hora: 6 + Math.floor(minTotais / 60), min: minTotais % 60, cicloSeg };
  } else {
    // Noite: 18:00 → 06:00 em NOITE_DURACAO segundos
    const prog      = (cicloSeg - DIA_DURACAO) / NOITE_DURACAO;
    const minTotais = Math.floor(prog * 720);
    return { fase: 'noite', hora: (18 + Math.floor(minTotais / 60)) % 24, min: minTotais % 60, cicloSeg };
  }
}

/** Atualiza o relógio no header e aplica a classe de fase no layout. */
function atualizarRelogio() {
  const { fase, hora, min } = getFase();
  const hStr = String(hora).padStart(2, '0');
  const mStr = String(min).padStart(2, '0');

  const elFase = document.getElementById('relogio-fase');
  const elHora = document.getElementById('relogio-hora');
  const elBarra = document.getElementById('relogio-progresso');
  const tela   = document.getElementById('tela-jogo');

  if (elFase) elFase.textContent = fase === 'dia' ? '☀' : '☾';
  if (elHora) elHora.textContent = `${hStr}:${mStr}`;
  if (elBarra) {
    const pct = (estado.segundos % CICLO_DURACAO) / CICLO_DURACAO * 100;
    elBarra.style.width = pct + '%';
    elBarra.className = `relogio-progresso-fill relogio-progresso-${fase}`;
  }
  if (tela) {
    tela.classList.toggle('fase-noite', fase === 'noite');
    tela.classList.toggle('fase-dia',   fase === 'dia');
  }
  audio.tocarFase(fase);
}

/** Chamado no início da noite. */
function iniciarNoite() {
  log('🌙 A noite caiu. Fique quieto.', 'log-alerta');
}

/** Chamado no fim da noite: avança o dia e processa eventos noturnos. */
function avancarDia() {
  estado.dia++;
  document.getElementById('hdr-dia').textContent = `Dia ${estado.dia}`;
  log(`☀ Dia ${estado.dia}. Você sobreviveu mais uma noite.`, 'log-alerta');

  // Desgastar filtro instalado
  if (estado.filtroInstalado.diasRestantes > 0) {
    estado.filtroInstalado.diasRestantes--;
    if (estado.filtroInstalado.diasRestantes === 0) {
      log('🧪 O filtro de água se esgotou. A cisterna voltará a coletar água suja.', 'log-alerta');
      mostrarToast('🧪 Filtro esgotado!');
    } else {
      log(`🧪 Filtro com ${estado.filtroInstalado.diasRestantes} dia(s) restante(s).`, 'log-sistema');
    }
    renderizarBase();
  }

  // Crescimento das plantas
  if (baseTemEstrutura('cultivo')) {
    estado.cultivo.slots = estado.cultivo.slots.map((slot, i) => {
      if (!slot) return null;
      if (slot.pronto) {
        if (slot.diasEspera >= 1) {
          log(`🥀 Slot ${i + 1} do cultivo apodreceu! Colha antes que seja tarde.`, 'log-alerta');
          mostrarToast('🥀 Planta apodreceu!');
          return null;
        }
        return { ...slot, diasEspera: slot.diasEspera + 1 };
      }
      const dias = slot.diasRestantes - 1;
      if (dias <= 0) {
        log(`🌾 ${slot.nome} está pronta para colher! (Slot ${i + 1})`, 'log-sucesso');
        mostrarToast(`🌾 ${slot.nome} pronta!`);
        return { ...slot, diasRestantes: 0, pronto: true, diasEspera: 0 };
      }
      return { ...slot, diasRestantes: dias };
    });
    renderizarBase();
  }

  verificarMercado();
  processarSaqueNoturno();
}

function atualizarStatus() {
  const s  = estado.stats;
  const m  = getMultiTraco();
  const eq = getEfeitosEquipamento();

  s.fome = clamp(s.fome + 0.15 * m.consumoMulti, 0, 100);
  s.sede = clamp(s.sede + 0.22 * m.consumoMulti, 0, 100);

  if (s.vicio > 0) s.vicio = clamp(s.vicio - 0.05, 0, 100);

  // Vício → pressiona estresse e drena vida em abstinência
  if (s.vicio > 30) {
    const fatorVicio = (s.vicio - 30) / 70;
    s.estresse = clamp(s.estresse + fatorVicio * 0.08 * m.estresseMulti, 0, 100);
    if (s.vicio > 70)
      s.vida = clamp(s.vida - fatorVicio * 0.06 * m.vidaDecay, 0, s.vidaMax);
  }

  // Intoxicação (água suja) → drena vida e acelera fome
  if (estado.condicoes.intoxicado > 0) {
    estado.condicoes.intoxicado--;
    s.vida = clamp(s.vida - 0.12, 0, s.vidaMax);
    s.fome = clamp(s.fome + 0.08, 0, 100);
    if (estado.condicoes.intoxicado === 0)
      log('🤢 A intoxicação passou.', 'log-sistema');
    else if (estado.condicoes.intoxicado % 15 === 0)
      log('🤢 Você está intoxicado. Tome um remédio.', 'log-perigo');
  }

  // Contundido (tornozelo torcido) → drena vida lentamente
  if (estado.condicoes.contundido) {
    s.vida = clamp(s.vida - 0.05, 0, s.vidaMax);
  }

  // Sangramento → drena vida mais rápido
  if (estado.condicoes.sangramento) {
    s.vida = clamp(s.vida - 0.18, 0, s.vidaMax);
  }

  // Estresse: reduz pelo descanso + bônus de equipamento + multiplicador de tática
  if (!estado.exploracao.ativa && s.estresse > 0) {
    const tatica = getMultiTatica();
    s.estresse = clamp(s.estresse - (0.04 + eq.estresseRedux) * tatica.estresseRedux, 0, 100);
  }

  // Dano por fome/sede — multiplicado pelo equipamento de proteção
  if (s.fome >= 80) {
    const dano = (s.fome >= 95 ? 0.25 : 0.1) * m.vidaDecay * eq.vidaDecayMulti;
    s.vida     = clamp(s.vida - dano, 0, s.vidaMax);
    s.estresse = clamp(s.estresse + 0.05 * m.estresseMulti, 0, 100);
  }
  if (s.sede >= 80) {
    const dano = (s.sede >= 95 ? 0.3 : 0.12) * m.vidaDecay * eq.vidaDecayMulti;
    s.vida     = clamp(s.vida - dano, 0, s.vidaMax);
  }

  const cicloAntes = estado.segundos % CICLO_DURACAO;
  estado.segundos++;
  const cicloAgora = estado.segundos % CICLO_DURACAO;

  // ── Respawn de recursos + cisterna (a cada 60 ticks) ──
  if (estado.segundos % 60 === 0) {
    for (const zona of Object.keys(estado.exploracoesZona)) {
      if (estado.exploracoesZona[zona] > 0)
        estado.exploracoesZona[zona] = Math.max(0, estado.exploracoesZona[zona] - 1);
    }
    if (baseTemEstrutura('cisterna') && estado.cisterna.aguaAcumulada < 5)
      estado.cisterna.aguaAcumulada++;
  }

  // ── Transição dia → noite ──
  if (cicloAntes < DIA_DURACAO && cicloAgora >= DIA_DURACAO) iniciarNoite();

  // ── Transição noite → dia (fim do ciclo) ──
  if (cicloAgora === 0 && estado.segundos > 0) avancarDia();

  // ── Relógio ──
  atualizarRelogio();

  if (s.vida <= 0) { s.vida = 0; gameOver(); return; }
  atualizarUI();
}

function atualizarUI() {
  const s = estado.stats;
  function setBar(id, val, max) {
    document.getElementById(`barra-${id}`).style.width  = clamp((val / max) * 100, 0, 100) + '%';
    document.getElementById(`val-${id}`).textContent    = Math.round(val);
  }
  setBar('vida', s.vida, s.vidaMax);
  setBar('fome', s.fome, 100);
  setBar('sede', s.sede, 100);
  setBar('estresse', s.estresse, 100);
  setBar('vicio', s.vicio, 100);

  document.getElementById('barra-vida').classList.toggle('barra-critica', s.vida < 25);

  const div = document.getElementById('avisos-status');
  div.innerHTML = '';
  const av = (txt, cls) => { const p = document.createElement('p'); p.className = `aviso aviso-${cls}`; p.textContent = txt; div.appendChild(p); };
  if (s.vida < 25)      av('⚠️ Vida crítica!', 'perigo');
  if (s.fome >= 80)     av('🍖 Com muita fome!', s.fome >= 95 ? 'perigo' : 'alerta');
  if (s.sede >= 80)     av('💧 Com muita sede!', s.sede >= 95 ? 'perigo' : 'alerta');
  if (s.estresse >= 75) av('😤 Estresse elevado', 'alerta');
  if (s.vicio >= 70)    av('💊 Abstinência! Vício drenando vida', 'perigo');
  else if (s.vicio >= 50) av('💊 Dependência se formando', 'alerta');
  if (estado.condicoes.intoxicado > 0) av('🤢 Intoxicado! Tome um remédio', 'perigo');
  if (estado.condicoes.contundido)     av('🦯 Contundido! Use uma Tala Improvisada', 'perigo');
  if (estado.condicoes.sangramento)    av('🩸 Sangrando! Use uma bandagem ou curativo', 'perigo');
}

// ============================================================
// SISTEMA DE EQUIPAMENTO
// ============================================================

/**
 * Retorna o slot correto para um item (pela chave em ITENS_EQUIPAVEIS).
 */
function getSlotItem(itemId) {
  return ITENS_EQUIPAVEIS[itemId]?.slot || null;
}

/**
 * Equipa um item no slot correspondente.
 * Se já havia algo equipado, devolve para a mochila.
 */
function equiparItem(itemId) {
  const equipInfo = ITENS_EQUIPAVEIS[itemId];
  if (!equipInfo) return;

  const slot     = equipInfo.slot;
  const itemBase = ITENS[itemId];
  if (!itemBase) return;

  // Verificar se tem o item na mochila
  if (!temItem(itemId, 1)) {
    mostrarToast('Item não encontrado na mochila.');
    return;
  }

  // Desequipar o que estava no slot (devolver à mochila)
  if (estado.equipamento[slot]) {
    const anterior = estado.equipamento[slot];
    adicionarItem(ITENS[anterior], 1);
    log(`↩ Desequipou: ${ITENS[anterior]?.icone} ${ITENS[anterior]?.nome}`, 'log-sistema');
  }

  // Remover da mochila e equipar
  removerItem(itemId, 1);
  estado.equipamento[slot] = itemId;

  log(`⚔️ Equipou: ${itemBase.icone} ${itemBase.nome} [${SLOT_LABELS[slot]}]`, 'log-sucesso');
  mostrarToast(`⚔️ ${itemBase.nome} equipado!`);

  renderizarEquipamento();
  renderizarEquipResumo();
  salvarJogo();
}

/**
 * Remove um item de um slot e devolve à mochila.
 */
function desequiparSlot(slot) {
  const itemId = estado.equipamento[slot];
  if (!itemId) return;

  const itemBase = ITENS[itemId];
  adicionarItem(itemBase, 1);
  estado.equipamento[slot] = null;

  log(`↩ Desequipou: ${itemBase?.icone} ${itemBase?.nome}`, 'log-sistema');
  mostrarToast(`${itemBase?.nome} removido.`);

  renderizarEquipamento();
  renderizarEquipResumo();
  salvarJogo();
}

/**
 * Renderiza os slots de equipamento na aba Sobrevivência.
 */
function renderizarEquipamento() {
  for (const slot of SLOTS_EQUIP) {
    const area    = document.getElementById(`slot-${slot}`);
    if (!area) continue;

    const itemId  = estado.equipamento[slot];

    if (itemId) {
      const item     = ITENS[itemId];
      const equipInfo= ITENS_EQUIPAVEIS[itemId];
      const efStr    = equipInfo?.efeitos
        ? Object.entries(equipInfo.efeitos).map(([k, v]) =>
            `${v > 0 ? '+' : ''}${typeof v === 'number' && v < 1 ? (v > 0 ? '+' : '') + Math.round(v * 100) + '%' : v} ${k}`
          ).join(' · ')
        : '';

      area.classList.add('ocupado');
      area.innerHTML = `
        <div class="equip-slot-item">
          <span class="equip-slot-icone">${item?.icone || '?'}</span>
          <div style="flex:1;min-width:0">
            <div class="equip-slot-nome">${item?.nome || itemId}</div>
            ${efStr ? `<div class="equip-slot-efeito">${efStr}</div>` : ''}
          </div>
        </div>
        <button class="btn-desequipar" data-slot="${slot}" title="Remover">✕</button>
      `;

      area.querySelector('.btn-desequipar')
        .addEventListener('click', e => { e.stopPropagation(); desequiparSlot(slot); });

    } else {
      area.classList.remove('ocupado');
      area.innerHTML = `<span class="equip-slot-vazio">—</span>`;
    }

    // Clique na área vazia: não faz nada (equipar vem da mochila)
  }
}

/**
 * Renderiza o resumo de equipamentos no painel esquerdo (abaixo das barras).
 */
function renderizarEquipResumo() {
  const el    = document.getElementById('equip-resumo');
  const bloco = document.getElementById('equip-resumo-bloco');
  if (!el) return;

  el.innerHTML = '';
  const equipados = SLOTS_EQUIP.filter(s => estado.equipamento[s]);

  // Esconder bloco inteiro quando não há nada equipado
  if (bloco) bloco.style.display = equipados.length > 0 ? 'flex' : 'none';
  if (equipados.length === 0) return;

  for (const slot of equipados) {
    const itemId    = estado.equipamento[slot];
    const item      = ITENS[itemId];
    const equipInfo = ITENS_EQUIPAVEIS[itemId];

    const tooltip = equipInfo?.desc || item?.desc || '';

    const row = document.createElement('div');
    row.className = 'equip-resumo-item';
    if (tooltip) row.dataset.tooltip = tooltip;
    row.innerHTML = `
      <span class="equip-resumo-slot">${SLOT_LABELS[slot]}</span>
      <span class="equip-resumo-icone">${item?.icone || '?'}</span>
      <span class="equip-resumo-nome">${item?.nome || itemId}</span>
    `;
    el.appendChild(row);
  }
}

// ============================================================
// MERCADO
// ============================================================

/**
 * Sorteia itens da pool com base em peso (probabilidade ponderada).
 */
function sorteioPonderado(pool, n) {
  const resultado = [];
  const usados    = new Set();
  const disponivel = [...pool];

  while (resultado.length < n && disponivel.length > 0) {
    const totalPeso = disponivel.reduce((s, e) => s + e.peso, 0);
    let r = Math.random() * totalPeso;
    for (let i = 0; i < disponivel.length; i++) {
      r -= disponivel[i].peso;
      if (r <= 0) {
        if (!usados.has(disponivel[i].itemId)) {
          resultado.push(disponivel[i]);
          usados.add(disponivel[i].itemId);
        }
        disponivel.splice(i, 1);
        break;
      }
    }
  }
  return resultado;
}

/**
 * Gera tendência de preço para o item no dia.
 * Retorna { fator, tendencia } onde tendencia é 'alta' | 'normal' | 'baixa'.
 */
function gerarTendencia() {
  const r = Math.random();
  if (r < 0.25) return { fator: 0.6 + Math.random() * 0.25, tendencia: 'baixa'  }; // 0.60–0.85
  if (r < 0.50) return { fator: 0.85 + Math.random() * 0.3,  tendencia: 'normal' }; // 0.85–1.15
  if (r < 0.75) return { fator: 1.15 + Math.random() * 0.3,  tendencia: 'normal' }; // 1.15–1.45
  return              { fator: 1.45 + Math.random() * 0.55, tendencia: 'alta'   }; // 1.45–2.00
}

/**
 * Gera os itens do dia para a loja com preços flutuantes por demanda.
 */
function gerarEstoqueMercado() {
  const selecionados = sorteioPonderado(MERCADO_POOL, MERCADO_MAX_ITENS);

  // Fator global de venda do dia (quanto o mercado paga pelos itens do jogador)
  const fatorVenda = parseFloat((0.7 + Math.random() * 0.6).toFixed(2)); // 0.70–1.30

  const escolhas = selecionados.map(entrada => {
    const { fator, tendencia } = gerarTendencia();
    const preco = Math.max(1, Math.round(entrada.precoBase * fator));
    return {
      itemId:    entrada.itemId,
      precoBase: entrada.precoBase,
      preco,
      tendencia,
      qtd:       entrada.qtd,
      comprado:  false,
    };
  });

  estado.mercado = { itens: escolhas, diaGerado: estado.dia, fatorVenda };

  const tendVenda = fatorVenda >= 1.1 ? '📈 Mercado favorável para vender hoje!'
                  : fatorVenda <= 0.85 ? '📉 Mercado desfavorável — preços de compra baixos hoje.'
                  : '↔️ Mercado estável hoje.';
  log(`🏷️ A loja geral renovou seu estoque. ${tendVenda}`, 'log-sistema');
}

/**
 * Verifica se o mercado precisa ser renovado (novo dia).
 */
function verificarMercado() {
  if (estado.mercado.diaGerado < estado.dia) {
    gerarEstoqueMercado();
    renderizarMercado();
    salvarJogo();
  }
}

/**
 * Executa a compra de um item do mercado.
 */
function comprarItemMercado(idx) {
  const entrada = estado.mercado.itens[idx];
  if (!entrada || entrada.comprado) return;

  const item = ITENS[entrada.itemId];
  if (!item) return;

  // Verificar saldo (Pilhas Velhas)
  if (!temItem('pilha', entrada.preco)) {
    mostrarToast(`🔋 Precisa de ${entrada.preco} Pilha(s) Velha(s).`);
    log(`Sem saldo para comprar ${item.nome}. Precisa de ${entrada.preco} 🔋.`, 'log-alerta');
    return;
  }

  // Verificar espaço na mochila
  const existeNaMochila = estado.inventario.find(i => i.id === entrada.itemId);
  if (!existeNaMochila && estado.inventario.length >= estado.capInventario) {
    mostrarToast('⚠️ Mochila cheia!');
    return;
  }

  // Debitar e adicionar
  removerItem('pilha', entrada.preco);
  adicionarItem(item, entrada.qtd);
  entrada.comprado = true;

  log(`🛒 Comprou: ${item.icone} ${item.nome} ×${entrada.qtd} por ${entrada.preco} 🔋`, 'log-sucesso');
  mostrarToast(`🛒 ${item.nome} comprado!`);

  renderizarMercado();
  salvarJogo();
}

/**
 * Vende 1 unidade de um item em troca de Pilhas Velhas.
 */
function venderItem(itemId) {
  const preco = getPrecoVenda(itemId);
  if (!preco || !temItem(itemId, 1)) return;
  const item = ITENS[itemId];
  removerItem(itemId, 1);
  adicionarItem(ITENS.pilha, preco);
  log(`Vendeu ${item.nome} por ${preco} 🔋.`, 'log-loot');
  mostrarToast(`💰 +${preco} 🔋`);
  renderizarMercado();
  salvarJogo();
}

/**
 * Renderiza o painel do mercado.
 */
function renderizarMercado() {
  // Saldo
  const saldoEl = document.getElementById('mercado-saldo-val');
  const pilhas  = estado.inventario.find(i => i.id === 'pilha');
  if (saldoEl) saldoEl.textContent = `${pilhas?.qtd || 0} 🔋`;

  // Texto de renovação
  const renovEl = document.getElementById('mercado-renovacao-txt');
  if (renovEl) renovEl.textContent = `Estoque do Dia ${estado.mercado.diaGerado} · Renova no Dia ${estado.mercado.diaGerado + 1}`;

  // Indicador de fator de venda do dia
  const fatorEl  = document.getElementById('mercado-fator-venda');
  const fv       = estado.mercado.fatorVenda ?? 1;
  if (fatorEl) {
    const cls  = fv >= 1.1 ? 'fator-alto' : fv <= 0.85 ? 'fator-baixo' : 'fator-normal';
    const icon = fv >= 1.1 ? '📈' : fv <= 0.85 ? '📉' : '↔️';
    const pct  = Math.round(fv * 100);
    fatorEl.className  = `mercado-fator-venda ${cls}`;
    fatorEl.textContent = `${icon} Venda hoje: ${pct}% do valor base`;
  }

  const container = document.getElementById('mercado-itens');
  const vazio     = document.getElementById('mercado-vazio');
  if (!container) return;

  container.innerHTML = '';
  const itens = estado.mercado.itens || [];

  if (itens.length === 0) {
    if (vazio) vazio.classList.remove('oculto');
    return;
  }
  if (vazio) vazio.classList.add('oculto');

  const pilhasQtd = pilhas?.qtd || 0;

  itens.forEach((entrada, idx) => {
    const item = ITENS[entrada.itemId];
    if (!item) return;

    // Efeitos resumidos
    let efeitoStr = '';
    if (item.efeitos && Object.keys(item.efeitos).length) {
      efeitoStr = Object.entries(item.efeitos)
        .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(' · ');
    }

    const semSaldo  = pilhasQtd < entrada.preco;
    const comprado  = entrada.comprado;

    const card = document.createElement('div');
    card.className = `mercado-card${comprado ? ' comprado' : semSaldo ? ' sem-saldo' : ''}`;

    const tendIcon = entrada.tendencia === 'alta'  ? '<span class="tend-alta">▲</span>'
                   : entrada.tendencia === 'baixa' ? '<span class="tend-baixa">▼</span>'
                   :                                 '<span class="tend-normal">—</span>';
    const precoBase = entrada.precoBase ?? entrada.preco;
    const difPreco  = entrada.preco - precoBase;
    const difStr    = difPreco !== 0 ? ` <span class="preco-dif">(base ${precoBase})</span>` : '';

    card.innerHTML = `
      <span class="mercado-item-icone">${item.icone}</span>
      <div class="mercado-item-info">
        <span class="mercado-item-nome">${item.nome}</span>
        <span class="mercado-item-tipo">${item.tipo}${entrada.qtd > 1 ? ` · ×${entrada.qtd}` : ''}</span>
        ${efeitoStr ? `<span class="mercado-item-efeito">${efeitoStr}</span>` : ''}
      </div>
      <div class="mercado-preco-bloco">
        <span class="mercado-preco">${entrada.preco} 🔋</span>
        <span class="mercado-tend">${tendIcon}${difStr}</span>
      </div>
      <button class="btn-comprar btn-primario"
        ${comprado ? 'disabled' : semSaldo ? 'disabled' : ''}
        data-idx="${idx}">
        ${comprado ? '✓ Comprado' : semSaldo ? 'Sem saldo' : 'Comprar'}
      </button>
    `;

    container.appendChild(card);
  });

  // Event delegation nos botões de compra
  container.querySelectorAll('.btn-comprar:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => comprarItemMercado(parseInt(btn.dataset.idx)));
  });

  // ── Seção de venda ──
  const vendaContainer = document.getElementById('mercado-venda');
  const vendaVazio     = document.getElementById('mercado-venda-vazio');
  if (!vendaContainer) return;

  vendaContainer.innerHTML = '';

  const vendaveis = estado.inventario
    .map(i => ({ ...i, preco: getPrecoVenda(i.id) }))
    .filter(i => i.preco !== null && i.id !== 'pilha');

  if (vendaveis.length === 0) {
    if (vendaVazio) vendaVazio.classList.remove('oculto');
  } else {
    if (vendaVazio) vendaVazio.classList.add('oculto');

    vendaveis.forEach(entrada => {
      const item  = ITENS[entrada.id];
      const preco = entrada.preco;
      if (!item) return;

      const isCraftado = !!(
        RECEITAS.find(r => r.id === entrada.id) ||
        RECEITAS_FOGUEIRA.find(r => r.id === entrada.id)
      );

      const card = document.createElement('div');
      card.className = 'mercado-card';

      card.innerHTML = `
        <span class="mercado-item-icone">${item.icone}</span>
        <div class="mercado-item-info">
          <span class="mercado-item-nome">${item.nome}${isCraftado ? ' <span class="tag-craftado">craftado</span>' : ''}</span>
          <span class="mercado-item-tipo">${item.tipo} · ×${entrada.qtd} na mochila</span>
        </div>
        <span class="mercado-preco${isCraftado ? ' preco-craftado' : ''}">${preco} 🔋</span>
        <button class="btn-vender btn-secundario" data-id="${entrada.id}">Vender 1</button>
      `;

      vendaContainer.appendChild(card);
    });

    vendaContainer.querySelectorAll('.btn-vender').forEach(btn => {
      btn.addEventListener('click', () => venderItem(btn.dataset.id));
    });
  }
}

// ============================================================
// SISTEMA DE SAQUE NOTURNO
// ============================================================

/**
 * Calcula o nível de segurança atual da base.
 * Retorna objeto { nivel: 0-100, label, cor, chanceSaque }
 */
function calcularSeguranca() {
  let pontos = 0;

  // Estruturas de defesa contribuem com pontos
  if (baseTemEstrutura('bancada'))              pontos += 10; // organização básica
  if (baseTemEstrutura('fogueira'))             pontos += 5;  // mas fogueira ilumina = risco à noite
  pontos += Math.min(estado.seguranca.armadilhasInstaladas * 10, 40); // armadilhas instaladas
  if (estado.deposito.nivel > 0)                pontos += 10; // depósito organiza itens = menos atraente

  // Ter itens valiosos no inventário atrai mais pilhadores
  const qtdItens = estado.inventario.reduce((s, i) => s + i.qtd, 0);
  if (qtdItens > 15) pontos -= 10; // muito loot visível = alvo fácil
  if (qtdItens > 25) pontos -= 10;

  // Fogueira acesa à noite aumenta visibilidade
  if (baseTemEstrutura('fogueira')) pontos -= 8;

  pontos = clamp(pontos, 0, 100);

  // Chance de saque: começa em 60%, cai conforme segurança sobe
  // Mínimo de 5% mesmo com defesa máxima
  const chanceSaque = Math.max(0.05, 0.60 - (pontos / 100) * 0.55);

  let label, cor;
  if (pontos < 15)      { label = 'Crítico';  cor = 'var(--red-l)';    }
  else if (pontos < 35) { label = 'Baixo';    cor = 'var(--accent-l)'; }
  else if (pontos < 60) { label = 'Médio';    cor = '#d4b84a';         }
  else if (pontos < 80) { label = 'Bom';      cor = 'var(--green-l)';  }
  else                  { label = 'Seguro';   cor = 'var(--green-l)';  }

  return { pontos, label, cor, chanceSaque };
}

/**
 * Narrativas de saque — jogador ausente (explorando), itens do depósito roubados.
 */
const NARRATIVAS_SAQUE = {
  leve: [
    'Ao voltar, você percebe que alguém entrou. Pegaram o que estava mais à vista no depósito.',
    'Rastros de pegadas ao redor do abrigo. Vasculharam enquanto você estava fora.',
    'A tranca estava forçada. Levaram pouco — ou não encontraram o resto.',
  ],
  medio: [
    'Você chega e o depósito está revirado. Trabalho silencioso. Sabiam o que procuravam.',
    'Dois deles, pelo rastro. Levaram mais do que você gostaria de admitir do depósito.',
    'Entraram pela lateral. O depósito foi o alvo. Levaram uma parte considerável.',
  ],
  pesado: [
    'Vieram em número enquanto você estava fora. Limparam o depósito quase por inteiro.',
    'Pilhadores organizados. Você deveria ter ficado. O depósito pagou o preço.',
    'Ataque coordenado na sua ausência. O depósito foi devastado.',
  ],
};

/**
 * Processa o saque noturno ao virar o dia.
 * Se o jogador está na base → protege, saque não ocorre.
 * Se está explorando → saque roba do depósito.
 */
function processarSaqueNoturno() {
  const jogadorAusente = estado.exploracao.ativa;

  // Jogador presente: protege a base — saque não acontece
  if (!jogadorAusente) {
    if (Math.random() < 0.35) {
      log('🌙 Você manteve vigília. A base não foi invadida.', 'log-sistema');
    }
    atualizarDefesaUI();
    return;
  }

  // Jogador ausente: calcular chance de saque
  const seg = calcularSeguranca();

  if (Math.random() > seg.chanceSaque) {
    // Noite tranquila mesmo sem o jogador
    if (Math.random() < 0.3) {
      log('🌙 A noite passou sem incidentes. O depósito está intacto.', 'log-sistema');
    }
    atualizarDefesaUI();
    return;
  }

  // ── SAQUE ACONTECE — roba do depósito ──
  const temArmadilha = estado.seguranca.armadilhasInstaladas > 0;
  let fatorRoubo;
  let intensidade;

  const roll = Math.random();
  if (roll < 0.5) {
    fatorRoubo = temArmadilha ? 0.10 : 0.20;
    intensidade = 'leve';
  } else if (roll < 0.85) {
    fatorRoubo = temArmadilha ? 0.20 : 0.40;
    intensidade = 'medio';
  } else {
    fatorRoubo = temArmadilha ? 0.30 : 0.60;
    intensidade = 'pesado';
  }

  // Itens roubáveis = depósito (exceto anotações e leituras)
  const itensDeposito = estado.deposito.itens
    .filter(i => i.tipo !== 'anotacao' && i.tipo !== 'leitura')
    .sort((a, b) => {
      const prio = { medicinal: 3, consumivel: 2, ferramenta: 1, material: 0 };
      return (prio[b.tipo] || 0) - (prio[a.tipo] || 0);
    });

  if (itensDeposito.length === 0) {
    log('🌙 Tentaram invadir enquanto você estava fora, mas o depósito estava vazio.', 'log-sistema');
    atualizarDefesaUI();
    return;
  }

  const qtdTotal = itensDeposito.reduce((s, i) => s + i.qtd, 0);
  let qtdRoubar  = Math.max(1, Math.floor(qtdTotal * fatorRoubo));
  const roubados = [];

  for (const item of itensDeposito) {
    if (qtdRoubar <= 0) break;
    const qtdLevar = Math.min(item.qtd, qtdRoubar);
    // Remover do depósito
    const depItem = estado.deposito.itens.find(i => i.id === item.id);
    if (depItem) {
      depItem.qtd -= qtdLevar;
      if (depItem.qtd <= 0) {
        estado.deposito.itens = estado.deposito.itens.filter(i => i.id !== item.id);
      }
    }
    roubados.push(`${item.icone} ${item.nome} ×${qtdLevar}`);
    qtdRoubar -= qtdLevar;
  }

  // Narrativa
  const narrativa = NARRATIVAS_SAQUE[intensidade][randInt(0, 2)];

  // Estresse ao descobrir o saque
  const estresseSaque = { leve: 12, medio: 22, pesado: 35 }[intensidade];
  estado.stats.estresse = clamp(estado.stats.estresse + estresseSaque, 0, 100);

  // Log
  log(`🚨 INVASÃO NA SUA AUSÊNCIA — ${intensidade.toUpperCase()}`, 'log-perigo');
  log(`   ${narrativa}`, 'log-perigo');
  if (roubados.length > 0) {
    log(`   Depósito: ${roubados.join(', ')}`, 'log-perigo');
  }
  if (temArmadilha) {
    log(`   🪤 ${estado.seguranca.armadilhasInstaladas} armadilha(s) limitaram o estrago.`, 'log-alerta');
  }

  mostrarToast(`🚨 Base invadida! Depósito saqueado.`, 4000);

  estado.ultimoSaque = {
    dia:        estado.dia - 1,
    intensidade,
    itens:      roubados.join(', ') || 'nenhum item'
  };

  atualizarDefesaUI();
  atualizarUI();
}

/**
 * Atualiza o painel de defesa na aba Base.
 */
function atualizarDefesaUI() {
  const seg = calcularSeguranca();

  // Barra e label
  const barra = document.getElementById('barra-seguranca');
  const val   = document.getElementById('val-seguranca');
  const chance= document.getElementById('val-chance-saque');
  const dica  = document.getElementById('defesa-dica-txt');

  if (barra) { barra.style.width = seg.pontos + '%'; barra.style.background = seg.cor; }
  if (val)   { val.textContent = seg.label; val.style.color = seg.cor; }

  if (chance) {
    const pct = Math.round(seg.chanceSaque * 100);
    chance.textContent = `${pct}% por noite`;
    chance.className   = 'status-val ' + (pct >= 50 ? 'defesa-alerta' : pct >= 25 ? 'defesa-medio' : 'defesa-ok');
  }

  // Lista de estruturas de defesa ativas
  const el = document.getElementById('defesa-estruturas');
  if (el) {
    const estruturas = [
      { id: '_seguranca', icone: '🪤', nome: `Segurança (${estado.seguranca.armadilhasInstaladas} armadilhas)`, efeito: '−50% itens roubados por armadilha instalada', ativo: estado.seguranca.armadilhasInstaladas > 0 },
      { id: '_deposito',            icone: '📦', nome: 'Depósito',             efeito: '−10% chance (menos visível)', ativo: estado.deposito.nivel > 0 },
      { id: 'fogueira',             icone: '🔥', nome: 'Fogueira',             efeito: '⚠️ +8% risco (ilumina o local)' },
      { id: 'bancada',              icone: '🔨', nome: 'Bancada de Trabalho',  efeito: '+10 segurança (organização)' },
    ];

    el.innerHTML = '';
    for (const e of estruturas) {
      const ativa = e.ativo !== undefined ? e.ativo : baseTemEstrutura(e.id);
      const div = document.createElement('div');
      div.className = `defesa-item ${ativa ? 'defesa-item-ativo' : 'defesa-item-inativo'}`;
      div.innerHTML = `
        <span class="defesa-item-icone">${e.icone}</span>
        <div style="flex:1">
          <div style="font-size:.78rem;font-weight:700">${e.nome}</div>
          <div style="font-size:.68rem;opacity:.75">${e.efeito}</div>
        </div>
        <span>${ativa ? '✓' : '✗'}</span>
      `;
      el.appendChild(div);
    }
  }

  // Dica dinâmica
  if (dica) {
    const ausente = estado.exploracao?.ativa;
    if (ausente) {
      dica.textContent = '⚠ Você está fora — base desprotegida. Invasores podem roubar o depósito.';
      dica.style.color = 'var(--red-l)';
    } else {
      dica.style.color = '';
      if (seg.pontos < 15)      dica.textContent = 'Sua presença protege a base. Sem armadilhas, o risco ao sair é crítico.';
      else if (seg.pontos < 35) dica.textContent = 'Proteção mínima. Instale armadilhas antes de explorar.';
      else if (seg.pontos < 60) dica.textContent = 'Segurança razoável. Ainda vulnerável se você sair por muito tempo.';
      else if (seg.pontos < 80) dica.textContent = 'Boa defesa. A maioria dos pilhadores vai evitar a base na sua ausência.';
      else                      dica.textContent = 'Base bem defendida. Pode explorar com menos preocupação.';
    }
  }

  // Último saque
  const ultimoSaqueEl  = document.getElementById('ultimo-saque');
  const ultimoSaqueTxt = document.getElementById('ultimo-saque-txt');
  if (ultimoSaqueEl && estado.ultimoSaque) {
    ultimoSaqueEl.classList.remove('oculto');
    const { dia, intensidade, itens } = estado.ultimoSaque;
    ultimoSaqueTxt.textContent = `Dia ${dia} — ${intensidade} — ${itens}`;
  }
}

let zonaAtual = { zona: 'ruinas', perigo: 'baixo', duracao: 10 };

// Imagens de miniatura dos locais (usadas na barra de jornada)
const IMAGENS_ZONA = {
  ruinas:             'img/locais/local01.png',
  mercado:            'img/locais/local02.png',
  hospital:           'img/locais/local03.png',
  floresta:           'img/locais/local04.png',
  posto:              'img/locais/local05.png',
  deposito_logistico: 'img/locais/local06.png',
  garagem:            'img/locais/local07.png',
  fabrica_textil:     'img/locais/local08.png',
  subestacao:         'img/locais/local09.png',
  silo:               'img/locais/local10.png',
};

function iniciarExploracao() {
  if (estado.exploracao.ativa) return;
  if (estado.stats.vida <= 15) { mostrarToast('⚠️ Vida muito baixa para explorar!'); return; }

  const durTotal = zonaAtual.duracao; // tempo total em segundos
  // Divide o tempo: metade para ida, 5s fixos para exploração, metade para volta
  // Se duração < 10, ajusta proporcionalmente
  const tempoMetade  = Math.max(2, Math.floor((durTotal - 5) / 2));
  const tempoIda     = tempoMetade;
  const tempoExplora = Math.min(5, durTotal - tempoMetade * 2);
  const tempoVolta   = durTotal - tempoIda - tempoExplora;

  Object.assign(estado.exploracao, {
    ativa:    true,
    zona:     zonaAtual.zona,
    perigo:   zonaAtual.perigo,
    duracao:  durTotal,
    progresso:0,
    // fases
    faseAtual:      'ida',   // 'ida' | 'explorando' | 'volta'
    tempoIda,
    tempoExplora,
    tempoVolta,
    tickFase:       0,       // tick dentro da fase atual
    eventoDisparado:    false, // garante no máximo 1 evento de escolha por exploração
    eventoAtivo:        null,  // id do evento em espera de resposta
    _npcTrocaAtiva:     null,  // dados da troca de NPC em andamento
    descobertaDisparada: false, // garante no máximo 1 descoberta por exploração
  });

  // UI
  document.querySelectorAll('.btn-explorar-local').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
  document.getElementById('painel-exploracao')?.classList.remove('oculto');
  document.querySelector('.aba-btn[data-aba="base"]')?.classList.add('aba-bloqueada');

  const nomeLocal  = nomesZona[zonaAtual.zona] || zonaAtual.zona;
  const imgDestino = IMAGENS_ZONA[zonaAtual.zona] || '';

  // Atualizar nome e miniatura do destino
  const expZona    = document.getElementById('exp-zona-txt');
  const destinoImg = document.getElementById('exp-destino-img');
  if (expZona)    expZona.textContent = nomeLocal;
  if (destinoImg) { destinoImg.src = imgDestino; destinoImg.alt = nomeLocal; destinoImg.classList.remove('ativa'); }

  atualizarBarraJornada();
  const logsSaida = LOGS_ZONA[zonaAtual.zona]?.saida;
  const msgSaida  = logsSaida ? logsSaida[randInt(0, logsSaida.length - 1)] : `Você saiu em direção a: ${nomeLocal}.`;
  log(`🚶 ${msgSaida}`, 'log-alerta');
  estado.stats.estresse = clamp(estado.stats.estresse + 5 * getMultiTraco().estresseMulti, 0, 100);

  estado.exploracao.timer = setInterval(tickExploracao, 1000);
}

/**
 * Tick da exploração — atualiza fase e posição do personagem.
 */
function tickExploracao() {
  const exp = estado.exploracao;
  exp.tickFase++;
  exp.progresso++;

  const durFaseAtual = exp.faseAtual === 'ida'       ? exp.tempoIda
                     : exp.faseAtual === 'explorando' ? exp.tempoExplora
                     :                                  exp.tempoVolta;

  // ── Tentar descoberta rara (tick final da fase explorando, ~8%) ──
  if (exp.faseAtual === 'explorando' && !exp.descobertaDisparada) {
    const tickFinal = Math.max(1, exp.tempoExplora - 1);
    if (exp.tickFase === tickFinal && Math.random() < 0.08) {
      exp.descobertaDisparada = true;
      dispararEventoDescoberta();
    }
  }

  // ── Tentar disparar evento durante fase explorando ──
  if (exp.faseAtual === 'explorando' && !exp.eventoDisparado) {
    const meio = Math.max(1, Math.floor(exp.tempoExplora / 2));
    if (exp.tickFase === meio) {
      const chancaPorPerigo = { baixo: 0.30, medio: 0.50, alto: 0.70 };
      const chanca = chancaPorPerigo[exp.perigo] ?? 0.40;
      if (Math.random() < chanca) {
        clearInterval(estado.exploracao.timer);
        exp.eventoDisparado = true;
        atualizarBarraJornada();
        dispararEventoEscolha();
        return; // pausa até o jogador escolher
      } else {
        exp.eventoDisparado = true; // rolou mas não disparou — não tenta de novo
      }
    }
  }

  // Transição de fase
  if (exp.tickFase >= durFaseAtual) {
    exp.tickFase = 0;
    if (exp.faseAtual === 'ida') {
      exp.faseAtual = 'explorando';
      const logsChegada = LOGS_ZONA[exp.zona]?.chegada;
      const logsExplorando = LOGS_ZONA[exp.zona]?.explorando;
      const msgChegada  = logsChegada    ? logsChegada[randInt(0, logsChegada.length - 1)]       : `Chegou em ${nomesZona[exp.zona] || exp.zona}.`;
      const msgExplorando = logsExplorando ? logsExplorando[randInt(0, logsExplorando.length - 1)] : 'Vasculhando o local...';
      log(`📍 ${msgChegada}`, 'log-alerta');
      log(`🔍 ${msgExplorando}`, 'log-sistema');
    } else if (exp.faseAtual === 'explorando') {
      exp.faseAtual = 'volta';
      const logsRetorno = LOGS_ZONA[exp.zona]?.retorno;
      const msgRetorno  = logsRetorno ? logsRetorno[randInt(0, logsRetorno.length - 1)] : 'Voltando para a base...';
      log(`🚶 ${msgRetorno}`, 'log-sistema');
    } else {
      // volta completa — pausa de 3s antes de finalizar
      clearInterval(estado.exploracao.timer);
      exp.faseAtual = 'chegando';
      atualizarBarraJornada();
      setTimeout(finalizarExploracao, 3000);
      return;
    }
  }

  atualizarBarraJornada();
}

/**
 * Atualiza visual da barra de jornada conforme a fase.
 */
function atualizarBarraJornada() {
  const exp = estado.exploracao;
  if (!exp.ativa) return;

  const faseTxt   = document.getElementById('exp-fase-txt');
  const faseIco   = document.getElementById('exp-fase-icone');
  const timerEl   = document.getElementById('exp-timer-txt');
  const trilha    = document.getElementById('exp-trilha-fill');
  const personEl  = document.getElementById('exp-personagem');
  const lupaEl    = document.getElementById('exp-lupa');
  const trilhaWrap= personEl?.closest('.exp-trilha-wrap');
  const destinoImg= document.getElementById('exp-destino-img');

  // Tempo restante total
  const restante = exp.duracao - exp.progresso;
  if (timerEl) timerEl.textContent = `${restante}s`;

  // Posição do personagem (0% = base, 100% = local)
  let posicao = 0; // 0–100

  if (exp.faseAtual === 'ida') {
    posicao = (exp.tickFase / exp.tempoIda) * 100;
    if (faseTxt) faseTxt.textContent  = 'Indo ao local...';
    if (faseIco) faseIco.textContent  = '🚶';
    if (trilha)     { trilha.style.width = posicao + '%'; trilha.classList.remove('fase-explorando'); }
    if (trilhaWrap) trilhaWrap.classList.remove('fase-explorando');
    if (personEl) {
      personEl.classList.remove('voltando', 'fase-explorando', 'fase-volta');
      personEl.classList.add('fase-ida');
    }
    if (destinoImg) destinoImg.classList.remove('ativa');
  } else if (exp.faseAtual === 'explorando') {
    posicao = 100;
    if (faseTxt) faseTxt.textContent  = '⚠️ Explorando...';
    if (faseIco) faseIco.textContent  = '🔍';
    if (trilha)     { trilha.style.width = '100%'; trilha.classList.add('fase-explorando'); }
    if (trilhaWrap) trilhaWrap.classList.add('fase-explorando');
    if (personEl) {
      personEl.classList.remove('voltando', 'fase-ida', 'fase-volta', 'fase-explorando');
    }
    if (destinoImg) destinoImg.classList.add('ativa');
  } else if (exp.faseAtual === 'volta') {
    posicao = 100 - (exp.tickFase / exp.tempoVolta) * 100;
    if (faseTxt) faseTxt.textContent  = 'Voltando para a base...';
    if (faseIco) faseIco.textContent  = '🚶';
    if (trilha)     { trilha.style.width = posicao + '%'; trilha.classList.remove('fase-explorando'); }
    if (trilhaWrap) trilhaWrap.classList.remove('fase-explorando');
    if (personEl) {
      personEl.classList.add('voltando', 'fase-volta');
      personEl.classList.remove('fase-ida', 'fase-explorando');
    }
    if (destinoImg) destinoImg.classList.remove('ativa');
  } else if (exp.faseAtual === 'chegando') {
    posicao = 0;
    if (faseTxt) faseTxt.textContent  = 'De volta à base...';
    if (faseIco) faseIco.textContent  = '🏠';
    if (trilha)     { trilha.style.width = '0%'; trilha.classList.remove('fase-explorando'); }
    if (trilhaWrap) trilhaWrap.classList.remove('fase-explorando');
    if (personEl) {
      personEl.classList.remove('voltando', 'fase-ida', 'fase-volta', 'fase-explorando');
    }
    if (destinoImg) destinoImg.classList.remove('ativa');
  }

  if (personEl) personEl.style.left = clamp(posicao, 0, 100) + '%';
  if (lupaEl)   lupaEl.style.left   = clamp(posicao, 0, 100) + '%';
}

function finalizarExploracao() {
  clearInterval(estado.exploracao.timer);
  estado.exploracao.ativa = false;
  estado.placar.exploracoes++;

  // Ocultar painel e resetar trilha
  document.getElementById('painel-exploracao')?.classList.add('oculto');
  const trilha   = document.getElementById('exp-trilha-fill');
  const personEl = document.getElementById('exp-personagem');
  if (trilha)   { trilha.style.width = '0%'; trilha.classList.remove('fase-explorando'); }
  if (personEl) { personEl.style.left = '0%'; personEl.classList.remove('voltando', 'fase-ida', 'fase-explorando', 'fase-volta'); }
  const lupaElFim = document.getElementById('exp-lupa');
  if (lupaElFim) lupaElFim.style.left = '0%';
  personEl?.closest('.exp-trilha-wrap')?.classList.remove('fase-explorando');
  const destinoImgFim = document.getElementById('exp-destino-img');
  if (destinoImgFim) destinoImgFim.classList.remove('ativa');

  // Reabilitar botões e aba Base
  document.querySelector('.aba-btn[data-aba="base"]')?.classList.remove('aba-bloqueada');
  document.querySelectorAll('.btn-explorar-local').forEach(b => {
    b.disabled = false; b.style.opacity = '1';
  });
  renderizarLocais();

  const chegadaBase = [
    'De volta ao abrigo. Você fecha a porta e solta o ar.',
    'Chegou. Você joga a mochila no chão e verifica o que trouxe.',
    'Base. Seguro por enquanto. Você confere o que sobrou.',
    'Dentro. Você trava a porta antes de qualquer coisa.',
  ];
  log(`🏠 ${chegadaBase[randInt(0, chegadaBase.length - 1)]}`, 'log-sistema');
  gerarLoot(estado.exploracao.zona, estado.exploracao.perigo);

  const chanceBase = { baixo: 0.25, medio: 0.45, alto: 0.65 }[estado.exploracao.perigo];
  const chance = chanceBase * getMultiTatica().eventoChance;
  if (Math.random() < chance) {
    const lista = EVENTOS_NEGATIVOS[estado.exploracao.perigo];
    const ev    = lista[randInt(0, lista.length - 1)];
    log(`⚠️ ${ev.msg}`, 'log-perigo');
    for (const [stat, val] of Object.entries(ev.efeitos))
      estado.stats[stat] = clamp((estado.stats[stat] || 0) + val, 0, stat === 'vida' ? estado.stats.vidaMax : 100);
    if (ev.condicao === 'contundido' && !estado.condicoes.contundido) {
      estado.condicoes.contundido = true;
      log('🦯 Você está contundido! Use uma Tala Improvisada para tratar.', 'log-perigo');
    }
    if (ev.condicao === 'sangramento' && !estado.condicoes.sangramento) {
      estado.condicoes.sangramento = true;
      log('🩸 Você está sangrando! Use uma bandagem ou curativo para tratar.', 'log-perigo');
    }
    atualizarUI();
  }

  renderizarCrafting();
  salvarJogo();
}

function gerarLoot(zona) {
  const tabela = LOOT_TABLE[zona] || LOOT_TABLE.ruinas;
  const traco  = TRACOS[estado.personagem.traco]?.efeitos || {};

  // ── Registrar exploração e calcular depleção ──
  // Cada exploração do mesmo local acumula depleção. Recupera com o tempo.
  if (!estado.exploracoesZona[zona]) estado.exploracoesZona[zona] = 0;
  estado.exploracoesZona[zona]++;
  const vezes = estado.exploracoesZona[zona];

  // Fator de depleção: a cada 3 explorações consecutivas, comida e água perdem 25% de peso
  // Máximo de 85% de redução. Recuperação acontece pelo respawnTicks (no loop).
  const deplecao = Math.min(0.85, Math.floor((vezes - 1) / 3) * 0.25);

  // Avisar jogador quando começa a sentir o esvaziamento
  if (vezes === 4) log(`⚠️ ${nomesZona[zona] || zona}: recursos começando a escassear.`, 'log-alerta');
  if (vezes === 7) log(`⚠️ ${nomesZona[zona] || zona}: local bastante esgotado. Considere explorar outro lugar.`, 'log-alerta');

  // Reiniciar contador de ticks de respawn para esta zona
  estado.respawnTicks[zona] = 0;

  // ── Bônus de chance de anotação por dia sobrevivido ──
  const bonusDia = estado.dia * 0.005;

  // Bônus de loot do equipamento (aditivo ao traço)
  const eq           = getEfeitosEquipamento();
  const lootMulti    = (traco.lootBonus || 1) + eq.lootBonus + getMultiTatica().lootBonus;

  const qtdDrops = randInt(2, 4);
  let encontrou  = false;

  for (let i = 0; i < qtdDrops; i++) {
    if (Math.random() * lootMulti < 0.2) continue;

    // Construir tabela modificada com depleção aplicada a consumíveis
    const tabelaMod = tabela.map(item => {
      const ehAnotacao   = item.tipo === 'anotacao';
      const ehLeitura    = item.tipo === 'leitura';
      const ehConsumivel = item.tipo === 'consumivel';

      let peso = item.peso;

      // Anotações: bônus por dia, zera se local já desbloqueado
      if (ehAnotacao) {
        const jaDesbloqueado = item.localId && estado.locaisDesbloqueados.includes(item.localId);
        if (jaDesbloqueado) return { ...item, peso: 0 };
        peso = item.peso + (item.peso * bonusDia * 10);
      }

      // Leituras: bônus por dia, zera se todas as receitas do catálogo já foram aprendidas
      if (ehLeitura) {
        const catalogoId      = item.catalogoId;
        const proximaReceita  = catalogoId ? proximaReceitaCatalogo(catalogoId) : null;
        if (!proximaReceita) return { ...item, peso: 0 }; // nada mais a ensinar
        peso = item.peso + (item.peso * bonusDia * 8);
      }

      // Consumíveis: reduzir peso conforme depleção do local
      if (ehConsumivel) {
        peso = Math.max(1, item.peso * (1 - deplecao));
      }

      return { ...item, peso };
    });

    const base = sortearPorPeso(tabelaMod);
    if (!base || base.peso === 0) continue;

    const qtd = randInt(base.qtd[0], base.qtd[1]);
    if (adicionarItem(base, qtd)) {
      log(`  → Encontrou: ${base.icone} ${base.nome} ×${qtd}`, 'log-loot');
      encontrou = true;
    } else {
      log(`  → Mochila cheia! Deixou ${base.nome} para trás.`, 'log-alerta');
    }
  }

  if (!encontrou) log('  → Nada de útil encontrado desta vez.', 'log-sistema');
}

// ============================================================
// EVENTOS COM ESCOLHA
// ============================================================

function dispararEventoDescoberta() {
  const exp    = estado.exploracao;
  const nivel  = exp.perigo;
  const ordemPerigo = ['baixo', 'medio', 'alto'];

  const candidatos = EVENTOS_DESCOBERTA.filter(ev =>
    !ev.perigo_min || ordemPerigo.indexOf(nivel) >= ordemPerigo.indexOf(ev.perigo_min)
  );

  if (!candidatos.length) return;

  const ev   = candidatos[randInt(0, candidatos.length - 1)];
  const item = ITENS[ev.loot.id];
  if (!item) return;

  if (!adicionarItem(item, ev.loot.qtd)) {
    log(`✨ ${ev.msg}`, 'log-descoberta');
    log(`  → Mochila cheia! Você deixou ${item.nome} para trás.`, 'log-alerta');
    return;
  }

  log(`✨ ${ev.msg}`, 'log-descoberta');
  log(`  → Item raro encontrado: ${item.icone} ${item.nome}`, 'log-descoberta');
  mostrarToastRaro(`${item.icone} ${item.nome} encontrado!`);
}

function mostrarToastRaro(msg) {
  const t = document.getElementById('toast');
  t.classList.remove('oculto', 'toast-raro');
  t.textContent = msg;
  t.classList.add('toast-raro');
  clearTimeout(_toastTimer);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('visivel')));
  _toastTimer = setTimeout(() => {
    t.classList.remove('visivel');
    setTimeout(() => { t.classList.add('oculto'); t.classList.remove('toast-raro'); }, 300);
  }, 4000);
}

function dispararEventoEscolha() {
  const exp   = estado.exploracao;
  const nivel = exp.perigo; // 'baixo' | 'medio' | 'alto'

  // 30% de chance de ser encontro com NPC andarilho
  if (Math.random() < 0.30) {
    const ordemPerigo = ['baixo', 'medio', 'alto'];
    const npcsCandidatos = EVENTOS_NPC.filter(n => {
      if (!n.perigo_min) return true;
      return ordemPerigo.indexOf(nivel) >= ordemPerigo.indexOf(n.perigo_min);
    });
    if (npcsCandidatos.length) {
      dispararEventoNPC(npcsCandidatos[randInt(0, npcsCandidatos.length - 1)]);
      return;
    }
  }

  // Filtrar eventos elegíveis para o perigo atual
  const ordemPerigo = ['baixo', 'medio', 'alto'];
  const candidatos  = EVENTOS_ESCOLHA.filter(ev => {
    if (!ev.perigo_min) return true;
    return ordemPerigo.indexOf(nivel) >= ordemPerigo.indexOf(ev.perigo_min);
  });

  if (!candidatos.length) {
    // Sem eventos disponíveis — retomar exploração normalmente
    exp.eventoDisparado = true;
    estado.exploracao.timer = setInterval(tickExploracao, 1000);
    return;
  }

  const ev = candidatos[randInt(0, candidatos.length - 1)];
  exp.eventoDisparado = true;
  exp.eventoAtivo     = ev.id;

  // Popular modal
  document.getElementById('ev-titulo').textContent = ev.titulo;
  document.getElementById('ev-desc').textContent   = ev.desc;

  const container = document.getElementById('ev-escolhas');
  container.innerHTML = '';

  ev.escolhas.forEach((escolha, idx) => {
    const temItem = escolha.requer
      ? estado.inventario.some(i => i.id === escolha.requer.item && (i.qtd || 1) >= escolha.requer.qtd)
      : true;

    const btn = document.createElement('button');
    btn.className = `ev-escolha-btn risco-${escolha.risco}${!temItem ? ' desabilitado' : ''}`;
    btn.disabled  = !temItem;
    btn.innerHTML = `
      <span class="ev-escolha-ico">${escolha.icone}</span>
      <span class="ev-escolha-txt">${escolha.texto}</span>
      <span class="ev-risco-badge risco-${escolha.risco}">${escolha.risco.toUpperCase()}</span>
      ${escolha.requer && !temItem
        ? `<span class="ev-requer">Requer: ${ITENS[escolha.requer.item]?.nome || escolha.requer.item}</span>`
        : ''}
    `;
    if (temItem) btn.addEventListener('click', () => resolverEscolha(ev.id, idx));
    container.appendChild(btn);
  });

  // Esconder resultado anterior, mostrar escolhas
  document.getElementById('ev-resultado').classList.add('oculto');
  document.getElementById('ev-fechar-wrap').classList.add('oculto');
  document.getElementById('ev-escolhas').classList.remove('oculto');
  document.getElementById('modal-evento').classList.remove('oculto');
}

function resolverEscolha(eventoId, escolhaIdx) {
  const ev      = EVENTOS_ESCOLHA.find(e => e.id === eventoId);
  const escolha = ev?.escolhas[escolhaIdx];
  if (!ev || !escolha) return;

  // Sortear resultado por chance acumulada
  const roll  = Math.random() * 100;
  let acum    = 0;
  let result  = escolha.resultados[escolha.resultados.length - 1];
  for (const r of escolha.resultados) {
    acum += r.chance;
    if (roll < acum) { result = r; break; }
  }

  // ── Aplicar efeitos ──
  const s = estado.stats;

  // Consumir itens requeridos
  if (result.consumir) {
    for (const c of result.consumir) removerItem(c.id, c.qtd);
  }

  // Efeitos em stats
  if (result.efeitos) {
    for (const [stat, val] of Object.entries(result.efeitos)) {
      s[stat] = clamp((s[stat] || 0) + val, 0, stat === 'vida' ? s.vidaMax : 100);
    }
  }

  // Loot
  if (result.loot) {
    for (const l of result.loot) {
      const itemDef = ITENS[l.id];
      if (itemDef) {
        if (!adicionarItem(itemDef, l.qtd))
          log(`  → Mochila cheia! Deixou ${itemDef.nome} para trás.`, 'log-alerta');
      }
    }
  }

  // Condição
  if (result.condicao) {
    if (result.condicao === 'intoxicado') estado.condicoes.intoxicado = 90;
    else estado.condicoes[result.condicao] = true;
  }

  // ── Exibir resultado ──
  const resEl = document.getElementById('ev-resultado');
  resEl.textContent = result.msg;
  resEl.classList.remove('oculto');
  document.getElementById('ev-escolhas').classList.add('oculto');

  log(`⚡ ${ev.titulo}: ${result.msg}`, 'log-alerta');

  // Mostrar botão de fechar para o jogador ler o resultado com calma
  const fecharWrap = document.getElementById('ev-fechar-wrap');
  const fecharBtn  = document.getElementById('ev-btn-fechar');
  fecharWrap.classList.remove('oculto');
  fecharBtn.onclick = () => {
    fecharWrap.classList.add('oculto');
    document.getElementById('modal-evento').classList.add('oculto');
    if (estado.stats.vida <= 0) { gameOver(); return; }
    estado.exploracao.eventoAtivo = null;
    estado.exploracao.timer = setInterval(tickExploracao, 1000);
  };
}

// ── NPC Andarilho ────────────────────────────────────────────

function dispararEventoNPC(npc) {
  const exp = estado.exploracao;
  exp.eventoDisparado = true;
  exp.eventoAtivo     = npc.id;

  // Sortear uma troca aleatória do pool do NPC
  const troca = npc.trocas[randInt(0, npc.trocas.length - 1)];
  exp._npcTrocaAtiva = { npcId: npc.id, troca };

  // Verificar se o jogador tem o que o NPC quer
  const podeTrocar = troca.querem.every(req => temItem(req.id, req.qtd));

  // Montar descrição da troca
  function listarItens(lista) {
    return lista.map(r => `${ITENS[r.id]?.icone || ''} ${ITENS[r.id]?.nome || r.id} ×${r.qtd}`).join('  +  ');
  }

  // Popular modal
  const label = document.querySelector('.ev-label');
  if (label) label.textContent = '👤 NPC';
  document.getElementById('ev-titulo').textContent = `${npc.icone} ${npc.nome}`;
  document.getElementById('ev-desc').textContent   = npc.desc;

  const container = document.getElementById('ev-escolhas');
  container.innerHTML = '';

  // Card visual da troca
  const trocaDiv = document.createElement('div');
  trocaDiv.className = 'npc-troca-card';
  trocaDiv.innerHTML = `
    <div class="npc-troca-lado">
      <span class="npc-troca-label">Ele oferece</span>
      <span class="npc-troca-itens">${listarItens(troca.oferecem)}</span>
    </div>
    <div class="npc-troca-seta">⇄</div>
    <div class="npc-troca-lado">
      <span class="npc-troca-label">Ele quer</span>
      <span class="npc-troca-itens npc-troca-quer ${!podeTrocar ? 'sem-recursos' : ''}">${listarItens(troca.querem)}</span>
    </div>
  `;
  container.appendChild(trocaDiv);

  // Botão aceitar
  const btnAceitar = document.createElement('button');
  btnAceitar.className = `ev-escolha-btn risco-baixo npc-btn-aceitar${!podeTrocar ? ' desabilitado' : ''}`;
  btnAceitar.disabled  = !podeTrocar;
  btnAceitar.innerHTML = `
    <span class="ev-escolha-ico">🤝</span>
    <span class="ev-escolha-txt">Aceitar troca</span>
    ${!podeTrocar ? `<span class="ev-requer">Você não tem o suficiente</span>` : ''}
  `;
  if (podeTrocar) btnAceitar.addEventListener('click', () => resolverTrocaNPC(true));
  container.appendChild(btnAceitar);

  // Botão recusar
  const btnRecusar = document.createElement('button');
  btnRecusar.className = 'ev-escolha-btn risco-baixo';
  btnRecusar.innerHTML = `
    <span class="ev-escolha-ico">🚶</span>
    <span class="ev-escolha-txt">Recusar e seguir</span>
  `;
  btnRecusar.addEventListener('click', () => resolverTrocaNPC(false));
  container.appendChild(btnRecusar);

  // Resetar label ao fechar
  document.getElementById('ev-resultado').classList.add('oculto');
  document.getElementById('ev-fechar-wrap').classList.add('oculto');
  container.classList.remove('oculto');
  document.getElementById('modal-evento').classList.remove('oculto');
}

function resolverTrocaNPC(aceitar) {
  const exp   = estado.exploracao;
  const dados = exp._npcTrocaAtiva;
  if (!dados) return;

  const npc   = EVENTOS_NPC.find(n => n.id === dados.npcId);
  const troca = dados.troca;

  let msgResult = '';

  if (aceitar) {
    // Consumir itens do jogador
    for (const req of troca.querem) removerItem(req.id, req.qtd);
    // Dar itens ao jogador
    for (const oferta of troca.oferecem) {
      const itemDef = ITENS[oferta.id];
      if (itemDef) {
        if (!adicionarItem(itemDef, oferta.qtd))
          log(`  → Mochila cheia! Deixou ${itemDef.nome} para trás.`, 'log-alerta');
      }
    }
    msgResult = 'Troca feita. Ele acena com a cabeça e segue o caminho sem dizer mais nada.';
    log(`🤝 ${npc?.nome || 'NPC'}: troca aceita.`, 'log-sucesso');
    mostrarToast('🤝 Troca realizada!');
  } else {
    msgResult = 'Você agradece e passa reto. Ele encolhe os ombros e desaparece entre os escombros.';
    log(`🚶 ${npc?.nome || 'NPC'}: você recusou a troca.`, 'log-sistema');
  }

  // Restaurar label do modal
  const label = document.querySelector('.ev-label');
  if (label) label.textContent = '⚠ EVENTO';

  const resEl = document.getElementById('ev-resultado');
  resEl.textContent = msgResult;
  resEl.classList.remove('oculto');
  document.getElementById('ev-escolhas').classList.add('oculto');

  const fecharWrap = document.getElementById('ev-fechar-wrap');
  const fecharBtn  = document.getElementById('ev-btn-fechar');
  fecharWrap.classList.remove('oculto');
  fecharBtn.onclick = () => {
    fecharWrap.classList.add('oculto');
    document.getElementById('modal-evento').classList.add('oculto');
    exp._npcTrocaAtiva = null;
    exp.eventoAtivo    = null;
    estado.exploracao.timer = setInterval(tickExploracao, 1000);
  };
}

// ============================================================
// GAME OVER
// ============================================================

function gameOver() {
  clearInterval(estado.loop);
  clearInterval(estado.exploracao.timer);
  localStorage.removeItem('atéamanha_save');

  // ── Detectar causa da morte ──
  const s = estado.stats;
  const c = estado.condicoes;
  let causa = 'desconhecida';
  let causaDesc = 'As circunstâncias foram fatais.';

  if (c.sangramento) {
    causa = 'sangramento';
    causaDesc = 'Você sangrou até não restar mais nada.';
  } else if (c.intoxicado > 0) {
    causa = 'intoxicação';
    causaDesc = 'As toxinas consumiram seu organismo por dentro.';
  } else if (c.contundido) {
    causa = 'contusão';
    causaDesc = 'Incapacitado pela lesão, você não conseguiu sobreviver.';
  } else if (s.sede >= 80) {
    causa = 'desidratação';
    causaDesc = 'Seu corpo cedeu sem água. A sede foi mais forte.';
  } else if (s.fome >= 80) {
    causa = 'inanição';
    causaDesc = 'A fome lenta e silenciosa te derrubou no fim.';
  } else if (s.vicio > 70) {
    causa = 'abstinência';
    causaDesc = 'O vício destruiu o que a ruína não conseguiu.';
  } else {
    causa = 'trauma';
    causaDesc = 'O mundo acabou com você antes que você acabasse com ele.';
  }

  // ── Estatísticas da partida ──
  const diasSobreviveu = estado.dia;
  const exploracoes    = estado.placar?.exploracoes || 0;
  const crafts         = estado.placar?.crafts || 0;
  const construcoes    = estado.placar?.construcoes || 0;

  // ── Nota de sobrevivência (flavour) ──
  const notas = [
    'A névoa voltou a cobrir as ruas.',
    'O vento não parou de soprar.',
    'Seu nome ficará em algum lugar no escombro.',
    'O silêncio engoliu tudo.',
    'Alguém vai encontrar o que você deixou para trás.',
    'Mais um nome riscado da lista de sobreviventes.',
  ];
  const nota = notas[Math.floor(Math.random() * notas.length)];

  // ── Popular e exibir tela ──
  document.getElementById('go-nome').textContent        = estado.personagem.nome;
  document.getElementById('go-causa').textContent       = causa.toUpperCase();
  document.getElementById('go-causa-desc').textContent  = causaDesc;
  document.getElementById('go-dias').textContent        = diasSobreviveu;
  document.getElementById('go-exploracoes').textContent = exploracoes;
  document.getElementById('go-crafts').textContent      = crafts;
  document.getElementById('go-construcoes').textContent = construcoes;
  document.getElementById('go-nota').textContent        = nota;

  // Avatar
  const n = String((estado.personagem.avatar || 0) + 1).padStart(2, '0');
  document.getElementById('go-avatar').innerHTML =
    `<img src="img/chars/char${n}.png" alt="Avatar" class="go-avatar-img" />`;

  mostrarTela('tela-gameover');

  document.getElementById('btn-tentar-novamente').onclick = async () => {
    // Limpar save local e na nuvem — personagem morreu, começa do zero
    localStorage.removeItem('atéamanha_save');
    if (_sbUser) {
      const sb = getSB();
      if (sb) await sb.from('saves').delete().eq('user_id', _sbUser.id);
    }
    clearInterval(estado.loop);
    estado.criado = false;
    mostrarTela('tela-criacao');
  };
}

// ============================================================
// CRIAÇÃO DE PERSONAGEM
// ============================================================

function inicializarCriacao() {
  const TOTAL_AVATARES = 12;
  let avatarAtual = 0;

  const imgEl = document.getElementById('carousel-img');
  const numEl = document.getElementById('carousel-num');
  const rgEl  = document.getElementById('doc-rg-num');

  // Gerar número de registro aleatório para flavor
  const rg1 = String(Math.floor(Math.random() * 9000) + 1000);
  const rg2 = String(Math.floor(Math.random() * 9000) + 1000);
  if (rgEl) rgEl.textContent = `ACE-2031-${rg1}${rg2}`;

  // Exibir foto inicial sem flash
  setTimeout(() => imgEl?.classList.remove('trocando'), 50);

  function irParaAvatar(idx) {
    if (!imgEl) return;
    imgEl.classList.add('trocando');
    setTimeout(() => {
      const n = String(idx + 1).padStart(2, '0');
      imgEl.src = `img/chars/char${n}.png`;
      imgEl.alt = `Avatar ${idx + 1}`;
      if (numEl) numEl.textContent = `${String(idx + 1).padStart(2,'0')} / ${TOTAL_AVATARES}`;
      imgEl.classList.remove('trocando');
    }, 150);
  }

  document.getElementById('carousel-prev')?.addEventListener('click', () => {
    avatarAtual = (avatarAtual - 1 + TOTAL_AVATARES) % TOTAL_AVATARES;
    irParaAvatar(avatarAtual);
  });
  document.getElementById('carousel-next')?.addEventListener('click', () => {
    avatarAtual = (avatarAtual + 1) % TOTAL_AVATARES;
    irParaAvatar(avatarAtual);
  });

  // ── Seleção de traço via chips inline no documento ──
  const TRACOS_DESC = {
    resistente: 'Vida máxima +20%. Perde vida mais devagar em situações críticas.',
    ansioso:    'Estresse acumula mais rápido, mas +15% chance de loot raro.',
    economico:  'Fome e sede aumentam 25% mais devagar. Sabe racionamento.',
    medico:     'Itens de cura são 50% mais eficazes. Começa com kit de primeiros socorros.',
  };
  const descEl = document.getElementById('doc-traco-desc');

  document.querySelectorAll('.traco-chip').forEach(chip =>
    chip.addEventListener('click', () => {
      document.querySelectorAll('.traco-chip').forEach(c => c.classList.remove('selecionado'));
      chip.classList.add('selecionado');
      if (descEl) descEl.textContent = TRACOS_DESC[chip.dataset.traco] ?? '';
    })
  );

  // ── Botão começar ──
  document.getElementById('btn-comecar')?.addEventListener('click', async () => {
    const nome = document.getElementById('input-nome').value.trim();
    if (!nome) {
      mostrarToast('Preencha o nome no documento.');
      document.getElementById('input-nome').focus();
      return;
    }
    const chipSel = document.querySelector('.traco-chip.selecionado');
    await iniciarJogo(nome, avatarAtual, chipSel?.dataset.traco ?? 'resistente');
  });
}

// ============================================================
// INICIAR JOGO
// ============================================================

async function iniciarJogo(nome, avatarIdx, traco) {
  const td     = TRACOS[traco];
  const vidaMax = td.efeitos.vidaMax || 100;

  estado.personagem         = { nome, avatar: avatarIdx, traco };
  estado.stats              = { vida: vidaMax, vidaMax, fome: 0, sede: 0, estresse: 0, vicio: 0 };
  estado.inventario         = [];
  estado.receitasAprendidas = [];
  estado.temBancada         = false;
  estado.base               = [];
  estado.capInventario      = 10;
  estado.tatica             = 'furtivo';
  estado.deposito           = { nivel: 0, itens: [] };
  estado.cisterna           = { aguaAcumulada: 0 };
  estado.filtroInstalado    = { diasRestantes: 0 };
  estado.cultivo            = { slots: [null, null, null] };
  estado.seguranca          = { armadilhasInstaladas: 0 };
  estado.locaisDesbloqueados = [];
  estado.exploracoesZona    = {};
  estado.respawnTicks       = {};
  estado.ultimoSaque        = null;
  estado.mercado            = { itens: [], diaGerado: 0 };
  estado.equipamento        = { cabeca: null, peito: null, maos: null, pernas: null, pes: null, arma: null, acessorio: null };
  estado.dia                = 1;
  estado.segundos           = 0;
  estado.condicoes          = { intoxicado: 0, contundido: false, sangramento: false };
  estado.placar             = { exploracoes: 0, crafts: 0, construcoes: 0 };
  estado.criado             = true;

  adicionarItem(ITENS.comida,    2);
  adicionarItem(ITENS.agua_suja, 1);
  adicionarItem(ITENS.sucata,    3);
  adicionarItem(ITENS.pano,      1);
  if (traco === 'medico') adicionarItem(ITENS.kit, 1);

  // Avatar: usa imagem do char
  const avatarEl = document.getElementById('hdr-avatar');
  const n = String(avatarIdx + 1).padStart(2, '0');
  avatarEl.innerHTML = `<img src="img/chars/char${n}.png" alt="Avatar" class="pc-avatar-img" />`;
  document.getElementById('hdr-nome').textContent  = nome;
  document.getElementById('hdr-traco').textContent = `${td.icone} ${td.nome}`;
  document.getElementById('hdr-dia').textContent   = 'Dia 1';
  atualizarRelogio();

  salvarJogo();
  // Garantir que o save inicial chegue à nuvem antes de o jogador navegar
  if (_sbUser) await sbSalvar(montarDadosSave());

  // Mostrar intro depois da criação, depois iniciar o jogo
  mostrarTela('tela-intro');
  mostrarIntro(() => {
    mostrarTela('tela-jogo');
    audio.iniciar();

    log(`${nome} acorda em um campo aberto. Sem proteção. Sem abrigo.`, 'log-alerta');
    log(`Traço: ${td.icone} ${td.nome} — ${td.desc}`, 'log-sistema');
    log('⛺ Prioridade: construa o Abrigo (5🔩 · 5🪵 · 5🧻) antes de qualquer outra coisa.', 'log-info');
    log('Dica: na mochila, clique num item e depois em outro para combinar.', 'log-info');

    atualizarUI();
    renderizarInventario();
    renderizarCrafting();
    renderizarBase();
    renderizarLocais();
    renderizarEquipamento();
    renderizarEquipResumo();
    verificarMercado();
    renderizarMercado();
    iniciarLoop();
  });
}

// ============================================================
// LOOP
// ============================================================

function iniciarLoop() {
  if (estado.loop) clearInterval(estado.loop);
  estado.loop = setInterval(atualizarStatus, TICK_MS);
}

// ============================================================
// SALVAMENTO
// ============================================================

function montarDadosSave() {
  return {
    personagem: estado.personagem, stats: estado.stats, inventario: estado.inventario,
    receitasAprendidas: estado.receitasAprendidas, temBancada: estado.temBancada,
    base: estado.base, tatica: estado.tatica, deposito: estado.deposito,
    cisterna: estado.cisterna, filtroInstalado: estado.filtroInstalado,
    cultivo: estado.cultivo, seguranca: estado.seguranca,
    locaisDesbloqueados: estado.locaisDesbloqueados, capInventario: estado.capInventario,
    exploracoesZona: estado.exploracoesZona, respawnTicks: estado.respawnTicks,
    ultimoSaque: estado.ultimoSaque, mercado: estado.mercado,
    equipamento: estado.equipamento,
    dia: estado.dia, segundos: estado.segundos, condicoes: estado.condicoes,
    placar: estado.placar, ultimoSave: Date.now()
  };
}

function salvarJogo() {
  if (!estado.criado) return;
  const dados = montarDadosSave();
  localStorage.setItem('atéamanha_save', JSON.stringify(dados));
  if (_sbUser) sbSalvar(dados); // cloud save assíncrono, sem bloquear
}

function carregarJogo() {
  const raw = localStorage.getItem('atéamanha_save');
  if (!raw) return false;
  try {
    aplicarDadosSave(JSON.parse(raw));
    return true;
  } catch (e) { console.warn(e); return false; }
}

function aplicarProgressoOffline(segundos) {
  const s   = estado.stats;
  const m   = getMultiTraco();
  const eff = Math.min(segundos, 3600);
  s.fome = clamp(s.fome + eff * 0.15 * m.consumoMulti, 0, 100);
  s.sede = clamp(s.sede + eff * 0.22 * m.consumoMulti, 0, 100);
  // Progresso offline não reduz vida — personagem sempre está vivo ao voltar
  const antesSegundos = estado.segundos;
  estado.segundos += eff;
  estado.dia += Math.floor(estado.segundos / CICLO_DURACAO) - Math.floor(antesSegundos / CICLO_DURACAO);
  log(`Você esteve ausente por ${Math.floor(eff / 60)} minutos. O mundo não parou.`, 'log-alerta');
}

// ============================================================
// INICIALIZAR UI
// ============================================================

// ============================================================
// SISTEMA DE ÁUDIO
// ============================================================

const audio = {
  dia:   null,
  noite: null,
  mudo:  localStorage.getItem('atéamanha_mudo') === 'true',
  faseAtual: null,
  iniciado: false,

  init() {
    this.dia   = document.getElementById('audio-dia');
    this.noite = document.getElementById('audio-noite');
    if (!this.dia || !this.noite) return;
    this.dia.volume   = 0;
    this.noite.volume = 0;
    this._atualizarBotao();
  },

  // Chamado na primeira interação do usuário
  iniciar() {
    if (this.iniciado || !this.dia) return;
    this.iniciado = true;
    const fase = this.faseAtual || 'dia';
    const el   = fase === 'noite' ? this.noite : this.dia;
    el.volume  = 0;
    const p = el.play();
    if (p !== undefined) {
      p.then(() => {
        // Autoplay permitido — fade in
        this._fade(el, 0, this.mudo ? 0 : 0.3, 2000);
      }).catch(() => {
        // Autoplay bloqueado — aguardar próximo clique do usuário
        this.iniciado = false;
        document.addEventListener('click', () => this.iniciar(), { once: true });
      });
    }
  },

  tocarFase(fase) {
    this.faseAtual = fase;
    if (!this.iniciado || !this.dia) return;

    const entrando = fase === 'dia' ? this.dia   : this.noite;
    const saindo   = fase === 'dia' ? this.noite : this.dia;

    // Iniciar faixa que está entrando
    if (entrando.paused) {
      entrando.volume = 0;
      entrando.currentTime = 0;
      entrando.play().catch(() => {});
    }

    // Crossfade
    this._fade(saindo,   saindo.volume,   0,                    3000);
    this._fade(entrando, entrando.volume, this.mudo ? 0 : 0.3,  3000);
  },

  alternarMudo() {
    this.mudo = !this.mudo;
    localStorage.setItem('atéamanha_mudo', this.mudo);
    const vol = this.mudo ? 0 : 0.3;
    const ativo = this.faseAtual === 'noite' ? this.noite : this.dia;
    if (ativo) this._fade(ativo, ativo.volume, vol, 800);
    this._atualizarBotao();
  },

  _atualizarBotao() {
    const btn = document.getElementById('btn-som');
    if (btn) btn.textContent = this.mudo ? '🔇' : '🔊';
  },

  _fade(el, de, ate, ms) {
    if (!el) return;
    clearInterval(el._fadeTimer);
    el.volume = Math.max(0, Math.min(1, de));
    const passos = 30;
    const intervalo = ms / passos;
    const delta = (ate - de) / passos;
    let passo = 0;
    el._fadeTimer = setInterval(() => {
      passo++;
      el.volume = Math.max(0, Math.min(1, de + delta * passo));
      if (passo >= passos) {
        clearInterval(el._fadeTimer);
        if (ate === 0 && !el.paused) el.pause();
      }
    }, intervalo);
  }
};

function inicializarUI() {
  // ── Abas ──
  document.querySelectorAll('.aba-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const aba = btn.dataset.aba;
      if (aba === 'base' && estado.exploracao?.ativa) {
        mostrarToast('⚠️ Volte da exploração antes de acessar a Base.');
        return;
      }
      document.querySelectorAll('.aba-btn').forEach(b => b.classList.remove('ativa'));
      document.querySelectorAll('.aba-conteudo').forEach(c => c.classList.remove('ativa'));
      btn.classList.add('ativa');
      document.getElementById(`aba-${aba}`).classList.add('ativa');
      document.getElementById(`aba-${aba}`)?.scrollTo({ top: 0, behavior: 'smooth' });
      if (aba === 'bazar') { renderizarBazar(); iniciarAutoRefreshBazar(); }
      else pararAutoRefreshBazar();
    });
  });

  // ── Táticas (ícones abaixo do avatar) ──
  document.querySelectorAll('.tatica-icon').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.tatica-icon').forEach(t => t.classList.remove('ativa'));
      el.classList.add('ativa');
      estado.tatica = el.dataset.tatica;
      log(`Tática alterada para: ${el.title.split(' — ')[0]}`, 'log-sistema');
    });
  });

  // ── Mapa da base: clique nos slots ──
  document.getElementById('base-mapa')?.addEventListener('click', e => {
    const slot = e.target.closest('.base-slot[data-id]');
    if (!slot) return;

    if (slot.classList.contains('construida')) {
      // Slot construído → abre painel da estrutura
      const painel = slot.dataset.painel;
      if (painel) abrirPainelBase(painel);
      return;
    }
    if (slot.classList.contains('bloqueada')) return;
    abrirTooltipBase(slot);
  });

  // Slot do depósito no mapa
  document.getElementById('mapa-slot-deposito')?.addEventListener('click', () => {
    if (!baseTemEstrutura('abrigo') && estado.deposito.nivel === 0) return;
    abrirPainelBase('deposito');
  });

  // Fechar tooltip da base
  document.getElementById('btt-btn-fechar')?.addEventListener('click', fecharTooltipBase);

  // Fechar painel de estrutura

  // ── Botões de explorar dos cards de Locais ──
  // ── Botões de explorar — event delegation no container de locais ──
  // Lê dados do .local-card pai, não do botão (que pode não ter data-* após desbloqueio dinâmico)
  document.getElementById('aba-locais')?.addEventListener('click', e => {
    const btn = e.target.closest('.btn-explorar-local');
    if (!btn || btn.disabled) return;
    if (estado.exploracao.ativa) { mostrarToast('⚠️ Já está explorando!'); return; }

    // Dados no card pai
    const card = btn.closest('[data-zona]') || btn.closest('.local-card');
    const zona    = card?.dataset.zona    || btn.dataset.zona;
    const perigo  = card?.dataset.perigo  || btn.dataset.perigo  || 'baixo';
    const duracao = parseInt(card?.dataset.duracao || btn.dataset.duracao || '10');

    if (!zona) { mostrarToast('⚠️ Local inválido.'); return; }

    zonaAtual = { zona, perigo, duracao };
    iniciarExploracao();
  });

  // ── Modal de item ──
  document.getElementById('modal-btn-fechar').addEventListener('click', fecharModal);

  document.getElementById('modal-btn-usar').addEventListener('click', () => {
    if (itemModalAtual) usarItem(itemModalAtual.id);
  });

  document.getElementById('modal-btn-guardar').addEventListener('click', () => {
    if (itemModalAtual) {
      const qtd = parseInt(document.getElementById('modal-qtd-guardar')?.value) || 1;
      guardarNoDeposito(itemModalAtual.id, qtd);
    }
  });

  document.getElementById('modal-btn-excluir').addEventListener('click', () => {
    if (itemModalAtual) descartarItem(itemModalAtual.id);
  });

  document.getElementById('modal-item').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-item')) fecharModal();
  });

  // ── Salvar / Reset ──
  document.getElementById('btn-som')?.addEventListener('click', () => audio.alternarMudo());

  document.getElementById('btn-salvar').addEventListener('click', () => {
    salvarJogo();
    mostrarToast('💾 Jogo salvo.');
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('Apagar progresso e reiniciar?')) {
      clearInterval(estado.loop);
      clearInterval(estado.exploracao.timer);
      localStorage.removeItem('atéamanha_save');
      location.reload();
    }
  });

  // ── Cancelar seleção de craft ao clicar fora da mochila ──
  document.addEventListener('click', e => {
    if (craftSelecionado && !e.target.closest('#lista-inventario')) {
      craftSelecionado.el.classList.remove('item-craft-selecionado');
      craftSelecionado = null;
    }
  });
}

// ============================================================
// BOOTSTRAP
// ============================================================

// ============================================================
// BAZAR — UI
// ============================================================

async function renderizarBazar() {
  const sb = getSB();
  const statusEl = document.getElementById('bazar-status');
  const saldoEl  = document.getElementById('bazar-saldo');
  const pilhas   = estado.inventario.find(i => i.id === 'pilha');
  if (saldoEl) saldoEl.textContent = `${pilhas?.qtd || 0} 🔋`;

  const anunciarBloco = document.getElementById('bazar-anunciar-bloco');
  const outrosBloco   = document.getElementById('bazar-meus-anuncios-bloco');
  const listagemEl    = document.getElementById('bazar-listagem');

  if (!sb || !_sbUser) {
    if (statusEl)     statusEl.textContent = '⚫ offline';
    if (anunciarBloco) anunciarBloco.style.display = 'none';
    if (outrosBloco)   outrosBloco.style.display   = 'none';
    if (listagemEl)    listagemEl.innerHTML =
      '<p class="bazar-vazio">Faça login para acessar a Barraca do Sobrevivente.</p>';
    return;
  }

  if (anunciarBloco)  anunciarBloco.style.display = '';
  if (outrosBloco)    outrosBloco.style.display   = '';
  if (statusEl) statusEl.textContent = '🟢 online';

  // Popular select com itens da mochila + depósito
  const selEl = document.getElementById('bazar-sel-item');
  if (selEl) {
    const todosItens = [
      ...estado.inventario,
      ...estado.deposito.itens
    ].reduce((acc, i) => {
      const ex = acc.find(x => x.id === i.id);
      if (ex) ex.qtd += (i.qtd || 1);
      else acc.push({ ...i, qtd: i.qtd || 1 });
      return acc;
    }, []);
    selEl.innerHTML = '<option value="">— escolha um item para vender —</option>' +
      todosItens.map(i =>
        `<option value="${i.id}" data-icone="${i.icone || '📦'}" data-nome="${i.nome}">${i.icone} ${i.nome} ×${i.qtd}</option>`
      ).join('');
  }

  const anuncios = await sbCarregarBazar();

  // ── Sua barraca ──
  const meusEl     = document.getElementById('bazar-meus-anuncios');
  const limiteLabel = document.getElementById('bazar-limite-label');
  const meus       = anuncios.filter(a => a.vendedor_id === _sbUser.id);
  if (limiteLabel) limiteLabel.textContent = `(${meus.length}/5 slots)`;
  if (meusEl) {
    if (!meus.length) {
      meusEl.innerHTML = '<p class="bazar-vazio">Sua barraca está vazia.</p>';
    } else {
      meusEl.innerHTML = meus.map(a => `
        <div class="bazar-item meu-anuncio">
          <span class="bazar-item-ico">${a.item_icone}</span>
          <span class="bazar-item-nome">${a.item_nome} ×${a.qtd}</span>
          <span class="bazar-item-preco">${a.preco} 🔋</span>
          <button class="btn-perigo bazar-btn-sm btn-retirar" data-id="${a.id}"
                  data-itemid="${a.item_id}" data-qtd="${a.qtd}">Retirar</button>
        </div>
      `).join('');
      meusEl.querySelectorAll('.btn-retirar').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const ok = await sbRetirarAnuncio(btn.dataset.id);
          if (ok) {
            // Devolver item ao inventário
            const itemDef = ITENS[btn.dataset.itemid];
            if (itemDef) adicionarItem(itemDef, parseInt(btn.dataset.qtd));
            salvarJogo();
          }
          renderizarBazar();
        });
      });
    }
  }

  // ── Barracas de outros sobreviventes (agrupadas por vendedor) ──
  const outros = anuncios.filter(a => a.vendedor_id !== _sbUser.id);
  if (listagemEl) {
    if (!outros.length) {
      listagemEl.innerHTML = '<p class="bazar-vazio">Nenhuma barraca aberta no momento.</p>';
    } else {
      // Agrupar por vendedor
      const porVendedor = outros.reduce((acc, a) => {
        if (!acc[a.vendedor_id]) acc[a.vendedor_id] = { nome: a.vendedor_nome, itens: [] };
        acc[a.vendedor_id].itens.push(a);
        return acc;
      }, {});

      listagemEl.innerHTML = Object.values(porVendedor).map(v => `
        <div class="barraca-vendedor">
          <div class="barraca-vendedor-header">
            <span class="barraca-vendedor-ico">🏕️</span>
            <span class="barraca-vendedor-nome">${v.nome}</span>
          </div>
          <div class="barraca-vendedor-itens">
            ${v.itens.map(a => `
              <div class="bazar-item" data-id="${a.id}">
                <span class="bazar-item-ico">${a.item_icone}</span>
                <div class="bazar-item-info">
                  <span class="bazar-item-nome">${a.item_nome} ×${a.qtd}</span>
                </div>
                <span class="bazar-item-preco">${a.preco} 🔋</span>
                <button class="btn-primario bazar-btn-sm btn-comprar-bazar"
                        data-id="${a.id}" data-preco="${a.preco}"
                        data-nome="${a.item_nome}" data-icone="${a.item_icone}"
                        data-itemid="${a.item_id}" data-qtd="${a.qtd}">
                  Comprar
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('');

      listagemEl.querySelectorAll('.btn-comprar-bazar').forEach(btn => {
        btn.addEventListener('click', async () => {
          const preco = parseInt(btn.dataset.preco);
          const pilhasAtuais = estado.inventario.find(i => i.id === 'pilha');
          if (!pilhasAtuais || (pilhasAtuais.qtd || 0) < preco) {
            mostrarToast(`🔋 Precisa de ${preco} Pilhas.`);
            return;
          }
          btn.disabled = true;
          btn.textContent = '...';
          const res = await sbComprarDoBazar(btn.dataset.id, preco);
          if (!res.ok) {
            mostrarToast(`❌ ${res.erro}`);
            btn.disabled = false;
            btn.textContent = 'Comprar';
            return;
          }
          removerItem('pilha', preco);
          const itemDef = ITENS[res.item_id];
          if (itemDef) adicionarItem(itemDef, res.qtd);
          log(`🛒 Comprou ${res.item_icone} ${res.item_nome} ×${res.qtd} por ${preco} 🔋 (Barracas)`, 'log-sucesso');
          mostrarToast(`🛒 ${res.item_icone} ${res.item_nome} comprado!`);
          salvarJogo();
          renderizarBazar();
        });
      });
    }
  }
}

let _bazarTimer     = null;
let _bazarCountdown = 10;

function iniciarAutoRefreshBazar() {
  pararAutoRefreshBazar();
  _bazarCountdown = 10;
  _bazarTimer = setInterval(() => {
    _bazarCountdown--;
    const el = document.getElementById('bazar-countdown');
    if (el) el.textContent = _bazarCountdown;
    if (_bazarCountdown <= 0) {
      _bazarCountdown = 10;
      renderizarBazar();
    }
  }, 1000);
}

function pararAutoRefreshBazar() {
  if (_bazarTimer) { clearInterval(_bazarTimer); _bazarTimer = null; }
}

function inicializarBazar() {
  document.getElementById('bazar-btn-anunciar')?.addEventListener('click', async () => {
    const sel    = document.getElementById('bazar-sel-item');
    const itemId = sel?.value;
    if (!itemId) { mostrarToast('Escolha um item.'); return; }

    const qtdInp = document.getElementById('bazar-inp-qtd');
    const qtd    = Math.min(99, Math.max(1, parseInt(qtdInp?.value) || 1));
    if (qtdInp) qtdInp.value = qtd;

    const preco  = Math.max(1, parseInt(document.getElementById('bazar-inp-preco')?.value) || 1);
    const opt    = sel.options[sel.selectedIndex];
    const nome   = opt?.dataset.nome  || itemId;
    const icone  = opt?.dataset.icone || '📦';

    // Verificar limite de 5 tipos na barraca
    const anunciosAtuais = await sbCarregarBazar();
    const meus = anunciosAtuais.filter(a => a.vendedor_id === _sbUser?.id);
    if (meus.length >= 5) {
      mostrarToast('🏕️ Barraca cheia. Máximo 5 tipos de item.');
      return;
    }

    if (!temItem(itemId, qtd)) { mostrarToast('Você não tem esse item em quantidade suficiente.'); return; }

    removerItem(itemId, qtd);
    const ok = await sbAnunciarBazar(itemId, nome, icone, qtd, preco);
    if (!ok) {
      adicionarItem(ITENS[itemId], qtd);
      mostrarToast('❌ Erro ao colocar à venda. Tente novamente.');
      return;
    }
    log(`🏕️ Colocou ${icone} ${nome} ×${qtd} por ${preco} 🔋 na Barraca.`, 'log-sucesso');
    mostrarToast(`🏕️ ${nome} à venda!`);
    salvarJogo();
    renderizarBazar();
  });
}

// ============================================================
// TELA DE INTRO
// ============================================================

const INTRO_PARAGRAFOS = [
  { texto: '2031.', classe: 'intro-ano' },
  { texto: 'O colapso não foi um evento. Foi uma soma.', classe: 'intro-destaque' },
  { texto: 'Crise energética. Colapso alimentar. Conflitos em cascata. Pandemias sem resposta. Em menos de dois anos, a civilização que levou milênios para ser construída simplesmente parou de funcionar.', classe: '' },
  { texto: 'Seus avós sobreviveram. Construíram abrigos com as próprias mãos. Enterraram os mortos. Aprenderam a filtrar água de telhados, a guardar sementes, a desconfiar de estranhos — e a proteger os seus a qualquer custo.', classe: '' },
  { texto: 'Você nunca conheceu o mundo deles.', classe: 'intro-destaque' },
  { texto: 'Cresceu entre escombros, histórias e silêncio. As cidades que aparecem nos mapas antigos são cemitérios de concreto. As estradas levam a lugar nenhum. Os livros que sobraram descrevem um planeta que não existe mais.', classe: '' },
  { texto: 'Mas você está vivo.', classe: 'intro-destaque' },
  { texto: 'E aqui, no fim do que sobrou, viver ainda significa alguma coisa.', classe: '' },
];

function mostrarIntro(aoTerminar) {
  const tela       = document.getElementById('tela-intro');
  const container  = document.getElementById('intro-paragrafos');
  const encerramento = document.getElementById('intro-encerramento');

  tela.classList.add('ativa');
  container.innerHTML = '';
  encerramento.classList.add('oculto');

  // Criar elementos de cada parágrafo ocultos
  const els = INTRO_PARAGRAFOS.map(p => {
    const el = document.createElement('p');
    el.textContent = p.texto;
    el.className   = `intro-p ${p.classe} intro-p-oculto`;
    container.appendChild(el);
    return el;
  });

  // Revelar um por um com delay crescente
  const BASE_DELAY  = 600;   // ms antes do primeiro
  const INTERVALO   = 1800;  // ms entre parágrafos

  els.forEach((el, i) => {
    setTimeout(() => el.classList.remove('intro-p-oculto'), BASE_DELAY + i * INTERVALO);
  });

  // Exibir encerramento + botão após todos os parágrafos
  const totalDelay = BASE_DELAY + els.length * INTERVALO + 400;
  setTimeout(() => encerramento.classList.remove('oculto'), totalDelay);

  // Botão continuar
  document.getElementById('btn-intro-continuar').onclick = () => {
    tela.classList.remove('ativa');
    aoTerminar();
  };

  // Clique na tela pula para o fim
  tela.addEventListener('click', function skip(e) {
    if (e.target.id === 'btn-intro-continuar') return;
    // Revelar tudo imediatamente
    els.forEach(el => el.classList.remove('intro-p-oculto'));
    encerramento.classList.remove('oculto');
    tela.removeEventListener('click', skip);
  }, { once: false });
}

// ============================================================
// TELA DE LOGIN
// ============================================================

function mostrarErroLogin(msg) {
  const el = document.getElementById('login-erro');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('oculto');
}

function ocultarErroLogin() {
  document.getElementById('login-erro')?.classList.add('oculto');
}

function setLoginCarregando(ativo) {
  const btnLogin = document.getElementById('btn-login');
  const btnReg   = document.getElementById('btn-registrar');
  if (btnLogin) { btnLogin.disabled = ativo; btnLogin.textContent = ativo ? '...' : '▶ ENTRAR'; }
  if (btnReg)   { btnReg.disabled   = ativo; }
}

async function entrarComSave(user) {
  _sbUser = user;

  // Mostrar email no header
  const hdrUser = document.getElementById('hdr-usuario');
  if (hdrUser) { hdrUser.textContent = user.email; hdrUser.classList.remove('oculto'); }
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.style.display = 'inline-flex';

  // Tentar carregar save da nuvem
  const saveNuvem = await sbCarregar();
  if (saveNuvem && saveNuvem.personagem) {
    aplicarDadosSave(saveNuvem);
    mostrarTela('tela-jogo');
    restaurarUIJogo();
    if (saveNuvem.pilhas_pendentes > 0) aplicarPilhasPendentes(saveNuvem);
    log(`${saveNuvem.personagem.nome} acorda novamente. A luta continua.`, 'log-alerta');
  } else {
    mostrarTela('tela-criacao');
  }
}

function inicializarLogin() {
  document.getElementById('btn-login')?.addEventListener('click', async () => {
    const email = document.getElementById('login-email')?.value.trim();
    const senha = document.getElementById('login-senha')?.value;
    if (!email || !senha) { mostrarErroLogin('Preencha email e senha.'); return; }
    ocultarErroLogin();
    setLoginCarregando(true);
    try {
      const user = await sbLogin(email, senha);
      await entrarComSave(user);
    } catch (e) {
      mostrarErroLogin(traduzirErroAuth(e.message));
    } finally {
      setLoginCarregando(false);
    }
  });

  document.getElementById('btn-registrar')?.addEventListener('click', async () => {
    const email = document.getElementById('login-email')?.value.trim();
    const senha = document.getElementById('login-senha')?.value;
    if (!email || !senha) { mostrarErroLogin('Preencha email e senha.'); return; }
    if (senha.length < 6)  { mostrarErroLogin('A senha precisa ter ao menos 6 caracteres.'); return; }
    ocultarErroLogin();
    setLoginCarregando(true);
    try {
      const user = await sbRegistrar(email, senha);
      await entrarComSave(user);
    } catch (e) {
      mostrarErroLogin(traduzirErroAuth(e.message));
    } finally {
      setLoginCarregando(false);
    }
  });

  // Jogar offline
  document.getElementById('btn-offline')?.addEventListener('click', () => {
    const temSave = carregarJogo();
    if (temSave) {
      mostrarTela('tela-jogo');
      restaurarUIJogo();
      log(`${estado.personagem.nome} acorda novamente. A luta continua.`, 'log-alerta');
    } else {
      mostrarTela('tela-criacao');
    }
  });

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if (!confirm('Sair da conta?')) return;
    clearInterval(estado.loop);
    await sbLogout();
    location.reload();
  });

  // Enter nos campos
  document.getElementById('login-senha')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-login')?.click();
  });
}

function traduzirErroAuth(msg) {
  if (msg.includes('Invalid login'))     return 'Email ou senha incorretos.';
  if (msg.includes('Email not confirmed')) return 'Confirme seu email antes de entrar.';
  if (msg.includes('User already registered')) return 'Este email já está cadastrado.';
  if (msg.includes('Password should'))   return 'A senha precisa ter ao menos 6 caracteres.';
  return msg;
}

// Aplica um objeto de dados ao estado do jogo (usado por cloud save e localStorage)
function aplicarDadosSave(s) {
  estado.personagem         = s.personagem;
  estado.stats              = s.stats;
  estado.inventario         = s.inventario         || [];
  estado.receitasAprendidas = s.receitasAprendidas || [];
  estado.temBancada         = s.temBancada         || false;
  estado.base               = s.base               || [];
  estado.tatica             = s.tatica             || 'furtivo';
  estado.deposito           = s.deposito           || { nivel: 0, itens: [] };
  estado.cisterna           = s.cisterna           || { aguaAcumulada: 0 };
  estado.filtroInstalado    = s.filtroInstalado    || { diasRestantes: 0 };
  estado.cultivo            = s.cultivo            || { slots: [null, null, null] };
  estado.seguranca          = s.seguranca          || { armadilhasInstaladas: 0 };
  estado.locaisDesbloqueados = s.locaisDesbloqueados || [];
  estado.capInventario      = s.capInventario      || 10;
  estado.exploracoesZona    = s.exploracoesZona    || {};
  estado.respawnTicks       = s.respawnTicks       || {};
  estado.ultimoSaque        = s.ultimoSaque        || null;
  estado.mercado            = s.mercado            || { itens: [], diaGerado: 0 };
  estado.equipamento        = s.equipamento        || { cabeca: null, peito: null, maos: null, pernas: null, pes: null, arma: null, acessorio: null };
  estado.dia                = s.dia                || 1;
  estado.segundos           = s.segundos           || 0;
  estado.condicoes          = { intoxicado: 0, contundido: false, sangramento: false, ...(s.condicoes || {}) };
  estado.placar             = s.placar || { exploracoes: 0, crafts: 0, construcoes: 0 };
  estado.criado             = true;
  if (s.ultimoSave) {
    const diff = Math.floor((Date.now() - s.ultimoSave) / 1000);
    if (diff > 5) aplicarProgressoOffline(diff);
  }
}

// Restaura toda a UI após carregar um save
function restaurarUIJogo() {
  audio.iniciar();
  const p  = estado.personagem;
  const td = TRACOS[p.traco];
  const avatarElR = document.getElementById('hdr-avatar');
  const nR = String((p.avatar || 0) + 1).padStart(2, '0');
  avatarElR.innerHTML = `<img src="img/chars/char${nR}.png" alt="Avatar" class="pc-avatar-img" />`;
  document.getElementById('hdr-nome').textContent  = p.nome;
  document.getElementById('hdr-traco').textContent = `${td.icone} ${td.nome}`;
  document.getElementById('hdr-dia').textContent   = `Dia ${estado.dia}`;
  atualizarRelogio();
  document.querySelectorAll('.tatica-icon').forEach(el => {
    el.classList.toggle('ativa', el.dataset.tatica === estado.tatica);
  });
  renderizarInventario();
  renderizarCrafting();
  renderizarBase();
  renderizarLocais();
  renderizarEquipamento();
  renderizarEquipResumo();
  verificarMercado();
  renderizarMercado();
  atualizarUI();
  iniciarLoop();
}

document.addEventListener('DOMContentLoaded', async () => {
  inicializarCriacao();
  inicializarUI();
  inicializarLogin();
  inicializarBazar();
  audio.init();

  const sb      = getSB();
  const session = sb ? await sbGetSession() : null;
  if (session) {
    // Usuário já autenticado — mostrar header e tentar save da nuvem
    const hdrUser = document.getElementById('hdr-usuario');
    if (hdrUser) { hdrUser.textContent = session.user.email; hdrUser.classList.remove('oculto'); }
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.style.display = 'inline-flex';

    const saveNuvem = await sbCarregar();
    if (saveNuvem && saveNuvem.personagem) {
      aplicarDadosSave(saveNuvem);
      mostrarTela('tela-jogo');
      restaurarUIJogo();
      if ((saveNuvem.pilhas_pendentes || 0) > 0) aplicarPilhasPendentes(saveNuvem);
      log(`${saveNuvem.personagem.nome} acorda novamente. A luta continua.`, 'log-alerta');
    } else {
      // Conta sem save — criação direta
      mostrarTela('tela-criacao');
    }
  } else if (!sb) {
    // Sem Supabase configurado — ir direto para localStorage
    const temSave = carregarJogo();
    if (temSave) {
      mostrarTela('tela-jogo');
      restaurarUIJogo();
      log(`${estado.personagem.nome} acorda novamente. A luta continua.`, 'log-alerta');
    } else {
      mostrarTela('tela-criacao');
    }
  }
  // else: Supabase configurado mas sem sessão → tela-login já está ativa

  setInterval(() => { if (estado.criado) salvarJogo(); }, 30000);
});
