/**
 * ATÉ AMANHÃ — bando.js
 * Identidade do Assentamento (nome, nível, XP, Ataque/Defesa) e o Bando: recrutamento,
 * soldo, equipamento, cura, missões e defesa contra invasões.
 * Depende de combate.js e bando-regras.js (carregados antes) e das funções globais de
 * script.js (estado, ITENS, SLOT_LABELS, CHARS_GENERO, charPath, esc, log, mostrarToast,
 * mostrarConfirmacao, salvarJogo, temItem, removerItem, adicionarItem, mudarBaterias,
 * capacidadeDeposito, renderizarDeposito, moradores, npcAtivo, habCanonica, renderizarAssentamento,
 * atualizarBadgeAssentamento). Essas funções só são chamadas depois que tudo carregou.
 */
'use strict';

// ════════════════════════════════════════════════════════════
// DADOS, XP E PODER
// ════════════════════════════════════════════════════════════

// Garante os campos do Bando e da identidade (saves antigos e jogo novo)
function normalizarBando(assent, personagem) {
  if (!assent.nome) assent.nome = `Assentamento de ${personagem?.nome || 'Sobrevivente'}`;
  if (typeof assent.xp !== 'number') {
    // Saves antigos: XP pelo que já foi construído e acolhido
    const moradias = assent.parcelas.filter(Boolean).length;
    const habitantes = assent.parcelas.reduce((s, p) => s + (p?.habitantes?.filter(Boolean).length || 0), 0);
    assent.xp = moradias * XP_EVENTO.moradia + habitantes * XP_EVENTO.morador;
  }
  assent.nivel = nivelPorXp(assent.xp);
  if (!Array.isArray(assent.bando)) assent.bando = [];
  if (!assent.recrutas) assent.recrutas = { lista: [], dia: -99 };
  if (!assent.missoes) assent.missoes = { emAndamento: [], feitasHoje: [] };
  if (!Array.isArray(assent.relatorios)) assent.relatorios = [];
  // Reparo: quem ficou "em missão" sem missão correspondente (erro ao resolver) volta ao Bando
  const emCampo = new Set(assent.missoes.emAndamento.flatMap(m => m.membros || []));
  for (const c of assent.bando) {
    if (c.estado === 'missao' && !emCampo.has(c.id)) {
      const est = estadoAposCombate(c.vida, c.vidaMax);
      if (est === 'morto') { c.vida = 1; c.estado = 'ferido'; } else c.estado = est;
    }
  }
  return assent;
}

function ganharXpAssentamento(qtd) {
  const a = estado.assentamento;
  const antes = a.nivel;
  a.xp += qtd;
  a.nivel = nivelPorXp(a.xp);
  if (a.nivel > antes) {
    log(`🏘 ${a.nome} subiu para o nível ${a.nivel}! O Bando agora comporta ${limiteBando(a.nivel)} combatentes.`, 'log-sucesso');
    mostrarToast(`🏘 Assentamento nível ${a.nivel}!`, 3000);
  }
}

// Demolir uma moradia tira o XP que ela deu. Se o nível cair e o Bando passar do novo limite,
// ninguém é removido: os combatentes ficam e só novas contratações são barradas (ver contratarRecruta).
function perderXpAssentamento(qtd) {
  const a = estado.assentamento;
  const antes = a.nivel;
  a.xp = Math.max(0, a.xp - qtd);
  a.nivel = nivelPorXp(a.xp);
  if (a.nivel < antes) log(`🏘 ${a.nome} caiu para o nível ${a.nivel}.`, 'log-alerta');
}

// Sem liderança o Bando se desfaz: os combatentes vão embora levando o equipamento (nada volta).
// Chamada por verificarAssentamento (perda da liderança e carga de save sem Líder).
function dissolverBando() {
  const a = estado.assentamento;
  const n = a?.bando?.length || 0;
  if (!n) return;
  a.bando = [];
  if (a.missoes) a.missoes.emAndamento = []; // missões em curso são canceladas; feitasHoje fica como está
  log(`⚔️ Sem liderança, o Bando se dissolveu. ${n} combatente(s) partiram levando o equipamento.`, 'log-perigo');
  salvarJogo();
  atualizarBadgeAssentamento();
}

function combatentePorId(id) {
  return estado.assentamento.bando.find(c => c.id === id);
}

// Prontos para lutar: vivos, não feridos, fora de missão, sem soldo atrasado nem parados
function combatentesProntos() {
  return estado.assentamento.bando.filter(c => c.estado === 'pronto' && !c.soldoPendente);
}

// +1 por armadilha, +1 por morador Segurança ativo, +2 se houver Torre de Vigilância com Segurança
function bonusDefesaAssentamento() {
  const seguranca = moradores().filter(m => npcAtivo(m.npc) && m.npc.habilidade === 'seguranca');
  const torre = seguranca.some(m => m.parcela.tipo === 'torre_vigilancia');
  return (estado.seguranca?.armadilhasInstaladas || 0) + seguranca.length + (torre ? 2 : 0);
}

