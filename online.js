/**
 * ATÉ AMANHÃ — online.js
 * Etapa 2 do Bando: perfil público do assentamento, sub-aba 🌐 Ataques (lista de alvos,
 * ataques em andamento, ranking), envio de ataques e aplicação dos resultados no save.
 * A decisão de cada ataque é do servidor (supabase_bando_online.sql); aqui só se mostra,
 * envia e aplica. Depende de combate.js, bando-regras.js, bando.js e de script.js
 * (estado, getSB, _sbUser, esc, log, mostrarToast, salvarJogo, mudarBaterias,
 * renderizarDeposito, renderizarAssentamento, atualizarBadgeAssentamento).
 */
'use strict';

const PUBLICAR_INTERVALO_MS = 20000;  // salvarJogo roda muito; o perfil sobe no máximo a cada 20 s
const APLICADOS_MAX = 30;            // ids de ataques já aplicados guardados no save

// Estado só da sessão (não vai para o save)
const online = {
  perfis: [],          // linhas de assentamentos_publicos (sub-aba aberta)
  meuPerfil: null,
  contra: [],          // ataques a caminho contra mim
  ultimaPublicacao: 0,
  verificando: false,
  timerLista: null,
};

// Só participa do online quem tem conta e é Líder (tem acesso ao Assentamento)
function participaOnline() {
  return !!(getSB() && _sbUser && estado.criado && estado.ehLider && estado.assentamento?.bando);
}

// ════════════════════════════════════════════════════════════
// PERFIL PÚBLICO
// ════════════════════════════════════════════════════════════

function montarPerfilPublico() {
  const a = estado.assentamento;
  const bonus = Math.min(20, bonusDefesaAssentamento());
  const nome = (a.nome || '').replace(/[<>]/g, '').trim().slice(0, 24) || 'Assentamento';
  return {
    nome,
    xp: a.xp,
    nivel: a.nivel,
    defensores: combatentesProntos().slice(0, 8).map(c => {
      const s = statsLutador(c);
      return {
        id: String(c.id).slice(0, 40), nome: String(c.nome).replace(/[<>]/g, '').slice(0, 24) || 'Combatente',
        atq: Math.min(LIMITES_LUTADOR.atq, s.atq), def: Math.min(LIMITES_LUTADOR.def, s.def),
        vida: Math.max(1, Math.min(LIMITES_LUTADOR.vida, s.vida)),
      };
    }),
    moradores: Math.min(8, moradores().filter(m => npcAtivo(m.npc)).length),
    bonus_def: bonus,
    baterias: Math.max(0, Math.min(100000, estado.baterias || 0)),
    deposito: estado.deposito.itens
      .filter(i => i.tipo !== 'leitura' && i.tipo !== 'anotacao' && /^[a-z0-9_]{1,40}$/.test(i.id) && i.qtd > 0)
      .slice(0, 20)
      .map(i => ({ id: i.id, qtd: Math.min(999, i.qtd) })),
  };
}

async function publicarPerfilOnline(forcar = false) {
  if (!participaOnline()) return;
  const agora = Date.now();
  if (!forcar && agora - online.ultimaPublicacao < PUBLICAR_INTERVALO_MS) return;
  online.ultimaPublicacao = agora;
  const { error } = await getSB().rpc('publicar_perfil', { p: montarPerfilPublico() });
  if (error) console.error('[Online] Falha ao publicar o perfil:', error.message);
}

// ════════════════════════════════════════════════════════════
// ATAQUES PENDENTES (a cada 30 s e ao entrar)
// ════════════════════════════════════════════════════════════

