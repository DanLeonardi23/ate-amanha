# Bando e identidade do Assentamento — Etapa 1 (local)

Data: 2026-10-11
Status: aprovado em conversa, aguardando revisão do documento

## Objetivo

Dar ao Assentamento uma identidade (nome, nível, Ataque, Defesa) e criar o **Bando**: combatentes recrutados com Baterias, equipados com itens do jogo, que defendem o assentamento contra invasões e saem em missões contra alvos controlados pelo jogo.

Esta é a **Etapa 1**, toda local (sem servidor). A **Etapa 2** (fora deste documento) levará os assentamentos para o online: lista de jogadores, ataques entre jogadores, ranking e combate conferido no servidor. A Etapa 1 deixa o formato de dados e o motor de combate prontos para isso.

## Decisões tomadas

| Tema | Decisão |
|---|---|
| Ordem | Duas etapas: local primeiro, online depois |
| Recrutamento | Mural de recrutas pagos com Baterias |
| Tamanho do Bando | Limitado pelo nível do assentamento |
| Nível | XP ganha com atividades; sobe sozinho |
| Equipamento | 3 encaixes por combatente: arma, cabeça, peito |
| Papel antes do online | Defender contra invasões e fazer missões |
| Morte | Permanente; o equipamento do combatente é perdido |
| Combate | Automático, em rodadas, com relatório |
| Código | `combate.js` (motor puro) + `bando.js` (regras e telas) |

## 1. Identidade do assentamento

Novos campos em `estado.assentamento`:

- `nome` — até 24 caracteres. Pedido ao desbloquear o Assentamento; pode ser trocado depois.
- `xp`, `nivel` — nível inicial 1.

XP acumulada necessária para cada nível: 100, 250, 450, 700, 1000, 1350, 1750 (níveis 2 a 8). Nível máximo 8.

**Ataque e Defesa não são salvos**: são calculados a partir dos combatentes prontos (vivos, não feridos, não parados, fora de missão) com seus equipamentos. A Defesa mostrada no cabeçalho inclui os bônus de defesa do assentamento (seção 4).

Fontes de XP:

| Atividade | XP |
|---|---|
| Construir uma moradia | +30 |
| Acolher um morador | +20 |
| Vencer missão (fácil / média / difícil) | +40 / +80 / +120 |
| Vencer uma invasão | +50 |
| Perder um combate (missão ou invasão) | +10 |

Limite do Bando: `min(8, 1 + nivel)` combatentes (2 no nível 1).

Saves antigos: nome `Assentamento de <nome do personagem>`, nível 1, XP inicial = 30 por moradia existente + 20 por morador existente (podendo já subir de nível).

Tela: cabeçalho no topo da aba Assentamento com nome (editável), nível, barra de XP, ⚔️ Ataque e 🛡️ Defesa. Abaixo, sub-abas **Moradores** (conteúdo atual) e **Bando** (novo).

## 2. Bando

### Combatente

```
{ id, nome, charId, categoria: 'novato'|'veterano'|'elite',
  atqBase, defBase, vida, vidaMax,
  equip: { arma: id|null, cabeca: id|null, peito: id|null },
  estado: 'pronto'|'ferido'|'missao'|'parado',
  diaSoldo, soldoPendente, divida }
```

### Recrutamento

Mural com 3 candidatos, renovado a cada 3 dias (e quando vazio). Sorteio de categoria: Novato 60%, Veterano 32%, Elite 8%.

| Categoria | Ataque | Defesa | Vida | Preço | Soldo (a cada 5 dias) |
|---|---|---|---|---|---|
| Novato | 4 | 2 | 40 | 15–25 🔋 | 5 🔋 |
| Veterano | 6 | 4 | 55 | 35–50 🔋 | 10 🔋 |
| Elite | 9 | 6 | 70 | 70–90 🔋 | 15 🔋 |

Contratar exige vaga no Bando e Baterias suficientes. Nomes e retratos vêm de uma lista própria de combatentes (separada dos moradores).

### Soldo