function poderAssentamento() {
  const bonus = bonusDefesaAssentamento();
  return combatentesProntos().reduce((p, c) => {
    const s = statsLutador(c, bonus);
    return { atq: p.atq + s.atq, def: p.def + s.def };
  }, { atq: 0, def: 0 });
}

function abaAssentamentoAberta() {
  return !!document.getElementById('aba-assentamento')?.classList.contains('ativa');
}

// Salva e redesenha a aba se estiver aberta (senão, só atualiza o "!" da aba)
function atualizarTelaAssentamento() {
  salvarJogo();
  if (abaAssentamentoAberta()) renderizarAssentamento();
  else atualizarBadgeAssentamento();
}

// Janela simples por cima do jogo; fecha no botão "Fechar" ou clicando fora
function abrirJanela(html, { largura = 420 } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal janela-bando';
  overlay.style.zIndex = '150';
  overlay.innerHTML = `<div class="modal-conteudo janela-conteudo" style="max-width:${largura}px">${html}
    <div class="modal-acoes"><button class="btn-secundario btn-sm" data-fechar>Fechar</button></div></div>`;
  const aoTeclar = e => {
    if (e.key !== 'Escape') return;
    const todas = document.querySelectorAll('.janela-bando'); // Esc fecha só a janela do topo
    if (todas[todas.length - 1] !== overlay) return;
    overlay.remove();
  };
  const remover = overlay.remove.bind(overlay);
  overlay.remove = () => { document.removeEventListener('keydown', aoTeclar); remover(); };
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-fechar]')) overlay.remove();
  });
  document.addEventListener('keydown', aoTeclar);
  document.body.appendChild(overlay);
  return overlay;
}

// ════════════════════════════════════════════════════════════
// IDENTIDADE (cabeçalho da aba Assentamento)
// ════════════════════════════════════════════════════════════

function renderizarIdentidadeAssentamento() {
  const el = document.getElementById('assent-identidade');
  if (!el) return;
  const a = estado.assentamento;
  const prox = xpParaNivel(a.nivel);
  const base = XP_NIVEIS[a.nivel - 1];
  const pct = prox ? Math.round((a.xp - base) / (prox - base) * 100) : 100;
  const poder = poderAssentamento();
  el.innerHTML = `
    <div class="ident-topo">
      <span class="ident-nome">🏘 ${esc(a.nome)}</span>
      <button class="ident-editar" id="ident-editar" title="Renomear o assentamento">✏️</button>
      <span class="ident-nivel">Nível ${a.nivel}</span>
    </div>
    <div class="ident-xp"><div class="ident-xp-fill" style="width:${pct}%"></div></div>
    <div class="ident-linha">
      <span class="ident-xp-txt">${prox ? `${a.xp} / ${prox} XP` : `${a.xp} XP · nível máximo`}</span>
      <span class="ident-poder" title="Soma dos combatentes prontos (a Defesa inclui os bônus do assentamento)">⚔️ ${poder.atq} &nbsp; 🛡️ ${poder.def}</span>
    </div>`;
  el.querySelector('#ident-editar').onclick = editarNomeAssentamento;
}

function editarNomeAssentamento() {
  const a = estado.assentamento;
  const j = abrirJanela(`<h3>Nome do assentamento</h3>
    <input id="ident-nome-input" class="janela-input" maxlength="24" value="${esc(a.nome)}">
    <div class="modal-acoes"><button class="btn-primario btn-sm" id="ident-nome-salvar">Salvar</button></div>`);
  const input = j.querySelector('#ident-nome-input');
  input.focus();
  input.select();
  const salvar = () => {
    const nome = input.value.trim().slice(0, 24);
    if (nome.length < 2) { mostrarToast('O nome precisa ter pelo menos 2 letras.'); return; }
    a.nome = nome;
    j.remove();
    log(`🏘 O assentamento agora se chama ${nome}.`, 'log-sistema');
    salvarJogo();
    renderizarIdentidadeAssentamento();
  };
  j.querySelector('#ident-nome-salvar').onclick = salvar;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') salvar(); });
}

// ════════════════════════════════════════════════════════════
// SUB-ABA BANDO — estrutura
// Cada parte se registra em SECOES_BANDO (ordem de exibição) e seus botões usam
// data-acao="..." tratados por ACOES_BANDO.
// ════════════════════════════════════════════════════════════

const SECOES_BANDO = [];
const ACOES_BANDO  = {};

function renderizarBando() {
  const painel = document.getElementById('bando-painel');
  if (!painel) return;
  painel.innerHTML = SECOES_BANDO.map(s => s.html()).join('');
  painel.onclick = e => {
    const el = e.target.closest('[data-acao]');
    if (el && !el.disabled && ACOES_BANDO[el.dataset.acao]) ACOES_BANDO[el.dataset.acao](el);
  };
}

// ════════════════════════════════════════════════════════════
// COMBATENTES, MURAL DE RECRUTAS E SOLDO
// ════════════════════════════════════════════════════════════