async function verificarAtaquesOnline() {
  if (!participaOnline() || online.verificando) return;
  online.verificando = true;
  try {
    const sb = getSB(), eu = _sbUser.id;
    const { data, error } = await sb.from('ataques').select('*')
      .or('estado.eq.a_caminho,aplicado_atacante.eq.false,aplicado_defensor.eq.false');
    if (error) { console.error('[Online] Falha ao verificar ataques:', error.message); return; }
    online.contra = [];
    for (const at of data || []) {
      const papel = at.atacante === eu ? 'atacante' : 'defensor';
      let atual = at;
      if (atual.estado === 'a_caminho') {
        if (new Date(atual.chegada) > new Date()) {
          if (papel === 'defensor') online.contra.push(atual);
          continue;
        }
        const r = await sb.rpc('resolver_ataque', { p_ataque: atual.id });
        if (r.error) { console.error('[Online] Falha ao resolver ataque:', r.error.message); continue; }
        atual = r.data;
      }
      const jaAplicou = papel === 'atacante' ? atual.aplicado_atacante : atual.aplicado_defensor;
      if (atual.estado === 'resolvido' && !jaAplicou) {
        aplicarResultadoAtaque(atual, papel);
        const m = await sb.rpc('marcar_ataque_aplicado', { p_ataque: atual.id });
        if (m.error) console.error('[Online] Falha ao marcar ataque aplicado:', m.error.message);
      }
    }
    atualizarBadgeAssentamento();
    if (abaAssentamentoAberta()) renderizarOnline();
  } finally {
    online.verificando = false;
  }
}

// Aplica no save a parte deste jogador. Guarda o id para nunca aplicar duas vezes
// (mesmo que a marcação no servidor falhe e o ataque volte na próxima verificação).
function aplicarResultadoAtaque(at, papel) {
  const a = estado.assentamento;
  if (a.ataquesAplicados.includes(at.id)) return;
  const res = at.resultado;
  const souAtacante = papel === 'atacante';
  const venceu = souAtacante === (res.vencedor === 'A');
  let baixas = { mortos: [], feridos: [] };
  const partes = [];

  if (souAtacante) {
    baixas = aplicarResultadoCombate(res, 'A');
    if (venceu) {
      entregarLoot(res.saque);
      partes.push(`Saque: ${descreverLoot(res.saque)}`);
    }
    a.ataquesEnviados = a.ataquesEnviados.filter(x => x.id !== at.id);
    ganharXpAssentamento(venceu ? PVP.xp.vitoria : PVP.xp.derrota);
    partes.push(`+${venceu ? PVP.xp.vitoria : PVP.xp.derrota} XP · ${venceu ? `+${PVP.pontos.vitoria}` : PVP.pontos.derrota} pontos`);
  } else {
    if (!res.milicia) baixas = aplicarResultadoCombate(res, 'B');
    else partes.push('Sem Bando em casa: os moradores defenderam como milícia.');
    if (!venceu) {
      const perdas = perderSaque(res.saque);
      partes.push(`Levaram: ${perdas}`);
    }
    ganharXpAssentamento(venceu ? PVP.xp.defesa : PVP.xp.derrota);
    partes.push(`+${venceu ? PVP.xp.defesa : PVP.xp.derrota} XP${venceu ? ` · +${PVP.pontos.defesa} pontos` : ''}`);
  }

  const outro = souAtacante ? at.defensor_nome : at.atacante_nome;
  registrarRelatorio({
    titulo: souAtacante ? `⚔️ Ataque a ${outro}` : `🛡️ Ataque de ${outro}`,
    venceu, dia: estado.dia, resumo: partes.join(' · '), baixas, linhas: res.relatorio, semente: at.semente,
  });
  log(souAtacante
    ? `${venceu ? '🏆' : '☠️'} Seu ataque a ${outro}: ${venceu ? 'vitória' : 'derrota'}.`
    : `${venceu ? '🛡️' : '☠️'} ${outro} atacou seu assentamento: ${venceu ? 'o ataque foi repelido' : 'os invasores venceram'}.`,
  venceu ? 'log-sucesso' : 'log-perigo');
  if (baixas.mortos.length) log(`💀 Mortos: ${baixas.mortos.join(', ')}.`, 'log-perigo');

  a.ataquesAplicados.push(at.id);
  if (a.ataquesAplicados.length > APLICADOS_MAX) a.ataquesAplicados.splice(0, a.ataquesAplicados.length - APLICADOS_MAX);
  atualizarTelaAssentamento();
}

// Tira do save o que foi saqueado, limitado ao que o jogador tem agora
function perderSaque(saque) {
  const levou = [];
  const bat = Math.min(estado.baterias || 0, saque.baterias || 0);
  if (bat > 0) { mudarBaterias(-bat); levou.push(`${bat} 🔋`); }
  for (const { id, qtd } of saque.itens || []) {
    const dep = estado.deposito.itens.find(i => i.id === id);
    if (!dep) continue;
    const tira = Math.min(dep.qtd, qtd);
    dep.qtd -= tira;
    if (dep.qtd <= 0) estado.deposito.itens = estado.deposito.itens.filter(i => i.id !== id);
    levou.push(`${dep.icone || ''} ${dep.nome || id} ×${tira}`);
  }
  if (levou.length) renderizarDeposito();
  return levou.length ? levou.join(', ') : 'nada';
}

