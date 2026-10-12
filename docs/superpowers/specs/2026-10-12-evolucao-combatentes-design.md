# Evolução dos combatentes do Bando

Data: 2026-10-12
Status: aprovado; plano em docs/superpowers/plans/2026-10-12-evolucao-combatentes.md
Depende de: Bando Etapa 1 (`2026-10-11-bando-assentamento-design.md`) e Etapa 2 (`2026-10-11-bando-online-design.md`), já publicadas

## Objetivo

Combatentes ganham experiência ao sobreviver a combates e podem ser treinados até o nível 5, ficando mais fortes. Isso cria apego ao combatente (o que dá peso à morte permanente) e evita que o Bando fique para trás enquanto os inimigos crescem com o nível do assentamento.

## Decisões tomadas

| Tema | Decisão |
|---|---|
| Forma de evoluir | Níveis 1 a 5 com bônus pequenos; a categoria (Novato/Veterano/Elite) continua sendo a origem |
| Soldo | +2 Baterias por nível acima do 1 |
| Subida | Treino pago com Baterias, liberado quando o XP necessário foi atingido |
| Cálculo | Ataque e Defesa do nível somados na hora (não gravados); vida máxima cresce no treino |

## 1. XP de combate

Ganha XP cada combatente do Bando que **participou e sobreviveu** a um combate:

| Resultado | XP |
|---|---|
| Vitória (missão, defesa contra invasão, ataque online como atacante ou defensor) | +20 |
| Derrota | +8 |
| Morreu no combate | nada |

- A milícia de moradores (online) não é do Bando e não ganha XP.
- O XP acumula sem limite, mesmo antes do treino e depois do nível 5 (só é usado para liberar treinos).

## 2. Níveis, treino e bônus

| Nível | XP acumulado para liberar | Custo do treino | Bônus total sobre a categoria |
|---|---|---|---|
| 1 | — | — | — |
| 2 | 50 | 15 🔋 | +1 ⚔️, +1 🛡️, +5 ❤️ máx. |
| 3 | 120 | 30 🔋 | +2 ⚔️, +2 🛡️, +10 ❤️ máx. |
| 4 | 220 | 50 🔋 | +3 ⚔️, +3 🛡️, +15 ❤️ máx. |
| 5 | 350 | 80 🔋 | +4 ⚔️, +4 🛡️, +20 ❤️ máx. |

- Treinar exige: XP ≥ o valor do próximo nível, Baterias suficientes, combatente fora de missão/ataque e não parado.
- Ao treinar: `nivel + 1`, `vidaMax + 5` e `vida + 5` (o treino também cura os 5 novos pontos). Uma linha no registro: "⭐ [nome] treinou e chegou ao nível N."
- Ataque e Defesa: `statsLutador` soma `nivel − 1` ao Ataque e à Defesa base (antes do equipamento e do bônus de defesa do assentamento).
- Soldo: `soldo da categoria + 2 × (nivel − 1)`.
- Recrutas do mural chegam no nível 1 com 0 XP. Saves antigos: todos os combatentes recebem `nivel = 1` e `xp = 0`.

## 3. Interface

No card do combatente (sub-aba Bando):
- "Nv N" ao lado da categoria.
- Barra fina de XP até o próximo nível (no nível 5, "Nível máximo").
- Quando o treino estiver liberado: botão "⭐ Treinar → Nv N (custo 🔋)", desativado se faltar Bateria.

O relatório de combate passa a listar quem ganhou XP ("+20 XP: Bia, Rafa").

## 4. Limites do online

O pior caso possível passa a ser um Elite nível 5 com Machado, Capacete Tático e Colete Balístico: ⚔️ 9 + 4 + 8 = 21, 🛡️ 6 + 4 + 5 + 7 = 22, ❤️ 70 + 20 = 90.

- `LIMITES_LUTADOR` (bando-regras.js) passa a `{ atq: 21, def: 22, vida: 90 }`.
- No servidor, `_lutador_valido` passa a aceitar Ataque ≤ 21, Defesa ≤ 22 e Vida entre 1 e 90. A mudança vai num arquivo próprio, `supabase_bando_evolucao.sql`, para o usuário rodar no SQL Editor (o `create or replace` mantém as permissões da função). O `supabase_bando_online.sql` também é atualizado para refletir o mesmo valor (fonte única para instalações novas).
- Ordem recomendada: rodar o SQL antes de publicar o jogo. Se o jogo for publicado antes, só combatentes acima dos limites antigos seriam recusados ao atacar, o que leva vários dias de jogo para acontecer.

## 5. Integração com o código atual

| Arquivo | Mudança |
|---|---|
| `bando-regras.js` | Tabela de níveis (XP, custo, bônus), XP por resultado, `podeTreinar`, `soldoDe`, bônus em `statsLutador`, novos `LIMITES_LUTADOR` |
| `bando.js` | `normalizarBando` define `nivel`/`xp`; XP para sobreviventes em missões e invasões; treino; soldo pelo nível; card com nível, barra e botão |
| `online.js` | XP para os combatentes do Bando nos ataques online (atacante e defensor sem milícia) |
| `supabase_bando_evolucao.sql` (novo) e `supabase_bando_online.sql` | Limites novos em `_lutador_valido` |
| `style.css` | Barra de XP e selo de nível no card |
| `manual.html` | Evolução explicada no card do combatente |

## 6. Testes

- **Node (regras):** tabela de níveis, `podeTreinar` (XP, Baterias, estado), soldo por nível, bônus em `statsLutador`, Elite nível 5 com o melhor equipamento dentro dos novos limites.
- **Node (bando.js / online.js com o jogo simulado):** sobreviventes ganham +20/+8 e mortos não; treino desconta Baterias, sobe nível, vida máxima e vida; treino bloqueado sem XP ou Baterias; save antigo ganha nível 1; XP nos ataques online para o lado do jogador.
- **SQL (PGlite):** `_lutador_valido` aceita 21/22/90 e recusa 22/23/91; paridade continua 600/600; cenários continuam passando.
- **Produção:** `node tests/paridade-servidor.js` continua 200/200.

## Fora desta etapa

Habilidades especiais por combatente, especializações (atirador, tanque), aposentadoria de veteranos e treino que não seja com Baterias.