Mesma mecânica dos moradores: a cada 5 dias aparece a cobrança; enquanto não paga, o combatente não luta nem defende. Recusar deixa o combatente **parado**, com a dívida registrada e o botão "Pagar e reativar".

### Equipamento

Encaixes: arma, cabeça, peito. Usa os itens equipáveis existentes, retirados da mochila ou do Depósito; desequipar devolve à mochila (forçando, se cheia). Os valores de combate ficam na tabela `COMBATE_EQUIP` de `bando-regras.js`:

| Item | Encaixe | Ataque | Defesa |
|---|---|---|---|
| Faca de Cozinha | arma | 3 | 0 |
| Arco Rudimentar | arma | 4 | 0 |
| Lança Improvisada | arma | 5 | 0 |
| Revólver .38 | arma | 5 | 0 |
| Machado de Bombeiro | arma | 8 | 0 |
| Capuz de Lã | cabeça | 0 | 1 |
| Capacete Industrial | cabeça | 0 | 2 |
| Capacete Tático | cabeça | 0 | 5 |
| Jaqueta de Couro | peito | 0 | 2 |
| Colete de Carga | peito | 0 | 1 |
| Colete Balístico | peito | 0 | 7 |

Itens de outros encaixes (mãos, pernas, pés, acessório) não são usados por combatentes nesta etapa.

Dispensar um combatente devolve o equipamento dele à mochila.

### Ferimentos, cura e morte

- Vida perdida em combate permanece até ser curada.
- Vida abaixo de 30% de `vidaMax` → estado **ferido** (não luta nem defende). Volta a **pronto** ao chegar a 30% ou mais.
- Cura diária (no amanhecer), pelo maior valor disponível: +5 sozinho; +15 se houver Médico ativo no assentamento; +25 se houver Médico ativo no Posto Médico.
- Itens de cura da mochila podem ser usados no combatente: cura a mesma quantidade de vida que o item cura no jogador (sem bônus de traço).
- Vida zero → **morte permanente**. O combatente sai do Bando e o equipamento dele é perdido. O relatório registra a morte.

## 3. Motor de combate (`combate.js`)

Funções puras, sem acesso ao estado do jogo:

- `criarRng(semente)` → função que devolve números entre 0 e 1, determinística para a mesma semente.
- `simularCombate(timeA, timeB, semente)` → `{ vencedor: 'A'|'B', rodadas, lutadores, relatorio }`.

Cada lutador: `{ id, nome, atq, def, vida }` (vida atual na entrada). Regras:

1. Até 5 rodadas. Em cada rodada, na ordem alternada A/B, cada lutador de pé ataca um inimigo de pé sorteado.
2. Golpe: 20% de chance de **errar** (dano 0); 12% de chance de **crítico** (dano ×2); nos demais casos, normal. Dano de um golpe que acerta = `max(1, round((atq × (0,6 + 0,8 × rng()) − def_alvo × 0,5) × multiplicador))`. A ordem de consumo do RNG é: sorteio do alvo, sorteio erro/crítico, sorteio da variação.
3. Vida não fica abaixo de 0. Lutador com vida 0 está fora.
4. Fim antecipado: um lado sem lutadores de pé, ou com vida total abaixo de 25% da vida inicial do lado (esse lado **recua** e perde).
5. Após 5 rodadas: vence o lado com maior porcentagem de vida restante (empate favorece o defensor, lado B).

O relatório é uma lista de linhas legíveis (ex.: "Rafa acerta Saqueador 2: 7 de dano"). As vidas finais são devolvidas para o jogo aplicar ferimentos e mortes.

## 4. Missões e defesa

### Missões

Quadro com 3 alvos, renovado a cada amanhecer. Inimigos gerados conforme o nível do assentamento (`n`):

Com `h = ⌊n/2⌋`:

| Alvo | Inimigos | Cada inimigo (Atq / Def / Vida) | Duração real | Recompensa (vitória) |
|---|---|---|---|---|
| Acampamento de saqueadores | 2 + h | 4+h / 1+h / 30+3n | 3 min | 10–20 🔋 + materiais; +40 XP |
| Posto de bandidos | 3 + h | 5+h / 2+h / 36+4n | 6 min | 20–35 🔋 + itens médicos ou armas; +80 XP |
| Depósito militar abandonado | 4 + h | 6+h / 3+h / 42+5n | 10 min | 35–60 🔋 + 30% de chance de item raro; +120 XP |