// ════════════════════════════════════════════════════════════
// ENVIAR ATAQUE
// ════════════════════════════════════════════════════════════

function abrirEnvioAtaque(alvoId) {
  const alvo = online.perfis.find(p => p.user_id === alvoId);
  const prontos = combatentesProntos();
  if (!alvo) return;
  const motivo = online.meuPerfil && motivoBloqueio(online.meuPerfil, alvo, new Date(), prontos.length > 0);
  if (motivo) { mostrarToast(motivo); return; }
  const limite = limiteBando(estado.assentamento.nivel);
  const lista = prontos.map((c, i) => {
    const s = statsLutador(c);
    return `<label class="janela-check"><input type="checkbox" value="${esc(c.id)}" ${i < limite ? 'checked' : ''}> ${esc(c.nome)} <span class="janela-dim">⚔️ ${s.atq} 🛡️ ${s.def} ❤️ ${c.vida}</span></label>`;
  }).join('');
  const poder = poderPerfil(alvo);
  const j = abrirJanela(`<h3>⚔️ Atacar ${esc(alvo.nome)}</h3>
    <p class="janela-dim">Nível ${alvo.nivel} · defesa estimada ⚔️ ${poder.atq} 🛡️ ${poder.def}. O grupo chega em ${PVP.viagemMin} min. Quem morrer em combate é perdido com o equipamento.</p>
    <div class="janela-lista">${lista}</div>
    <div class="modal-acoes"><button class="btn-primario btn-sm" data-partir>Atacar</button></div>`);
  j.querySelector('[data-partir]').onclick = async () => {
    const ids = [...j.querySelectorAll('input:checked')].map(i => i.value);
    if (!ids.length) { mostrarToast('Escolha pelo menos um combatente.'); return; }
    if (ids.length > limite) { mostrarToast(`No máximo ${limite} combatentes.`); return; }
    j.remove();
    await iniciarAtaqueOnline(alvo, ids);
  };
}

async function iniciarAtaqueOnline(alvo, ids) {
  const a = estado.assentamento;
  const validos = new Set(combatentesProntos().map(c => c.id));
  const membros = ids.filter(id => validos.has(id));
  if (!membros.length) { mostrarToast('Nenhum combatente pronto.'); return; }
  const time = membros.map(id => {
    const s = statsLutador(combatentePorId(id));
    return { id: s.id, nome: String(s.nome).replace(/[<>]/g, '').slice(0, 24), atq: s.atq, def: s.def, vida: s.vida };
  });
  await publicarPerfilOnline(true);
  const { data, error } = await getSB().rpc('iniciar_ataque', { p_alvo: alvo.user_id, p_time: time });
  if (error) { mostrarToast(`❌ ${error.message}`, 3500); return; }
  for (const c of a.bando) if (membros.includes(c.id)) c.estado = 'missao';
  a.ataquesEnviados.push({ id: data.id, membros, chegada: data.chegada, alvo: data.defensor_nome });
  log(`⚔️ ${membros.length} combatente(s) partiram para atacar ${data.defensor_nome}. Chegam em ${PVP.viagemMin} min.`, 'log-sistema');
  atualizarTelaAssentamento();
  carregarListaOnline();
}

// ════════════════════════════════════════════════════════════
// SUB-ABA 🌐 ATAQUES
// ════════════════════════════════════════════════════════════

async function carregarListaOnline() {
  if (!participaOnline()) return;
  if (!online.meuPerfil) await publicarPerfilOnline(true); // primeira vez: aparecer na lista antes de consultar
  const { data, error } = await getSB().from('assentamentos_publicos')
    .select('user_id,nome,nivel,pontos,vitorias,derrotas,visto_em,defensores,moradores,bonus_def,escudo_ate,ataques_dia,ataques_qtd,alvos_dia')
    .order('pontos', { ascending: false }).order('vitorias', { ascending: false }).limit(100);
  if (error) { console.error('[Online] Falha ao carregar assentamentos:', error.message); return; }
  online.meuPerfil = (data || []).find(p => p.user_id === _sbUser.id) || null;
  online.perfis = (data || []).filter(p => p.user_id !== _sbUser.id);
  online.ranking = data || [];
  renderizarOnline();
}