const MURAL_DIAS = 3;
const DIAS_SOLDO = 5;
const ESTADO_COMBATENTE = {
  pronto: ['🟢', 'Pronto'],
  ferido: ['🩸', 'Ferido'],
  missao: ['🚶', 'Em missão'],
  parado: ['⛔', 'Parado'],
};

function garantirMural() {
  const r = estado.assentamento.recrutas;
  if (r.lista.length && estado.dia - r.dia < MURAL_DIAS) return;
  r.lista = Array.from({ length: 3 }, () => gerarRecruta(Math.random, CHARS_GENERO));
  r.dia = estado.dia;
  salvarJogo(); // senão recarregar a página sortearia outros recrutas
}

function htmlCombatente(c) {
  const cat = CATEGORIAS[c.categoria];
  const s = statsLutador(c);
  const pctVida = Math.round(c.vida / c.vidaMax * 100);
  const [icone, texto] = c.soldoPendente ? ['🔋', 'Cobrando soldo'] : (ESTADO_COMBATENTE[c.estado] || ['❔', c.estado]);
  const emMissao = c.estado === 'missao';
  const slots = SLOTS_COMBATENTE.map(slot => {
    const it = c.equip[slot] && ITENS[c.equip[slot]];
    return `<button class="comb-slot" data-acao="equipar" data-id="${esc(c.id)}" data-slot="${slot}" ${emMissao ? 'disabled' : ''}>${it ? `${it.icone} ${esc(it.nome)}` : `+ ${SLOT_LABELS[slot]}`}</button>`;
  }).join('');
  let acoes = '';
  if (c.soldoPendente) {
    acoes = `<button class="btn-primario btn-sm" data-acao="pagar-soldo" data-id="${esc(c.id)}" ${temItem('pilha', c.soldoPendente) ? '' : 'disabled'}>🔋 Pagar soldo (${c.soldoPendente})</button>
      <button class="btn-secundario btn-sm" data-acao="recusar-soldo" data-id="${esc(c.id)}">Recusar</button>`;
  } else if (c.estado === 'parado') {
    acoes = `<button class="btn-primario btn-sm" data-acao="reativar" data-id="${esc(c.id)}" ${temItem('pilha', c.divida) ? '' : 'disabled'}>🔋 Pagar e reativar (${c.divida})</button>`;
  }
  return `
    <div class="comb-card${c.estado === 'ferido' ? ' comb-ferido' : ''}">
      <div class="comb-topo">
        <img src="${charPath(c.charId)}" class="comb-avatar" alt="">
        <div class="comb-info">
          <span class="comb-nome">${esc(c.nome)} <span class="comb-cat comb-cat-${c.categoria}">${cat.nome}</span></span>
          <span class="comb-estado">${icone} ${texto} · ⚔️ ${s.atq} 🛡️ ${s.def}</span>
        </div>
      </div>
      <div class="comb-vida" title="${c.vida} / ${c.vidaMax} de vida"><div class="comb-vida-fill" style="width:${pctVida}%"></div></div>
      <span class="comb-vida-txt">❤️ ${c.vida} / ${c.vidaMax}</span>
      <div class="comb-slots">${slots}</div>
      <div class="comb-acoes">
        ${acoes}
        <button class="btn-secundario btn-sm" data-acao="curar" data-id="${esc(c.id)}" ${c.vida >= c.vidaMax || emMissao ? 'disabled' : ''}>🩹 Curar</button>
        <button class="btn-secundario btn-sm comb-dispensar" data-acao="dispensar" data-id="${esc(c.id)}" ${emMissao ? 'disabled' : ''}>Dispensar</button>
      </div>
    </div>`;
}

SECOES_BANDO.push({
  html() {
    const a = estado.assentamento;
    const cards = a.bando.length
      ? a.bando.map(htmlCombatente).join('')
      : '<p class="bando-vazio">Nenhum combatente ainda. Contrate no mural abaixo.</p>';
    return `<div class="sec-bloco bando-secao">
      <h4 class="trab-secao-titulo">⚔️ Seu Bando <span class="bando-cont">${a.bando.length}/${limiteBando(a.nivel)}</span></h4>
      <div class="bando-grid">${cards}</div>
    </div>`;
  },
});

SECOES_BANDO.push({
  html() {
    garantirMural();
    const r = estado.assentamento.recrutas;
    const cards = r.lista.length ? r.lista.map((rec, i) => {
      const cat = CATEGORIAS[rec.categoria];
      return `<div class="recruta-card">
        <img src="${charPath(rec.charId)}" class="comb-avatar" alt="">
        <div class="comb-info">
          <span class="comb-nome">${esc(rec.nome)} <span class="comb-cat comb-cat-${rec.categoria}">${cat.nome}</span></span>
          <span class="comb-estado">⚔️ ${rec.atqBase} 🛡️ ${rec.defBase} ❤️ ${rec.vidaMax} · soldo ${cat.soldo} 🔋 a cada ${DIAS_SOLDO} dias</span>
        </div>
        <button class="btn-primario btn-sm" data-acao="contratar" data-idx="${i}" ${temItem('pilha', rec.preco) ? '' : 'disabled'}>Contratar · ${rec.preco} 🔋</button>
      </div>`;
    }).join('') : '<p class="bando-vazio">Nenhum recruta no momento.</p>';
    return `<div class="sec-bloco bando-secao">
      <h4 class="trab-secao-titulo">📜 Mural de recrutas <span class="bando-cont">renova no dia ${r.dia + MURAL_DIAS}</span></h4>
      <div class="bando-lista">${cards}</div>
    </div>`;
  },
});

