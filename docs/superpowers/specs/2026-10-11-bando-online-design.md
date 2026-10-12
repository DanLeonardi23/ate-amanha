# Bando online — Etapa 2 (ataques entre jogadores)

Data: 2026-10-11
Status: aprovado em conversa, aguardando revisão do documento
Depende de: Etapa 1 (`docs/superpowers/specs/2026-10-11-bando-assentamento-design.md`), já publicada

## Objetivo

Levar os assentamentos para o online: cada jogador com conta publica um perfil do seu assentamento, vê a lista de assentamentos dos outros, ataca com o seu Bando e defende o seu. Um ranking por pontos de guerra dá objetivo ao PvP.

## Decisões tomadas

| Tema | Decisão |
|---|---|
| Prêmio | Atacante vencedor leva Baterias e itens do depósito do defensor |
| Alvos | Todos os assentamentos, online ou offline |
| Proteções | Faixa de nível ±2; escudo após ser atacado; até 3 ataques por dia; mesmo alvo uma vez por dia |
| Tempo | Viagem curta (5 min reais), como as missões |
| Defesa sem Bando | Moradores lutam como milícia |
| Ranking | Pontos de guerra |
| Resolução | No servidor (função SQL no Supabase), com o mesmo algoritmo de `combate.js` |

Quem joga sem conta não participa do online.

## 1. Perfil público

Tabela `assentamentos_publicos` (uma linha por jogador, chave `user_id`):

| Campo | Conteúdo |
|---|---|
| `nome`, `nivel`, `xp` | Identidade |
| `pontos`, `vitorias`, `derrotas` | Ranking (alterados só pelo servidor) |
| `visto_em` | Última publicação; online = menos de 5 min |
| `defensores` | Lista `[{ id, nome, atq, def, vida }]` dos combatentes prontos |
| `moradores` | Quantidade de moradores ativos (para a milícia) |
| `bonus_def` | Bônus de defesa do assentamento |
| `baterias` | Baterias do jogador |
| `deposito` | Lista `[{ id, qtd }]` dos itens do depósito (exceto leitura e anotação) |
| `escudo_ate` | Protegido até esta hora (alterado só pelo servidor) |
| `ataques_dia`, `ataques_qtd`, `alvos_dia` | Controle diário de ataques (alterado só pelo servidor) |

- Qualquer jogador logado lê todos os perfis. Ninguém grava direto na tabela: o jogo chama `publicar_perfil`, que só altera a linha do próprio usuário e só os campos que pertencem ao jogador.
- `publicar_perfil` recusa valores impossíveis: no máximo 8 defensores; cada um com Ataque ≤ 17, Defesa ≤ 18, Vida ≤ 70 (Elite com o melhor equipamento); `moradores` ≤ 8; `bonus_def` ≤ 20; `nivel` entre 1 e 8 e coerente com `xp`; `baterias` ≤ 100.000; depósito com até 20 tipos e quantidades ≤ 999.
- O jogo publica o perfil junto com cada salvamento na nuvem (a cada 30 s) e ao abrir a sub-aba Ataques.

## 2. Sub-aba 🌐 Ataques

Nova sub-aba no Assentamento, ao lado de Moradores e Bando:

- **Lista de assentamentos** (todos menos o seu): nome, nível, pontos, selo 🟢 online / ⚫ offline, ⚔️ e 🛡️ estimados (soma dos defensores; milícia se não houver defensores) e o botão **Atacar**.
- O botão fica desativado com o motivo: "fora da sua faixa de nível", "protegido até HH:MM", "já atacado hoje", "limite de 3 ataques hoje", "sem combatentes prontos".
- **Ataques em andamento**: os seus a caminho e os que vêm na sua direção ("⚠️ Ataque a caminho: [nome], chega às HH:MM").
- **Ranking**: 20 primeiros por pontos (desempate por vitórias), com nome, nível, pontos e V/D.
- Lista e ranking são recarregados a cada 30 s com a sub-aba aberta.

## 3. Fluxo do ataque

### 3.1 Partida — `iniciar_ataque(p_alvo, p_time)`

O atacante escolhe o alvo e quais combatentes prontos vão (`p_time`: lista `[{ id, nome, atq, def, vida }]`). O servidor valida, nesta ordem:

1. Atacante autenticado e com perfil publicado; alvo existe e é outro jogador.
2. Diferença de nível ≤ 2.
3. Alvo sem escudo ativo (`escudo_ate` ≤ agora).
4. Dia atual (horário de Brasília): atacante com menos de 3 ataques hoje e sem ter atacado esse alvo hoje.
5. Time com 1 a `min(8, 1 + nivel)` lutadores, cada um dentro dos limites da seção 1.

Se passar: grava em `ataques` (`atacante`, `defensor`, `time_atacante`, `chegada = agora + 5 min`, `semente`, `estado = 'a_caminho'`), atualiza o controle diário do atacante e devolve o ataque. O jogo do atacante coloca esses combatentes em estado `missao` (como numa missão) até o resultado.

### 3.2 Chegada — `resolver_ataque(p_ataque)`

Pode ser chamada pelo atacante ou pelo defensor depois de `chegada`. Se o ataque já foi resolvido, apenas devolve o resultado gravado (idempotente; a linha é travada com `for update` durante a resolução).