const horaCurta = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function renderizarOnline() {
  const painel = document.getElementById('online-painel');
  if (!painel) return;
  if (!getSB() || !_sbUser) {
    painel.innerHTML = '<div class="sec-bloco"><p class="bando-vazio">Faça login com uma conta para atacar e defender contra outros jogadores.</p></div>';
    return;
  }
  const a = estado.assentamento, agora = new Date();
  const temProntos = combatentesProntos().length > 0;

  const enviados = a.ataquesEnviados.map(x => `<div class="online-andamento">⚔️ Seu ataque a <b>${esc(x.alvo)}</b> chega às ${horaCurta(x.chegada)}</div>`);
  const contra = online.contra.map(x => `<div class="online-andamento online-perigo">⚠️ Ataque a caminho: <b>${esc(x.atacante_nome)}</b>, chega às ${horaCurta(x.chegada)}</div>`);
  const andamento = [...contra, ...enviados].join('') || '<p class="bando-vazio">Nenhum ataque em andamento.</p>';

  const alvos = online.perfis.map(p => {
    const motivo = online.meuPerfil ? motivoBloqueio(online.meuPerfil, p, agora, temProntos) : 'Publicando seu assentamento…';
    const poder = poderPerfil(p);
    const on = estaOnline(p.visto_em, agora);
    return `<div class="online-alvo">
      <div class="comb-info">
        <span class="comb-nome">${on ? '🟢' : '⚫'} ${esc(p.nome)} <span class="comb-cat">Nível ${p.nivel}</span></span>
        <span class="comb-estado">🏆 ${p.pontos} pontos · ⚔️ ${poder.atq} 🛡️ ${poder.def}${p.defensores?.length ? '' : ' (milícia)'}</span>
      </div>
      <button class="btn-primario btn-sm" data-atacar="${esc(p.user_id)}" ${motivo ? `disabled title="${esc(motivo)}"` : ''}>Atacar</button>
      ${motivo ? `<span class="online-motivo">${esc(motivo)}</span>` : ''}
    </div>`;
  }).join('') || '<p class="bando-vazio">Nenhum outro assentamento online ainda.</p>';

  const ranking = (online.ranking || []).slice(0, 20).map((p, i) => `<div class="online-rank${p.user_id === _sbUser.id ? ' online-eu' : ''}">
      <span class="online-pos">${i + 1}º</span><span class="online-rank-nome">${esc(p.nome)}</span>
      <span class="janela-dim">Nv ${p.nivel}</span><span>🏆 ${p.pontos}</span><span class="janela-dim">${p.vitorias}V/${p.derrotas}D</span>
    </div>`).join('') || '<p class="bando-vazio">Ranking vazio.</p>';

  painel.innerHTML = `
    <div class="sec-bloco bando-secao"><h4 class="trab-secao-titulo">🚩 Ataques em andamento</h4><div class="bando-lista">${andamento}</div></div>
    <div class="sec-bloco bando-secao"><h4 class="trab-secao-titulo">🌐 Assentamentos <span class="bando-cont">atualiza a cada 30 s</span></h4><div class="bando-lista">${alvos}</div></div>
    <div class="sec-bloco bando-secao"><h4 class="trab-secao-titulo">🏆 Ranking</h4><div class="bando-lista">${ranking}</div></div>`;
  painel.onclick = e => {
    const b = e.target.closest('[data-atacar]');
    if (b && !b.disabled) abrirEnvioAtaque(b.dataset.atacar);
  };
}

// Lista e ranking recarregam a cada 30 s enquanto a sub-aba Ataques estiver visível
function iniciarAtualizacaoOnline() {
  if (online.timerLista) return;
  online.timerLista = setInterval(() => {
    const visivel = !document.hidden && abaAssentamentoAberta() && !document.getElementById('sub-assent-online')?.classList.contains('oculto');
    if (visivel) carregarListaOnline();
  }, 30000);
}