function contratarRecruta(idx) {
  const a = estado.assentamento, rec = a.recrutas.lista[idx];
  if (!rec) return;
  const limite = limiteBando(a.nivel);
  if (a.bando.length >= limite) { mostrarToast(`⚔️ Bando cheio (${limite}). Suba o nível do assentamento.`); return; }
  if (!temItem('pilha', rec.preco)) { mostrarToast(`🔋 Precisa de ${rec.preco} Baterias.`); return; }
  removerItem('pilha', rec.preco);
  a.bando.push({
    id: rec.id, nome: rec.nome, charId: rec.charId, categoria: rec.categoria,
    atqBase: rec.atqBase, defBase: rec.defBase, vida: rec.vida, vidaMax: rec.vidaMax,
    equip: { arma: null, cabeca: null, peito: null },
    estado: 'pronto', diaSoldo: estado.dia + DIAS_SOLDO, soldoPendente: null, divida: null,
  });
  a.recrutas.lista.splice(idx, 1);
  log(`⚔️ ${rec.nome} (${CATEGORIAS[rec.categoria].nome}) entrou para o Bando por ${rec.preco} 🔋.`, 'log-sucesso');
  mostrarToast(`⚔️ ${rec.nome} contratado!`);
  atualizarTelaAssentamento();
}

function dispensarCombatente(id) {
  const c = combatentePorId(id);
  if (!c || c.estado === 'missao') return;
  mostrarConfirmacao(`Dispensar ${esc(c.nome)} do Bando?<br><br>O equipamento volta para a mochila.`, () => {
    for (const slot of SLOTS_COMBATENTE) if (c.equip[slot]) adicionarItem(ITENS[c.equip[slot]], 1, { forcar: true });
    estado.assentamento.bando = estado.assentamento.bando.filter(x => x.id !== id);
    log(`🚪 ${c.nome} deixou o Bando.`, 'log-sistema');
    atualizarTelaAssentamento();
  }, null, { labelSim: 'Dispensar', labelNao: 'Cancelar' });
}

function pagarSoldo(id) {
  const c = combatentePorId(id);
  if (!c?.soldoPendente) return;
  if (!temItem('pilha', c.soldoPendente)) { mostrarToast(`🔋 Precisa de ${c.soldoPendente} Baterias.`); return; }
  removerItem('pilha', c.soldoPendente);
  log(`🔋 Você pagou ${c.soldoPendente} Baterias de soldo a ${c.nome}.`, 'log-sucesso');
  c.soldoPendente = null;
  c.diaSoldo = estado.dia + DIAS_SOLDO;
  atualizarTelaAssentamento();
}

function recusarSoldo(id) {
  const c = combatentePorId(id);
  if (!c?.soldoPendente) return;
  c.divida = c.soldoPendente;
  c.soldoPendente = null;
  c.estado = 'parado';
  log(`⛔ ${c.nome} parou de lutar por falta de soldo.`, 'log-alerta');
  atualizarTelaAssentamento();
}

function reativarCombatente(id) {
  const c = combatentePorId(id);
  if (c?.estado !== 'parado') return;
  if (!temItem('pilha', c.divida)) { mostrarToast(`🔋 Precisa de ${c.divida} Baterias.`); return; }
  removerItem('pilha', c.divida);
  log(`🔋 Você pagou ${c.divida} Baterias. ${c.nome} voltou ao Bando.`, 'log-sucesso');
  c.divida = null;
  c.estado = estadoAposCombate(c.vida, c.vidaMax) === 'ferido' ? 'ferido' : 'pronto';
  c.diaSoldo = estado.dia + DIAS_SOLDO;
  atualizarTelaAssentamento();
}

ACOES_BANDO['contratar']     = el => contratarRecruta(parseInt(el.dataset.idx));
ACOES_BANDO['dispensar']     = el => dispensarCombatente(el.dataset.id);
ACOES_BANDO['pagar-soldo']   = el => pagarSoldo(el.dataset.id);
ACOES_BANDO['recusar-soldo'] = el => recusarSoldo(el.dataset.id);
ACOES_BANDO['reativar']      = el => reativarCombatente(el.dataset.id);

// ════════════════════════════════════════════════════════════
// EQUIPAMENTO E CURA COM ITENS
// ════════════════════════════════════════════════════════════

