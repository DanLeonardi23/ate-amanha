# Vício como dependência (redesenho)

Data: 2026-10-12
Status: aprovado; plano em docs/superpowers/plans/2026-10-12-vicio-dependencia.md

## Objetivo

Hoje o vício quase nunca importa: cai rápido (cerca de 21 por dia de jogo) e o dano vem quando ele está *alto*, logo depois de beber. Por isso parar é sempre a melhor escolha e não há tentação. O redesenho transforma o vício numa **tentação com preço**: beber alivia o estresse na hora, mas cria dependência; com o tempo cada dose rende menos (tolerância), e ficar sem usar dá abstinência. Livrar-se exige tempo, e um Médico no assentamento ajuda.

## Decisões tomadas

| Tema | Decisão |
|---|---|
| Papel do vício | Tentação com preço: dependência, tolerância e abstinência ao parar |
| Substâncias | Álcool (Bebida, Whisky 18 Anos) e Analgésico (vicia pouco) |
| Tratamento | Tempo sem usar + morador Médico no assentamento |
| Itens novos | Nenhum |

Um dia de jogo = 420 s (300 de dia + 120 de noite); o loop roda a cada 1 s.

## 1. Dependência

A barra continua sendo `estado.stats.vicio` (0–100), exibida como **Vício** (o manual explica que ela mede a dependência).

| Item (id) | Dependência por dose |
|---|---|
| Bebida Alcoólica (`bebida`) | +12 |
| Whisky 18 Anos (`whisky_fino`) | +25 |
| Analgésico (`remedio`) | +4 |

- A dose continua em `efeitos.vicio` de cada item em `ITENS` (fonte única, e as dicas dos itens seguem mostrando "+N vício"): a Bebida passa de 10 para 12 e o Analgésico ganha 4. Os demais efeitos dos três itens ficam iguais. Em `usarItem`, `vicio` deixa de ser somado direto e vira a dose.
- A dependência **cai continuamente** 12 por dia de jogo (`12 / 420` por segundo). Com um Médico ativo, cai o dobro.

## 2. Abstinência

- Novo contador `estado.stats.semUso` (segundos desde a última dose de qualquer uma das três substâncias). Zera a cada dose. Sobe 1 por segundo no loop.
- Há abstinência quando `vicio >= 25` **e** `semUso >= 210` (meio dia de jogo).
- Estágio pela dependência:

| Estágio | Dependência | Por segundo em abstinência |
|---|---|---|
| Leve | 25–49 | estresse +0,04 |
| Moderada | 50–74 | estresse +0,08 |
| Grave | 75–100 | estresse +0,12 e vida −0,05 |

- O aumento de estresse respeita o multiplicador de estresse do traço (`estresseMulti`), e a perda de vida respeita `vidaDecay`, como hoje.
- Com um Médico ativo, os efeitos da abstinência caem pela metade.
- Morte: a causa "abstinência" só aparece se o personagem morrer em abstinência grave (substitui a regra atual `vicio > 70`).

## 3. Tolerância

- Ao usar uma das três substâncias, a **redução de estresse** é multiplicada por `1 − 0,5 × (vicio / 100)`, usando a dependência **antes** da dose (100 de dependência = metade do alívio). Arredondado para inteiro.
- Os outros efeitos (vida da Bebida/Whisky, cura do Analgésico) não mudam.

## 4. Médico

"Médico ativo" = algum morador do assentamento com habilidade Médico (`habCanonica(npc.habilidade) === 'medico'`) e `npcAtivo(npc)`, em qualquer moradia. O Médico no Posto Médico continua curando vida à noite, como hoje.

## 5. Fora do jogo

Em `aplicarProgressoOffline`, a dependência cai pelo tempo efetivo ausente (com o bônus do Médico se houver) e `semUso` soma esse tempo. A abstinência não causa efeito fora do jogo (o personagem nunca morre offline, como hoje); ao voltar, se a condição de abstinência valer, os efeitos recomeçam no loop.

## 6. Interface

- **Avisos** (no lugar dos dois atuais de vício):
  - Em abstinência: "🍶 Abstinência leve/moderada/grave: beber alivia, ficar limpo cura" (leve = alerta, moderada e grave = perigo; grave acrescenta "drenando vida").
  - Dependente sem abstinência (`vicio >= 25`): "💊 Dependente: abstinência em N min sem usar" (alerta), com N arredondado para cima.
- **Manual**: texto da barra Vício reescrito (dependência, tolerância, abstinência por estágio, Médico) e os textos dos itens Bebida, Whisky e Analgésico atualizados.

## 7. Saves antigos

O `vicio` guardado vira a dependência atual. `semUso` ausente começa em 0.

## 8. Integração com o código

| Arquivo | Mudança |
|---|---|
| `vicio-regras.js` (novo) | Regras puras: constantes, `estagioDependencia`, `estagioAbstinencia`, `tickVicio`, `aliviarComTolerancia`, `aplicarDose`, `minutosParaAbstinencia`; exporta para Node como `bando-regras.js` |
| `index.html` | Carrega `vicio-regras.js` antes de `script.js` |
| `script.js` | Doses em `ITENS` (Bebida 12, Analgésico 4); `usarItem` aplica tolerância, dose e zera `semUso`; `atualizarStatus` usa `tickVicio`; avisos; causa da morte; `aplicarProgressoOffline`; save antigo |
| `manual.html` | Textos do Vício e dos itens |

## 9. Testes

- **Node (regras puras):** dose (soma até 100 e zera o tempo sem usar); queda por segundo com e sem Médico; abstinência só com `vicio >= 25` e `semUso >= 210`; estágios e efeitos por estágio; metade dos efeitos com Médico; tolerância (0 → alívio cheio, 100 → metade); minutos até a abstinência.
- **Node (jogo simulado com `script.js` não é viável hoje):** a integração em `script.js` fica coberta pela revisão de código e por teste no navegador pelo usuário (beber várias vezes, esperar a abstinência, ver os avisos e o alívio menor).

## Fora desta etapa

Itens novos (cigarro, calmante), tratamento por item, efeitos de abstinência sobre exploração ou combate.
