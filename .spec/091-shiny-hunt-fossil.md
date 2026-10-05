# Spec 091 — Shiny Hunt: Fossil

Status: implementada e validada localmente em Ubuntu WSL2 em 2026-10-05; diálogo real de NPC ainda não ensaiado.

## Objetivo e contrato

Acrescentar somente **Fossil** ao grupo **2. Iniciar encounter** do modal existente. O usuário salva diante do NPC no ponto em que a conversa entrega o Pokémon e deixa uma vaga no grupo. Interpretar o botão mencionado no pedido como **A**. Não automatizar entrega inicial do fóssil, deslocamento ou diferenças de diálogo por jogo.

Selecionar Fossil define `startMode: 'fossil'` e `resetMode: 'soft-reset'`; desabilitar **Sair do encounter** enquanto Fossil estiver selecionado. Rejeitar a combinação incompatível também no controlador e no player. Preservar condições de parada **Apenas um shiny** / **Todos shiny**, 1–9 players, RNG, navegação de boot e persistência existentes.

Depois do soft reset e dos quatro A existentes de navegação, capturar uma baseline do grupo no comando `begin`. Executar **A, A, A, A, A, B, B**, com down/up explícitos: **120 ms** pressionado e **400 ms de espera após soltar**, inclusive após o último B antes da leitura. O intervalo é uma espera real mínima; atrasos não geram rajadas. Não ler/encerrar antecipadamente quando o NPC criar o Pokémon durante um A: completar os dois B primeiro.

Ler o último registro ocupado do grupo do jogador, nunca o adversário. Os layouts de ROM/runtime verificados já fornecem `playerAddress`; seis registros PartyPokemon têm passo de 100 bytes e núcleo de 80 bytes. Decodificar o grupo contíguo até o primeiro registro vazio, como a contagem de grupo dos jogos. Verificar estado, espécie e checksum com o decoder existente. Capturar cópia dos seis registros como baseline; só aceitar um registro acrescentado ao final do grupo desde `begin`. Alterações de HP/nickname/registro de Pokémon antigos não comprovam recebimento. Grupo cheio bloqueia a caça Fossil antes da conversa; registro inválido ou estado incompatível falha com segurança.

Resultado shiny usa a parada e o salvamento existentes. Resultado normal conta uma tentativa e reinicia somente os players ativos. Ausência de registro novo permanece pending, usa a espera limitada existente e interrompe por timeout sem contar nem salvar. Cancelamento solta o botão atual e impede comandos posteriores. O leitor só observa RAM; não escreve save, Pokémon ou flags.

## Fontes e limites