function abrirEquipCombatente(id, slot) {
  const c = combatentePorId(id);
  if (!c || c.estado === 'missao') return;
  const opcoes = Object.entries(COMBATE_EQUIP).filter(([itemId, e]) => e.slot === slot && temItem(itemId));
  const atual = c.equip[slot];
  const lista = opcoes.length
    ? opcoes.map(([itemId, e]) => `<button class="btn-secundario btn-sm janela-opcao" data-item="${itemId}">${ITENS[itemId].icone} ${esc(ITENS[itemId].nome)} <span class="janela-dim">${e.atq ? `+${e.atq} ⚔️` : `+${e.def} 🛡️`}</span></button>`).join('')
    : `<p class="janela-dim">Nenhum item para ${SLOT_LABELS[slot].toLowerCase()} na mochila ou no depósito.</p>`;
  const j = abrirJanela(`<h3>${esc(c.nome)} · ${SLOT_LABELS[slot]}</h3>
    ${atual ? `<p>Equipado: ${ITENS[atual].icone} ${esc(ITENS[atual].nome)} <button class="btn-perigo btn-sm" data-remover>Remover</button></p>` : ''}
    <div class="janela-lista">${lista}</div>`);
  j.querySelectorAll('[data-item]').forEach(b => {
    b.onclick = () => { equiparCombatente(id, slot, b.dataset.item); j.remove(); };
  });
  j.querySelector('[data-remover]')?.addEventListener('click', () => { desequiparCombatente(id, slot); j.remove(); });
}

// Recebem o id e buscam o combatente de novo: a janela pode ter ficado aberta enquanto ele partia ou morria
function equiparCombatente(id, slot, itemId) {
  const c = combatentePorId(id);
  if (!c || c.estado === 'missao') return;
  if (COMBATE_EQUIP[itemId]?.slot !== slot) return;
  if (!temItem(itemId, 1)) return;
  removerItem(itemId, 1);
  if (c.equip[slot]) adicionarItem(ITENS[c.equip[slot]], 1, { forcar: true });
  c.equip[slot] = itemId;
  log(`⚔️ ${c.nome} equipou ${ITENS[itemId].icone} ${ITENS[itemId].nome}.`, 'log-sistema');
  atualizarTelaAssentamento();
}

function desequiparCombatente(id, slot) {
  const c = combatentePorId(id);
  if (!c || c.estado === 'missao') return;
  const itemId = c.equip[slot];
  if (!itemId) return;
  adicionarItem(ITENS[itemId], 1, { forcar: true });
  c.equip[slot] = null;
  atualizarTelaAssentamento();
}

function abrirCuraCombatente(id) {
  const c = combatentePorId(id);
  if (!c || c.estado === 'missao') return;
  const ids = [...new Set([...estado.inventario, ...estado.deposito.itens].map(i => i.id))]
    .filter(itemId => ITENS[itemId]?.tipo === 'medicinal' && (ITENS[itemId].efeitos?.vida || 0) > 0);
  const lista = ids.length
    ? ids.map(itemId => `<button class="btn-secundario btn-sm janela-opcao" data-item="${itemId}">${ITENS[itemId].icone} ${esc(ITENS[itemId].nome)} <span class="janela-dim">+${ITENS[itemId].efeitos.vida} ❤️</span></button>`).join('')
    : '<p class="janela-dim">Nenhum item de cura na mochila ou no depósito.</p>';
  const j = abrirJanela(`<h3>Curar ${esc(c.nome)}</h3><p class="janela-dim">Vida: ${c.vida} / ${c.vidaMax}</p><div class="janela-lista">${lista}</div>`);
  j.querySelectorAll('[data-item]').forEach(b => {
    b.onclick = () => { curarCombatenteComItem(id, b.dataset.item); j.remove(); };
  });
}

function curarCombatenteComItem(id, itemId) {
  const c = combatentePorId(id);
  if (!c || c.estado === 'missao') return;
  if (!temItem(itemId, 1)) return;
  removerItem(itemId, 1);
  const antes = c.vida;
  c.vida = Math.min(c.vidaMax, c.vida + ITENS[itemId].efeitos.vida);
  if (c.estado === 'ferido' && estadoAposCombate(c.vida, c.vidaMax) === 'pronto') c.estado = 'pronto';
  log(`🩹 ${c.nome} recebeu ${ITENS[itemId].nome}: +${c.vida - antes} de vida.`, 'log-sucesso');
  atualizarTelaAssentamento();
}

ACOES_BANDO['equipar'] = el => abrirEquipCombatente(el.dataset.id, el.dataset.slot);
ACOES_BANDO['curar']   = el => abrirCuraCombatente(el.dataset.id);

// ════════════════════════════════════════════════════════════
// ROTINA DIÁRIA (chamada em avancarDia)
// ════════════════════════════════════════════════════════════

