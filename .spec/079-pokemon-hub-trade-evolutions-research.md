---
title: Pokémon Hub — investigação de evoluções por troca
date: 2026-09-27
tags: [spec, pokemon-hub, gen3, trade-evolution, research]
status: research-draft
relates: [024-pokemon-hub-record-model-and-snapshot-transport.md, 035-generation-iii-regional-transfer-gates.md, 063-gen3-party-save-materialization.md, 078-pokemon-hub-pokemon-card-and-save-data.md]
---

# Spec 079 — Evoluções por troca no Pokémon Hub (esboço de investigação)

## Intenção

Permitir que um Pokémon elegível evolua quando for transferido entre saves pelo Pokémon Hub. Preferimos que o jogador veja a evolução dentro do jogo. Se isso não puder ocorrer com fidelidade e segurança nos jogos suportados, o Hub apresenta a evolução e persiste o resultado no save de destino. O resultado deve ser uma evolução real no registro e nos dados relevantes do save, nunca apenas uma animação ou troca de sprite.

Este documento investiga o recorte inicial Ruby, Sapphire, Emerald, FireRed e LeafGreen, usando o adapter `gen3-gba-v1`. Ainda não autoriza implementação ou modifica o comportamento existente.

## Resposta à pergunta técnica

**Não. Nos cinco títulos originais, inserir um Pokémon no `.sav`, colocá-lo no PC e depois retirá-lo para a Party não dispara a evolução por troca.** Não há no registro nativo de 80/100 bytes uma flag persistida de “evoluir ao retirar”. O jogo consulta a espécie e, quando necessário, o item segurado **durante o fluxo de troca**; se a condição for satisfeita, chama a cena de evolução naquele momento. O registro nativo contém flags com outros significados, como ovo, mas nenhuma delas é um pedido pendente de evolução por troca. A [estrutura do Pokémon de Emerald](https://github.com/pret/pokeemerald/blob/master/include/pokemon.h) permite conferir esses campos.

| Títulos suportados | Evidência da avaliação | Evidência do gatilho | Retirada do PC |
| --- | --- | --- | --- |
| Ruby e Sapphire | O [código compartilhado de Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/pokemon_3.c) usa `GetEvolutionTargetSpecies` com modo `1` para `EVO_TRADE`/`EVO_TRADE_ITEM`, distinto do modo normal `0`. | O [fluxo de troca](https://github.com/pret/pokeruby/blob/master/src/trade.c) chama o modo de troca para o Pokémon recebido e, havendo alvo, `TradeEvolutionScene`. | Os arquivos `pokemon_storage_system*.c` de Ruby/Sapphire movimentam Pokémon e não chamam `GetEvolutionTargetSpecies` nem `TradeEvolutionScene`. |
| Emerald | O [avaliador de evolução](https://github.com/pret/pokeemerald/blob/master/src/pokemon.c) usa `EVO_MODE_TRADE` para os dois métodos de troca. | O [fluxo de troca](https://github.com/pret/pokeemerald/blob/master/src/trade.c) consulta o Pokémon recebido e inicia `TradeEvolutionScene`. | `Task_WithdrawMon` no [sistema de PC](https://github.com/pret/pokeemerald/blob/master/src/pokemon_storage_system.c) executa a movimentação Box→Party e não invoca o avaliador de troca. |
| FireRed e LeafGreen | O [código compartilhado de FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/src/pokemon.c) também separa `EVO_MODE_TRADE` do modo normal e contém verificações próprias de título/progresso. | `CB2_TryLinkTradeEvolution` no [fluxo de troca](https://github.com/pret/pokefirered/blob/master/src/trade_scene.c) consulta o Pokémon recebido e inicia `TradeEvolutionScene`. | `Task_WithdrawMon` no [sistema de PC](https://github.com/pret/pokefirered/blob/master/src/pokemon_storage_system_tasks.c) movimenta Box→Party e não invoca o avaliador de troca. |

Conclusão para o Hub atual: **transferir bytes para o save de destino não aciona a animação nativa depois**. Para vê-la dentro do jogo seria necessário iniciar de fato o fluxo de troca do jogo ou um mecanismo novo que invocasse sua cena em runtime; nenhum dos dois existe no produto hoje. Não há um bit no `.sav` que o Hub possa simplesmente marcar para dispará-la ao abrir o PC. A checagem estática acima responde ao comportamento dos jogos originais; um teste com ROMs verificadas pode confirmar no emulador, mas não é pré-requisito para essa conclusão.

## Situação atual e premissas

- O Hub já transporta registros nativos de Pokémon e materializa Party/Boxes no `.sav` com revisão, lease e flush. Esse movimento é uma transferência de dados; não executa a sequência de troca por cabo dos jogos. O snapshot atual troca *placements* e mantém a identidade `pokemonInstanceId`; não representa uma troca link bidirecional com animações dos dois consoles.
- A Spec 035 define elegibilidade de transferência entre saves e nas fronteiras do Hub. Evolução só pode ser avaliada **depois** dessas validações; ela não torna válida uma transferência rejeitada nem dispensa validação do save.
- O core Gen III guardado pelo Hub contém espécie, item segurado, experiência, OT, PID e outros campos necessários para avaliar parte das evoluções. O parser já lê espécie e item, mas não existe hoje um editor de evolução do core cifrado. A Spec 078 registra que o decoder de adoção ainda precisa de conferência de checksum interno para certos usos.
- A hipótese de que dois Pokémon não evoluem no mesmo level up não resolve o problema: no código original, evolução por level up e evolução por troca são modos distintos. Em uma troca link real, cada jogo verifica o Pokémon que recebeu. Não extrapolar uma limitação de level up para o fluxo de troca.

## Evidência inicial dos jogos e do emulador

1. O [código de Emerald para evolução](https://github.com/pret/pokeemerald/blob/master/src/pokemon.c) separa `EVO_MODE_NORMAL` de `EVO_MODE_TRADE`; o modo de troca aceita `EVO_TRADE` e `EVO_TRADE_ITEM`. O item exigido é consumido nesse caminho. O mesmo código bloqueia evolução por Everstone antes dessa escolha de modo. As constantes estão [aqui](https://github.com/pret/pokeemerald/blob/master/include/constants/pokemon.h).
2. Os fluxos de troca dos cinco títulos chamam o avaliador para o Pokémon recebido e iniciam `TradeEvolutionScene` quando há alvo, conforme a tabela acima. O gatilho nativo está acoplado à sequência de troca, não a uma evolução pendente gravada no registro do Pokémon.
3. A [cena de evolução de Emerald](https://github.com/pret/pokeemerald/blob/master/src/evolution_scene.c) mexe em espécie, Pokédex e aprendizado de moves. Logo, uma edição externa fiel precisa inventariar os efeitos secundários; alterar só a espécie é insuficiente.
4. A [documentação do Emulator.js](https://emulatorjs.org/docs4devs/cores/) lista mGBA como core GBA. A [FAQ do mGBA](https://mgba.io/faq.html) descreve suporte parcial a link cable. **Isso não prova** que a build WebAssembly e as instâncias isoladas usadas por este projeto consigam trocar entre si. Essa capacidade exige prova local antes de ser tratada como solução.

## Alternativas a investigar

| Caminho | Experiência | Benefício | Custo ou limite decisivo |
| --- | --- | --- | --- |
| A. Troca link nativa | Dois jogos executam a troca e a cena de evolução. | Máxima fidelidade; o jogo controla os efeitos. | Exige comunicação entre instâncias e uma transação de dois saves. O projeto não possui esse canal hoje; o suporte mGBA WebAssembly precisa de prova. É um subsistema maior que esta feature. |
| B. Gatilho nativo sem troca link | Hub move o registro e faz o jogo abrir sua cena nativa mediante mecanismo comprovado. | Preserva a cena no jogo sem criar cabo virtual. | O código visto até agora não mostra um marcador persistente de “evolução por troca pendente”. Alterar RAM, callback ou ROM seria dependente de título/build e pode afetar snapshots e integridade. Só considerar após prova reproduzível em ROM verificada. |
| C. Evolução autoritativa no Hub | O backend avalia regra Gen III, transforma o registro, salva o destino e o Hub apresenta a evolução. | Funciona com o fluxo de saves existente e permite tratar ambos os Pokémon independentemente. | Precisamos definir o que conta como “troca”, editar com segurança o core cifrado, tratar item, stats/Party, moves, Pokédex e possíveis escolhas do jogador. A apresentação é do Hub, não a cena original do jogo. |

**Direção provisória:** pesquisar A e B com testes pequenos, sem fazer deles pré-requisito para C. Se não houver prova de um gatilho nativo estável no ambiente atual, projetar C como primeira entrega. Uma futura troca link nativa pode coexistir, mas deve ter protocolo próprio para evitar evolução duplicada.

## Questões que definem o contrato

1. **Evento de troca:** a evolução acontece apenas ao passar de um save de jogo a outro? Um depósito game→Hub e uma retirada Hub→game são dois passos de armazenamento, não uma troca simultânea. Proposta inicial: nenhum deles evolui isoladamente; uma transferência direta entre dois saves distintos pode ser o gatilho. Requer decisão de produto antes da spec final.
2. **Troca unilateral ou recíproca:** o Hub hoje permite deslocamento de um Pokémon. Se duas espécies elegíveis cruzarem entre dois saves, ambas devem poder evoluir, cada uma no save que a recebeu. É necessário especificar se isso significa duas operações independentes ou uma operação recíproca atômica, e como o Hub representa espaço livre, Party e falha parcial.
3. **Momento:** avaliar elegibilidade e efeitos a partir do registro pré-transferência e das regras do jogo de destino; só apresentar sucesso após persistência confirmada do(s) save(s). Uma falha de flush não pode exibir evolução concluída.
4. **Regras:** construir matriz versionada de espécies Gen III e modos `EVO_TRADE`/`EVO_TRADE_ITEM`, com item correto, Everstone, Egg, espécies não suportadas e diferenças entre títulos. Não inferir elegibilidade apenas por espécie ou pelo nome do Pokémon.
5. **Efeitos do jogo:** definir espécie, consumo do item, checksum do Pokémon, stats e HP de Party, moves aprendidos na evolução, Pokédex visto/capturado, possíveis prompts de substituição de move, identidade/OT/PID/shiny/EVs/IVs/ribbons/nickname, met data, revisão e proveniência. Confirmar por fixtures e pelo código dos cinco títulos o que realmente muda. Não presumir que copiar o core de 80 bytes e alterar dois campos basta.
6. **Cancelamento e escolha:** decidir se a evolução no Hub é automática ou se existe confirmação/cancelamento e, havendo moves novos com quatro slots ocupados, qual é a interação. A decisão deve ser feita antes de gravar e ser recuperável após reconexão.
7. **Snapshots:** uma edição de espécie/item no `.sav` precisa atualizar também o record autoritativo do Hub e invalidar representações antigas. Snapshot de emulador anterior à mudança não pode restaurar silenciosamente o Pokémon pré-evolução sobre o `.sav` atualizado.
8. **Limites:** ROM hacks, versões alteradas, outros formatos de save e gerações futuras não herdam automaticamente regras Gen III. Só aplicar a política quando ROM, título e adapter forem verificados; falhas deixam a transferência original íntegra segundo uma política explícita a definir.

## Invariantes de integridade propostos

- Evolução é parte da mesma decisão de transferência quando suportada: ou o destino contém o resultado validado e o record correspondente, ou não se anuncia evolução. Se não houver forma segura de persistir todos os efeitos exigidos, a transferência não deve produzir um Pokémon parcialmente evoluído.
- Identidade lógica `pokemonInstanceId` continua a mesma; a representação nativa muda com revisão e hash novos. Dados de OT, PID e proveniência não podem ser regenerados.
- Validação de setor, checksum do core, seleção da cópia de save e fence de revisão continuam obrigatórios. O browser nunca fornece bytes finais do Pokémon ou flags de Pokédex.
- Uma transferência que não é evolução segue o fluxo existente. Uma ROM não suportada não recebe evolução por aproximação.
- Se no futuro existir link nativo, o sistema precisa distinguir evolução já realizada pelo jogo daquela calculada pelo Hub para impedir aplicação dupla.

## Provas necessárias antes da spec implementável

1. Criar fixtures locais **não vazias e descartáveis** para cada título suportado, com Pokémon sem item, com item exigido e Everstone. O material `test-data/*.sav` auditado na Spec 078 não cobre esses casos. Registrar hash de ROM/fixture e nunca usar save de produção para experimentar edição.
2. Executar uma troca link em ambiente de referência com dois saves controlados e registrar bytes antes/depois nos dois lados: espécie, item, core checksum, Party stats/HP, moves, Pokédex, save sectors e evolução sequencial de dois Pokémon elegíveis. Isto é base de comparação; não assume suporte no Emulator.js.
3. Verificar se o core mGBA/WebAssembly realmente expõe link entre instâncias isoladas no player atual. Resultado possível: não expõe; nesse caso encerrar A para esta etapa.
4. Confirmar em ROMs verificadas o comportamento deduzido do código: inserir externamente um Pokémon elegível no save, carregá-lo, retirá-lo da Box e subir de nível não deve produzir a **cena de evolução por troca**. Este teste valida a integração do emulador; a ausência de flag e de gatilho no PC já está estabelecida pelo código original dos cinco títulos.
5. Prototipar **fora do caminho de produção** um transformador de core de um Pokémon e validar round-trip por decoder independente, incluindo item consumido, checksum do core, setor e recuperação após falha. Só depois detalhar contrato de pacote/backend/UI.
6. Comparar o protótipo com o save produzido pela troca real e decidir quais efeitos precisam ocorrer no momento da transferência, quais exigem escolha do usuário e se há algum efeito que inviabiliza C com fidelidade aceitável.

## Critério para fechar a pesquisa

A spec final deve escolher o gatilho de produto, o caminho de apresentação, a semântica para dois Pokémon elegíveis, todos os efeitos persistidos e a política de falha. Deve conter evidência reproduzível por título, contrato dos pacotes em `apps/packages/`, responsabilidades do backend/frontend e critérios de aceite. Até lá, este é um esboço de investigação, não um plano de implementação.