1. Lê o perfil **atual** do defensor. Time defensor = `defensores` com `def + bonus_def`; se a lista estiver vazia, a milícia: um lutador por morador (no mínimo 1), cada um ⚔️ 2, 🛡️ `1 + bonus_def`, ❤️ 25.
2. Roda o motor de combate em SQL (seção 4) com `time_atacante` (lado A) contra o time defensor (lado B) e a `semente` do ataque.
3. Se o atacante vencer, calcula o saque a partir do perfil do defensor:
   - Baterias: `min(200, floor(baterias × 0,15))`.
   - Itens: até 3 tipos do depósito, sorteados com o RNG do combate (continuação da mesma sequência), levando `max(1, floor(qtd × 0,25))` de cada.
4. Grava o resultado (`vencedor`, vidas finais de cada lutador, saque, linhas do relatório), `estado = 'resolvido'`.
5. Atualiza os perfis:
   - Pontos: vitória no ataque +10; defesa vencida +5 para o defensor; derrota no ataque −3 (mínimo 0). Vitórias/derrotas para os dois.
   - Defensor: `escudo_ate = agora + 6 h` (ganhando ou perdendo).
   - Defensor: `baterias` e `deposito` do perfil já descontam o saque (para outro ataque não saquear o mesmo valor antes de ele publicar de novo).

### 3.3 Aplicação no save — `marcar_ataque_aplicado(p_ataque)`

Cada lado aplica a sua parte no próprio save e marca que aplicou (`aplicado_atacante` / `aplicado_defensor`), para não aplicar duas vezes:

- **Atacante:** vidas finais dos seus combatentes (vida 0 = morte, com perda do equipamento, como na Etapa 1); estado volta a pronto/ferido; recebe as Baterias (carteira) e os itens (Depósito, ou mochila se não couber); XP +60 na vitória, +10 na derrota; relatório.
- **Defensor:** vidas finais dos combatentes que defenderam (mortes valem); a milícia não morre; perde as Baterias e os itens do saque, limitado ao que tem no momento; XP +50 se defendeu, +10 se perdeu; relatório. Offline, isso acontece ao voltar (relatórios pendentes, como na Etapa 1).

O jogo verifica ataques pendentes (a resolver ou a aplicar, como atacante ou defensor) a cada 30 s, junto com o salvamento automático, e uma vez ao entrar.

## 4. Motor de combate no servidor

Função `simular_combate(time_a jsonb, time_b jsonb, semente bigint)` em PL/pgSQL, reproduzindo exatamente `combate.js`:

- RNG mulberry32 com aritmética de 32 bits feita em `bigint` com máscaras (`& 4294967295`), incluindo `Math.imul`.
- Mesma ordem de consumo do RNG: sorteio do alvo, sorteio erro/crítico, sorteio da variação.
- Mesmas regras: 20% erro, 12% crítico (×2), dano `max(1, round((atq × (0,6 + 0,8 × r) − def × 0,5) × mult))` com arredondamento igual ao `Math.round` do JavaScript, 5 rodadas, recuo abaixo de 25%, empate favorece o lado B.
- Devolve `{ vencedor, motivo, rodadas, lutadores, relatorio }` no mesmo formato de `combate.js`.

`simular_combate_publico(...)`: mesma função exposta para teste de paridade (só cálculo, sem acesso a dados).

## 5. Integração com o código atual

| Arquivo | Mudança |
|---|---|
| `supabase_bando_online.sql` (novo) | Tabelas, RLS, motor em SQL e as funções `publicar_perfil`, `iniciar_ataque`, `resolver_ataque`, `marcar_ataque_aplicado`, `simular_combate_publico` |
| `online.js` (novo) | Publicação do perfil, sub-aba Ataques, envio de ataques, verificação de pendentes, aplicação de resultados |
| `bando-regras.js` | Limites de atributos, constantes do PvP, milícia e `motivoBloqueio(...)` (prévia dos bloqueios para a interface) |
| `script.js` | Ganchos: publicar perfil junto com o salvamento na nuvem; verificar ataques a cada 30 s; "!" na aba com ataque a caminho |
| `index.html` | Carrega `online.js`; terceira sub-aba no Assentamento |
| `style.css` | Lista de alvos, ataques em andamento, ranking |
| `manual.html` | Sub-aba Ataques explicada |

Constantes do PvP (em `bando-regras.js` e espelhadas no SQL): viagem 5 min, escudo 6 h, 3 ataques por dia, faixa de nível ±2, saque 15% (máx. 200) e até 3 itens a 25%, milícia ⚔️ 2 🛡️ 1 ❤️ 25, pontos +10 / +5 / −3, XP +60 / +50 / +10.

## 6. Testes

- **Node:** regras puras (bloqueios, milícia, limites); aplicação de resultados no save com o jogo simulado (vm), para atacante e defensor, incluindo morte, saque maior que o saldo e reaplicação.
- **Paridade:** script `tests/paridade-servidor.js` (executado à mão depois de o SQL estar no Supabase) chama `simular_combate_publico` para centenas de sementes e times e compara com `simularCombate` do `combate.js`: o resultado tem de ser idêntico.
- **Navegador, com duas contas:** atacar; defensor online vê o ataque a caminho e o relatório; defensor offline recebe ao voltar; as quatro proteções; ranking.

## Fora desta etapa

Chat, alianças, interceptar ataques a caminho, economia controlada pelo servidor (a única proteção completa contra quem altera o próprio save).