- [pret/pokefirered — GiveMonToPlayer e CalculatePlayerPartyCount](https://github.com/pret/pokefirered/blob/master/src/pokemon.c): entrega no primeiro slot vazio e contagem contígua até espécie vazia. Esta spec usa esse contrato com os endereços já verificados do projeto, sem introduzir novos endereços de memória.
- [pret/pokeruby — arranjos de grupo](https://github.com/pret/pokeruby/blob/master/sym_common.txt): seis PartyPokemon somam 600 bytes.
- A sequência é a solicitada pelo usuário, sem confirmação de todos os diálogos de NPC nos cinco jogos. Testes com estados controlados não comprovam o diálogo em gameplay real.

## Responsabilidades

- `apps/frontend/src/main.jsx`: opção de apresentação, seleção e mensagens; nenhum algoritmo de leitura.
- `apps/packages/shiny-hunt-start-sequence.mjs`: roteiro Fossil compartilhado.
- `apps/packages/pokemon-gen3-encounter.mjs`: baseline/leitura do último novo membro.
- `apps/packages/shiny-hunt-player.mjs`: baseline por ciclo, validação de ordem, gate até os dois B.
- `apps/packages/shiny-hunt-controller.mjs`: compatibilidade e execução completa com espera após cada release.

## Plano de implementação e validação

Execução nesta sessão, no checkout original `D:/PROJETOS/emulator-hub`, branch `master`, HEAD inicial `bfd0722255e632b0abe19ffd4fa2f936d4a39d83`. Existem alterações locais preexistentes, inclusive main.jsx, player e encounter; preservá-las. Sem commit, push, build ou deploy pedidos nesta tarefa.

- [x] Escrever regressões do leitor para os cinco game codes, grupos de 1–5 antes do recebimento, último Pokémon normal/shiny, adversário shiny ignorado, grupo antigo inalterado/alterado, checksum inválido e grupo cheio.
- [x] Escrever testes de player para rejeição de combinação inválida, baseline em begin, ordem A×5/B×2, inspeção bloqueada antes do último release e cancelamento.
- [x] Escrever testes de controlador para timing 120/400, normal→reset→shiny, timeout sem contagem e parada durante B; testar seleção Fossil na interface existente.
- [x] Executar testes novos em Ubuntu WSL2 e confirmar falhas pela ausência do recurso. Os testes de packages falharam pelos contratos ausentes; o primeiro ensaio frontend encontrou binding Linux ausente, reparado antes da validação da UI.
- [x] Implementar os contratos acima nos cinco arquivos de produção, mantendo os fluxos anteriores.
- [x] Executar suíte Node dos packages e testes frontend, lint frontend e revisão dos diffs. Registrar resultados e limitações aqui.

## Foco de revisão

Confusão entre inimigo e jogador; Pokémon antigo shiny; leitura antes dos dois B; grupo cheio/record inválido; release em stop; baseline recapturada em cada ciclo; atraso de timers; preservação das alterações preexistentes.

## Evidências finais

- `node --test --test-reporter=spec apps/packages/*.test.mjs apps/frontend/*.test.mjs`, em Ubuntu WSL2 no checkout original: **1.047 passed, 0 failed**. Inclui 13 testes Fossil, dois integrando controlador/player/leitor reais em nove players nas condições first-shiny/all-shiny. Os estados controlados carregam um Pokémon antigo shiny entre reset e begin; cada novo recebimento só é aceito ao completar os sete inputs. No modo all-shiny, os nove players completam em 13 tentativas válidas, com cinco concluindo no primeiro ciclo e quatro no segundo.
- `node node_modules/eslint/bin/eslint.js .`, no frontend em Ubuntu WSL2: exit 0. O wrapper `npm run lint` inicialmente tentou `node.exe`; a execução direta usa o mesmo ESLint/configuração com Node Linux.
- `git diff --check`: exit 0, somente avisos de conversão LF/CRLF.
- Revisão independente somente leitura: nenhum defeito acionável específico de Fossil; confirmou os 11 testes iniciais. As duas integrações adicionais cobrem as oportunidades apontadas de baseline após boot e múltiplos players.
- O primeiro ensaio amplo apresentou quatro falhas de `profile-info-editor.test.mjs` causadas pelo contrato local preexistente de `openProfileInfo`; outra tarefa atualizou os respectivos testes durante esta sessão. Nenhuma correção desse fluxo foi feita nesta tarefa. As execuções finais acima passaram no checkout atual.
- Instalação WSL dos opcionais nativos com `npm install --no-save --package-lock=false --ignore-scripts --include=optional`; package.json e lockfile preservados.
- Não executados: build, gameplay real de fossil/NPC, commit, push ou deploy. Não inferir compatibilidade de todos os diálogos pelo sucesso com fixtures.

## Publicação solicitada em 2026-10-05

O usuário solicitou commit geral dos arquivos rastreados, push e deploy na VPS. Incluir todas as alterações rastreadas e os módulos/testes novos exigidos pelos imports e pelo build, junto das specs 089 (implementação previamente entregue) e 091. Preservar fora do commit as specs 087, 088 e 090 de planejamento, sem código associado nesta publicação. Trabalhar no checkout original.

Validação ampliada em Ubuntu WSL2 usando Node 26.10.0 (versão do backend da VPS): `node --test --test-isolation=none --test-reporter=spec apps/backend/test/*.test.mjs apps/packages/*.test.mjs apps/frontend/*.test.mjs apps/frontend/server/*.test.mjs deploy/*.test.mjs`: 1.167 testes, 1.166 passaram, zero falhas, um skip (`real Redis executes independent leases, atomic movements and durable session publication`, exige Redis real de teste). `npm run build` frontend passou com lint, geração/verificação de recursos e Vite. O build local usou o Node Linux disponível após reconstrução dos binários npm; o build das imagens usa Node 26 e é a validação final de runtime.

Deploy: SSH do usuário `deploy`, checkout `/home/deploy/emulator-hub`; containers frontend/backend em Compose, Caddy e Redis externos. Preservar alterações de fonte preexistentes da VPS em snapshot Git com paths explícitos, sem incluir ROMs, backups ou dotenv. Construir novas imagens antes da troca, manter imagens anteriores para rollback, confirmar leases ativos, pedir backup do backend e comparar todos os hashes de saves/snapshots após a ativação. Não remover o lock antigo do Pokémon Hub.

### Decisões mantidas após revisão

- Grupo contíguo até primeiro slot vazio: segue o contrato Gen III das fontes; um estado com buraco no grupo não é validado como um grupo arbitrariamente disperso.
- Primeiro shiny salva todos os players, incluindo os interrompidos: preserva a política existente de snapshots. O snapshot de um player interrompido pode mostrar conversa incompleta.
- Races de reset/cancel e ordenação de comandos externos continuam sujeitos ao protocolo existente. Esta mudança cobre liberação de input e rejeição de comandos após cancelamento, sem reestruturar o protocolo.
- Sequência fixa de NPC conforme pedido: se o save não estiver no ponto correto ou o diálogo precisar de mais passos, termina por timeout sem contabilizar um recebimento. Gameplay continua sendo o limite material de validação.