function rotinaDiariaBando() {
  const a = estado.assentamento;
  if (!a?.bando) return;

  // Soldo: cobra a cada DIAS_SOLDO dias (quem está em missão é cobrado depois que voltar)
  for (const c of a.bando) {
    if (c.estado === 'parado' || c.estado === 'missao' || c.soldoPendente) continue;
    if (estado.dia >= c.diaSoldo) {
      c.soldoPendente = CATEGORIAS[c.categoria].soldo;
      log(`🔋 ${c.nome} cobra o soldo: ${c.soldoPendente} Baterias.`, 'log-alerta');
    }
  }

  // Cura: sozinho, com Médico ou com Médico no Posto Médico
  const medicos = moradores().filter(m => npcAtivo(m.npc) && habCanonica(m.npc.habilidade) === 'medico');
  const cura = curaDiaria(medicos.length > 0, medicos.some(m => m.parcela.tipo === 'posto_medico'));
  for (const c of a.bando) {
    if (c.estado === 'missao' || c.vida >= c.vidaMax) continue;
    c.vida = Math.min(c.vidaMax, c.vida + cura);
    if (c.estado === 'ferido' && estadoAposCombate(c.vida, c.vidaMax) === 'pronto') {
      c.estado = 'pronto';
      log(`🩹 ${c.nome} se recuperou e voltou ao Bando.`, 'log-sucesso');
    }
  }

  a.missoes.feitasHoje = [];
  garantirMural();
}

// ════════════════════════════════════════════════════════════
// RESULTADO DE COMBATE, LOOT E RELATÓRIOS
// ════════════════════════════════════════════════════════════

const RELATORIOS_MAX = 5;

// Aplica as vidas finais do lado do Bando; mortos saem do Bando com o equipamento
function aplicarResultadoCombate(res, lado) {
  const a = estado.assentamento;
  const mortos = [], feridos = [], idsMortos = [];
  for (const l of res.lutadores) {
    if (l.lado !== lado) continue;
    const c = combatentePorId(l.id);
    if (!c) continue;
    c.vida = l.vida;
    const est = estadoAposCombate(c.vida, c.vidaMax);
    if (est === 'morto') { mortos.push(c.nome); idsMortos.push(c.id); continue; }
    if (est === 'ferido') feridos.push(c.nome);
    // Parados nunca lutam (não entram em combatentesProntos); a guarda fica por segurança
    if (c.estado !== 'parado') c.estado = est;
  }
  a.bando = a.bando.filter(c => !idsMortos.includes(c.id));
  return { mortos, feridos };
}

function guardarLootNoDeposito(base, qtd) {
  const dep = estado.deposito;
  if (!dep.nivel) return false;
  const existente = dep.itens.find(i => i.id === base.id);
  if (existente) existente.qtd += qtd;
  else if (dep.itens.length >= capacidadeDeposito()) return false;
  else dep.itens.push({ ...base, qtd });
  renderizarDeposito();
  return true;
}

// Baterias vão para a carteira; itens para o Depósito (ou mochila, se não couber)
function entregarLoot(loot) {
  if (loot.baterias) mudarBaterias(loot.baterias);
  for (const { id, qtd } of loot.itens) {
    const base = ITENS[id];
    if (!base) continue;
    if (!guardarLootNoDeposito(base, qtd)) adicionarItem(base, qtd, { forcar: true });
  }
}

function descreverLoot(loot) {
  return [`${loot.baterias} 🔋`, ...loot.itens.map(i => `${ITENS[i.id]?.icone || ''} ${ITENS[i.id]?.nome || i.id} ×${i.qtd}`)].join(', ');
}

function registrarRelatorio(rel) {
  const lista = estado.assentamento.relatorios;
  rel.naoVisto = true; // mostrado quando o jogador voltar (ver exibirRelatoriosPendentes)
  lista.unshift(rel);
  if (lista.length > RELATORIOS_MAX) lista.length = RELATORIOS_MAX;
}

function abrirRelatorio(rel) {
  rel.naoVisto = false;
  const baixas = [
    rel.baixas.mortos.length ? `💀 Mortos: ${rel.baixas.mortos.map(esc).join(', ')}` : '',
    rel.baixas.feridos.length ? `🩸 Feridos: ${rel.baixas.feridos.map(esc).join(', ')}` : '',
  ].filter(Boolean).join('<br>');
  abrirJanela(`<h3>${esc(rel.titulo)}</h3>
    <p class="rel-resultado ${rel.venceu ? 'rel-vitoria' : 'rel-derrota'}">${rel.venceu ? '🏆 Vitória' : '☠️ Derrota'} · Dia ${rel.dia}</p>
    <p>${esc(rel.resumo)}</p>
    ${baixas ? `<p>${baixas}</p>` : ''}
    <div class="rel-linhas">${rel.linhas.map(l => `<div class="${l.startsWith('—') ? 'rel-rodada' : ''}">${esc(l)}</div>`).join('')}</div>`,
    { largura: 520 });
}

// ════════════════════════════════════════════════════════════
// MISSÕES
// ════════════════════════════════════════════════════════════