- O jogador escolhe quais combatentes **prontos** vão (pelo menos 1). Eles ficam em estado **missão**.
- Cada alvo só pode receber uma missão por vez.
- Ao terminar o tempo (inclusive com o jogo fechado, via progresso offline), o combate é resolvido e o relatório é guardado e mostrado.
- Loot vai para o Depósito; sem Depósito, para a mochila (forçando, se cheia). Baterias vão para a carteira.
- Derrota: sem recompensa, +10 XP.

Números calibrados por simulação (3.000 combates por cenário): Bando cheio de Novatos equipados vence o Acampamento até o nível 6; o Posto pede Veteranos; o Depósito militar pede o Bando cheio de Veteranos equipados (≈90% no nível 1, ≈30% no nível 8); no nível 8 só Elites seguram tudo.

### Defesa contra invasões

- O gatilho continua o do saque noturno atual (jogador fora explorando ao anoitecer, com a chance de saque de hoje).
- Se houver combatentes prontos em casa, acontece um combate: Bando (defensores, lado B) contra saqueadores (lado A), com `2 + h` inimigos de Atq `4+h`, Def `1+h`, Vida `30+3n` (h = ⌊n/2⌋).
- Bônus de defesa do assentamento, somado à Defesa de cada defensor: +1 por armadilha instalada, +1 por morador Segurança ativo, +2 se houver Torre de Vigilância com morador.
- Vitória: nada é roubado, +50 XP. Derrota: o saque acontece como hoje; defensores podem se ferir ou morrer; +10 XP.
- Sem combatentes prontos: comportamento atual, sem mudança.
- O relatório da invasão é mostrado quando o jogador volta.

### Relatórios

Os últimos 5 relatórios (missões e invasões) ficam guardados e podem ser reabertos na sub-aba Bando.

## 5. Integração com o código atual

| Arquivo | Mudança |
|---|---|
| `combate.js` (novo) | Motor de combate e RNG com semente |
| `bando.js` (novo) | Identidade, XP, recrutamento, soldo, equipamento, cura, missões, defesa e telas |
| `index.html` | Carrega `combate.js` e `bando.js` antes de `script.js`; sub-abas Moradores/Bando; cabeçalho de identidade |
| `script.js` | Ganchos: `avancarDia` → rotina diária do Bando; `processarSaqueNoturno` → defesa do Bando; construir moradia e acolher morador → XP; save/carregamento; laço de tempo verifica missões concluídas |
| `style.css` | Estilos da identidade, cards de combatente, mural, quadro de missões, relatório |
| `manual.html` | Sub-aba Bando explicada; valores de combate na aba Itens |

Dados novos em `estado.assentamento`: `nome`, `xp`, `nivel`, `bando` (lista de combatentes), `recrutas` (mural e dia da renovação), `missoes` (quadro, missões em andamento com hora de término) e `relatorios`.

## 6. Testes

- **Motor (Node):** mesma semente → mesmo resultado; time mais forte vence a maioria; Defesa reduz dano; recuo abaixo de 25%; dano mínimo 1; vida nunca negativa; empate favorece B.
- **Equilíbrio (Node):** 3.000 simulações por cenário, no nível 1. Metas: 2 Novatos sem equipamento vencem o Acampamento em 75–95%; 2 Novatos com faca e capacete vencem o Posto em 20–50%; 2 Veteranos com lança e capacete tático vencem o Depósito militar em ≥ 80%; 2 Novatos sem equipamento defendem a invasão em 75–95%.
- **Manual (navegador):** roteiro cobrindo recrutar, equipar, missão, ferimento, cura, morte, invasão, soldo e carregamento de save antigo.

## Fora desta etapa

Lista de jogadores online, ataques entre jogadores, ranking, combate conferido no servidor (Etapa 2). Evolução individual dos combatentes (XP por combatente) também fica de fora.