SECOES_BANDO.push({
  html() {
    const a = estado.assentamento;
    const temProntos = combatentesProntos().length > 0;
    const cards = Object.entries(MISSOES).map(([tipo, m]) => {
      const andamento = a.missoes.emAndamento.find(x => x.tipo === tipo);
      const inimigos = gerarInimigos(tipo, a.nivel), i0 = inimigos[0];
      let rodape;
      if (andamento) {
        const hora = new Date(andamento.fim).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const nomes = andamento.membros.map(id => combatentePorId(id)?.nome).filter(Boolean).map(esc).join(', ');
        rodape = `<span class="missao-status">🚶 ${nomes} · volta às ${hora}</span>`;
      } else if (a.missoes.feitasHoje.includes(tipo)) {
        rodape = '<span class="missao-status janela-dim">✔ Já feita hoje. Volta amanhã.</span>';
      } else {
        rodape = `<button class="btn-primario btn-sm" data-acao="missao" data-tipo="${tipo}" ${temProntos ? '' : 'disabled'}>Enviar Bando</button>`;
      }
      return `<div class="missao-card">
        <span class="missao-nome">${m.icone} ${m.nome}</span>
        <span class="missao-info">${inimigos.length}× ${m.inimigo} (⚔️ ${i0.atq} 🛡️ ${i0.def} ❤️ ${i0.vida}) · ⏱ ${m.duracaoMin} min</span>
        <span class="missao-info">Recompensa: ${m.baterias[0]}–${m.baterias[1]} 🔋, itens${m.raro ? ', chance de item raro' : ''} · +${m.xp} XP</span>
        ${rodape}
      </div>`;
    }).join('');
    return `<div class="sec-bloco bando-secao">
      <h4 class="trab-secao-titulo">🗺️ Missões</h4>
      <div class="bando-lista">${cards}</div>
    </div>`;
  },
});

function abrirEnvioMissao(tipo) {
  const m = MISSOES[tipo], prontos = combatentesProntos();
  if (!prontos.length) { mostrarToast('Nenhum combatente pronto.'); return; }
  const lista = prontos.map(c => {
    const s = statsLutador(c);
    return `<label class="janela-check"><input type="checkbox" value="${c.id}" checked> ${esc(c.nome)} <span class="janela-dim">⚔️ ${s.atq} 🛡️ ${s.def} ❤️ ${c.vida}</span></label>`;
  }).join('');
  const j = abrirJanela(`<h3>${m.icone} ${m.nome}</h3>
    <p class="janela-dim">Escolha quem vai. Quem morrer em combate é perdido junto com o equipamento.</p>
    <div class="janela-lista">${lista}</div>
    <div class="modal-acoes"><button class="btn-primario btn-sm" data-partir>Partir</button></div>`);
  j.querySelector('[data-partir]').onclick = () => {
    const ids = [...j.querySelectorAll('input:checked')].map(i => i.value);
    if (!ids.length) { mostrarToast('Escolha pelo menos um combatente.'); return; }
    iniciarMissao(tipo, ids);
    j.remove();
  };
}

function iniciarMissao(tipo, ids) {
  const a = estado.assentamento, m = MISSOES[tipo];
  if (a.missoes.feitasHoje.includes(tipo) || a.missoes.emAndamento.some(x => x.tipo === tipo)) return;
  // Revalida: a janela de envio pode estar velha (alguém ficou ferido, parou ou já partiu)
  const prontos = new Set(combatentesProntos().map(c => c.id));
  ids = ids.filter(id => prontos.has(id));
  if (!ids.length) { mostrarToast('Nenhum combatente pronto.'); return; }
  const agora = Date.now();
  for (const c of a.bando) if (ids.includes(c.id)) c.estado = 'missao';
  a.missoes.emAndamento.push({
    id: 'm' + agora.toString(36), tipo, membros: ids, nivel: a.nivel,
    fim: agora + m.duracaoMin * 60000, semente: (agora % 2147483647) || 1,
  });
  a.missoes.feitasHoje.push(tipo);
  log(`🗺️ ${ids.length} combatente(s) partiram para ${m.nome}. Voltam em ${m.duracaoMin} min.`, 'log-sistema');
  atualizarTelaAssentamento();
}

// Chamada a cada segundo (atualizarStatus) e funciona também ao voltar com o jogo fechado
function verificarMissoesConcluidas() {
  exibirRelatoriosPendentes();
  const a = estado.assentamento;
  if (!a?.missoes?.emAndamento?.length) return;
  const agora = Date.now();
  const prontas = a.missoes.emAndamento.filter(m => agora >= m.fim);
  if (!prontas.length) return;
  a.missoes.emAndamento = a.missoes.emAndamento.filter(m => agora < m.fim);
  for (const m of prontas) {
    try { resolverMissao(m); } catch (err) { console.error('Erro ao resolver missão', m, err); }
  }
  atualizarTelaAssentamento();
  exibirRelatoriosPendentes(); // uma janela só, mesmo que várias missões tenham terminado juntas
}

// Mostra os relatórios que chegaram com o jogador fora (aba oculta, exploração ou jogo fechado)
function exibirRelatoriosPendentes() {
  if (document.hidden || estado.exploracao?.ativa) return;
  const pendentes = (estado.assentamento?.relatorios || []).filter(r => r.naoVisto);
  if (!pendentes.length) return;
  if (pendentes.length === 1) {
    abrirRelatorio(pendentes[0]);
  } else {
    pendentes.forEach(r => { r.naoVisto = false; });
    const j = abrirJanela(`<h3>📋 Enquanto você estava fora</h3>
      <div class="janela-lista">${pendentes.map((r, i) => `<button class="rel-item" data-rel="${i}">${r.venceu ? '🏆' : '☠️'} ${esc(r.titulo)} · Dia ${r.dia}</button>`).join('')}</div>`);
    j.querySelectorAll('[data-rel]').forEach(b => {
      b.onclick = () => abrirRelatorio(pendentes[parseInt(b.dataset.rel)]);
    });
  }
  salvarJogo();
}

function resolverMissao(m) {
  const cfg = MISSOES[m.tipo];
  const membros = estado.assentamento.bando.filter(c => m.membros.includes(c.id));
  const res = simularCombate(membros.map(c => statsLutador(c)), gerarInimigos(m.tipo, m.nivel), m.semente);
  const baixas = aplicarResultadoCombate(res, 'A');
  const venceu = res.vencedor === 'A';
  let resumo;
  if (venceu) {
    const loot = sortearLoot(m.tipo, criarRng(m.semente + 1));
    entregarLoot(loot);
    ganharXpAssentamento(cfg.xp);
    resumo = `Saque: ${descreverLoot(loot)} · +${cfg.xp} XP`;
  } else {
    ganharXpAssentamento(XP_EVENTO.derrota);
    resumo = `O Bando recuou sem nada. +${XP_EVENTO.derrota} XP`;
  }
  const rel = { titulo: `${cfg.icone} ${cfg.nome}`, venceu, dia: estado.dia, resumo, baixas, linhas: res.relatorio, semente: m.semente };
  registrarRelatorio(rel);
  log(`${venceu ? '🏆' : '☠️'} Missão ${cfg.nome}: ${venceu ? 'vitória' : 'derrota'}.${baixas.mortos.length ? ` Mortos: ${baixas.mortos.join(', ')}.` : ''}`, venceu ? 'log-sucesso' : 'log-perigo');
}

ACOES_BANDO['missao'] = el => abrirEnvioMissao(el.dataset.tipo);

// ════════════════════════════════════════════════════════════
// DEFESA CONTRA INVASÕES (chamada em processarSaqueNoturno)
// Retorna true (Bando venceu: nada é roubado), false (perdeu) ou null (sem defensores).
// ════════════════════════════════════════════════════════════

function defenderInvasao() {
  const a = estado.assentamento;
  if (!a?.bando) return null;
  const defensores = combatentesProntos();
  if (!defensores.length) return null;
  const bonus = bonusDefesaAssentamento();
  const semente = (Date.now() % 2147483647) || 1;
  const res = simularCombate(gerarInvasores(a.nivel), defensores.map(c => statsLutador(c, bonus)), semente);
  const baixas = aplicarResultadoCombate(res, 'B');
  const venceu = res.vencedor === 'B';
  ganharXpAssentamento(venceu ? XP_EVENTO.invasaoVitoria : XP_EVENTO.derrota);
  const resumo = venceu
    ? `O Bando expulsou os invasores. Nada foi roubado. +${XP_EVENTO.invasaoVitoria} XP`
    : `Os invasores passaram pelo Bando e saquearam o depósito. +${XP_EVENTO.derrota} XP`;
  registrarRelatorio({ titulo: '🌙 Invasão noturna', venceu, dia: estado.dia, resumo, baixas, linhas: res.relatorio, semente }); // relatório só abre quando o jogador voltar
  log(venceu ? `⚔️ Invasores atacaram ${a.nome}, mas o Bando os expulsou!` : `⚔️ Invasores venceram o Bando de ${a.nome}.`, venceu ? 'log-sucesso' : 'log-perigo');
  if (baixas.mortos.length) log(`💀 Mortos na defesa: ${baixas.mortos.join(', ')}.`, 'log-perigo');
  mostrarToast(venceu ? '⚔️ O Bando defendeu o assentamento!' : '⚔️ O Bando perdeu a defesa!', 3000);
  atualizarTelaAssentamento();
  return venceu;
}

// ════════════════════════════════════════════════════════════
// RELATÓRIOS (última seção da sub-aba)
// ════════════════════════════════════════════════════════════

SECOES_BANDO.push({
  html() {
    const rs = estado.assentamento.relatorios;
    if (!rs.length) return '';
    return `<div class="sec-bloco bando-secao">
      <h4 class="trab-secao-titulo">📋 Últimos combates</h4>
      <div class="bando-lista">${rs.map((r, i) => `<button class="rel-item" data-acao="relatorio" data-idx="${i}">${r.venceu ? '🏆' : '☠️'} ${esc(r.titulo)} · Dia ${r.dia}</button>`).join('')}</div>
    </div>`;
  },
});

ACOES_BANDO['relatorio'] = el => {
  const rel = estado.assentamento.relatorios[parseInt(el.dataset.idx)];
  if (rel) abrirRelatorio(rel);
};
