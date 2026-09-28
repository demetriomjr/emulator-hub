---
title: Pokémon Hub — card individual e dados do save
date: 2026-09-27
tags: [spec, pokemon-hub, gen3, saves, records, frontend]
status: draft-for-expansion
---

# Spec 078 — Card de Pokémon e fidelidade dos dados do `.sav`

## Intenção e recorte inicial

Ao selecionar um Pokémon em uma Party, Box ou perfil do Pokémon Hub, mostrar uma view em formato de card com o sprite e as informações desse indivíduo. O mesmo Pokémon deve apresentar os mesmos dados quando estiver no save ou armazenado no Hub. O primeiro recorte pesquisado é o adapter `gen3-gba-v1` para Ruby, Sapphire, Emerald, FireRed e LeafGreen; outros formatos exigirão contrato próprio. Este documento é um esboço para expandir o contexto antes da implementação.

O card deve contemplar espécie/sprite, shiny, nível, sexo do Pokémon, stats, quatro moves, ribbons, ID do treinador original (OT), jogo de origem registrado no Pokémon, tipo de Pokébola e item segurado. Quando não houver item, mostrar ausência. O backend deve indexar o ID técnico do profile de save em que esse Pokémon foi primeiro observado, como proveniência; o nome do profile fica fora da view. Esse ID indica o primeiro profile conhecido pelo Hub, não necessariamente o profile em que o Pokémon nasceu. O card apenas lê; não altera Pokémon, save ou movimentação.

"Jogo de origem" significa o campo nativo `metGame`/origin game do Pokémon, quando decodificável. O `gameId` do arquivo `.sav` em que ele foi observado pela primeira vez é proveniência do Hub, e pode ser diferente do jogo de origem depois de uma troca. Os dois valores não devem ser confundidos. O campo nativo de Pokébola indica o tipo associado ao Pokémon; para presentes, ovos e importações, a view não deve afirmar que houve captura nessa bola.

## Estado verificado no repositório

| Etapa | Hoje | Lacuna para o card |
| --- | --- | --- |
| Leitura do `.sav` | `pokemon-gen3-adapter.mjs` localiza Party e 14 Boxes, lê 100 bytes por Pokémon da Party e 80 por Box, decripta o core de 48 bytes e projeta espécie, shiny e ovo. `readSlot` também expõe personalidade e OT ID, incluindo trainer ID e secret ID. | `readAllSlots` não projeta nível, sexo, stats, moves, ribbons, jogo nativo de origem, bola nem item. |
| Adoção no Hub | `pokemon-hub-save-adoption.mjs` envia todos os slots ao coordinator. `pokemon-hub-snapshot-coordinator.mjs` persiste, por `pokemonInstanceId`, a representação nativa completa em Base64 com SHA-256, display resumido e proveniência (`originSourceKey`, revisão, primeiro avistamento). | Os bytes estão preservados, mas os campos solicitados não existem no display atual. A proveniência é da fonte observada; não é automaticamente a origem nativa do Pokémon. |
| Transporte e UI | O snapshot e os slots expõem `pokemonDisplay` resumido; `pokemon-hub-ui.jsx` usa esse display e renderiza sprites locais por espécie/shiny. | As respostas de carregamento de perfil precisam incluir a projeção completa do card de todos os Pokémon ocupados daquele perfil. O snapshot de movimentação continua enxuto, conforme Spec 024. |
| Código legado | `pokemon-hub-service.mjs` define `canonical` com espaços para moves/stats/ribbons, mas preenche quase tudo com valores vazios ao transferir. | Não tratar esse schema aspiracional como prova de que os dados foram decodificados. Identificar consumidores dessa rota antes de definir migração. |

Conclusão da auditoria de código: **os bytes nativos de cada Pokémon adotado são copiados para o record do Hub; os campos para o card ainda não são todos extraídos, indexados nem expostos.** Isso é uma conclusão sobre os caminhos lidos, não uma auditoria de todos os records já existentes em produção. A integridade histórica de cada record exige comparação com seu source e, quando aplicável, com o `.sav` correspondente.

## Pesquisa inicial do formato Gen III

O `BoxPokemon` de 80 bytes contém personalidade, OT ID, nickname e um payload cifrado em quatro subestruturas. O `Pokemon` da Party acrescenta 20 bytes de estado de runtime. As definições do [decomp de Emerald](https://github.com/pret/pokeemerald/blob/master/include/pokemon.h) mostram os campos abaixo:

| Informação | Fonte no registro | Interpretação inicial |
| --- | --- | --- |
| Shiny | personalidade + OT ID | Já calculado pelo adapter; conferir com fixtures de cada título. |
| ID do OT | `otId` | Já decodificado no caminho `readSlot`; exibir o Trainer ID público, preservando o valor completo no backend. Secret ID não precisa ir ao card. |
| Item segurado | `Growth.heldItem` | ID 0 = sem item; nome depende de catálogo do título, sem inventar nome para ID desconhecido. |
| Nível | Party guarda `level`; Box guarda experiência em `Growth.experience` | Para Box/Hub, derivar nível da experiência e growth rate da espécie/título. Para Party, validar coerência entre byte de nível e experiência antes de escolher a projeção. O projeto já tem cálculo de experiência→nível em `pokemon-gen3-party-data.mjs`. |
| Stats | Party guarda HP, ataque, defesa, velocidade, ataque especial e defesa especial; core guarda IVs e EVs | O card mostra os seis stats e os seis IVs. HP atual/máximo só é mostrado como estado atual quando o Pokémon está na Party do source carregado; para Box/Hub, mostrar HP máximo calculado quando houver contexto suficiente. EVs permanecem na projeção técnica, sem espaço próprio neste esboço visual. |
| Moves | `Attacks.moves[4]` e `pp[4]` | IDs e PP vêm do core; nomes exigem catálogo por geração/título. Slot vazio continua vazio. |
| Ribbons | bits/ranks em `Misc` | Preservar distinção entre ranks de Contest e ribbons booleanas. Não reduzir o campo a um único `hasRibbon`. |
| Sexo do Pokémon | personalidade + `genderRatio` da espécie | Pode ser macho, fêmea ou sem sexo. `Misc.otGender` é sexo do treinador original, **não** do Pokémon; a regra no código de [Pokémon Ruby](https://github.com/pret/pokeruby/blob/master/src/pokemon_2.c) usa a espécie e a personalidade. |
| Jogo de origem | `Misc.metGame` | Decodificar o código nativo; se desconhecido, mostrar “Desconhecido”, sem substituir pelo título do save atual. |
| Pokébola | `Misc.pokeball` | Campo de 4 bits; mapear IDs validados de [itens Gen III](https://github.com/pret/pokeemerald/blob/master/include/constants/items.h). Valor desconhecido deve conservar o ID bruto. |

A estrutura Gen III acima está confirmada em `pokeemerald/include/pokemon.h`. A compatibilidade exata de valores, nomes e eventuais particularidades de Ruby/Sapphire/FireRed/LeafGreen ainda requer fixtures dos cinco títulos e validação contra as respectivas definições. Não concluir que todo campo pode ser interpretado igualmente só porque os 80 bytes são transportados sem perda.

## Levantamento técnico dos leitores e editores existentes

| Arquivo | Responsabilidade atual | Requisito decorrente para o detalhe |
| --- | --- | --- |
| `pokemon-gen3-save-validation.mjs` | Valida `.sav` de exatamente 128 KiB, 14 setores por cópia, assinatura, checksums de setor e índice de gravação; escolhe a cópia válida mais recente. Oferece seleção sem ambiguidade para editores. | Reutilizar a seleção validada para ler o save físico; checksum de setor **não** substitui checksum do Pokémon. Se ambas as cópias tiverem o mesmo índice e conteúdo diferente, a leitura do card precisa ter política explícita antes de escolher uma como autoridade. |
| `pokemon-save-layouts.json` e `pokemon-save-layouts.mjs` | Definem Party de seis registros de 100 bytes no bloco 1 (RSE: count `0x234`, records `0x238`; FRLG: count `0x34`, records `0x38`) e 14 Boxes × 30 slots. | O card deve resolver o título/layout do source; offsets de Party não podem ser assumidos iguais para todos os jogos. |
| `pokemon-gen3-adapter.mjs` | `readAllSlots` extrai todos os records para adoção; `inspect` entrega resumo; `readSlot` lê um slot de Box; `writeSlot` e `writeParty` alteram placements e checksums de setor. O decoder privado `decodePcRecord` decripta o core, mas só lê espécie, shiny, ovo e OT ID. | Ampliar a leitura por meio de parser compartilhado; não repetir XOR/permutação em um terceiro decoder. Preservar APIs resumidas e bytes nativos. O card não precisa chamar os writers. |
| `pokemon-gen3-party-runtime.mjs` | `parseGen3BoxCore` valida o checksum interno do core e já lê espécie nativa, experiência, item, natureza, IVs e EVs. `materializeGen3PartyRecord` deriva nível e seis stats para construir os 20 bytes extras de Party. | Principal ponto de extensão do parser de 80 bytes para moves, met data, bola, ribbons e flags. Leitura deve poder usar o parser sem criar um Party record nem normalizar bytes. |
| `pokemon-gen3-party-data.mjs` e `pokemon-gen3-party-species.json` | Fornecem growth rate e base stats por espécie nativa nos cinco jogos; tratam diferenças de forma do Deoxys por título. | Podem sustentar nível e stats derivados. Não contêm `genderRatio`, nomes de moves ou itens; essas fontes devem ser levantadas separadamente. |
| `pokemon-gen3-species.mjs` | Converte species ID nativo para National Dex, inclusive Unown. | Manter ID nativo para cálculo/tabelas e National Dex para sprite; não usar o National Dex como índice da tabela nativa. |
| `pokemon-gen3-inventory.mjs`, `pokemon-gen3-event-flags.mjs`, `pokemon-gen3-national-dex.mjs` e `pokemon-gen3-event-grant.mjs` | Leem/editam Bag, PC items, flags e progressão do **save**, não o item segurado ou os dados internos de cada Pokémon. Editores validam cópia não ambígua e recalculam checksums dos setores afetados. | Não reutilizar a leitura da Bag para `heldItem`. Um projeto futuro de edição de Pokémon precisaria tratar também checksum do core cifrado; o card atual é somente leitura. |
| `pokemon-hub-save-adoption.mjs` e `pokemon-hub-snapshot-coordinator.mjs` | Adoção percorre Party/Boxes e grava record com `representation.bytesBase64`, SHA-256, `display`, `placement` e `provenance`; snapshots expõem display pequeno. | A projeção em lote deve ler os records dos IDs ocupados ao carregar o perfil, conferir tamanho/hash e decodificar a representação vigente antes de devolver a resposta. O coordinator tem `readRecord` privado; ainda não há contrato público de lote hidratado. |
| `pokemon-hub-save-materializer.mjs` e `pokemon-hub-save-flush.mjs` | Reconstroem um `.sav` a partir dos placements e representações nativas; Party→Box usa os primeiros 80 bytes; Box→Party deriva o runtime; flush publica por revisão/fence. | Não colocar valores do card no writer. A projeção deve acompanhar a representação que o materializer realmente preserva ou transforma, e não um cache independente sem revisão. |

### Caminho exato dos bytes Gen III

1. Validar o arquivo e escolher a cópia com `selectNewestPokemonGen3SaveCopy`. A seção lógica 5–13 contém os 14 × 30 records de Box de 80 bytes. O adapter calcula o deslocamento lógico `4 + (box × 30 + slot) × 80` e atravessa limites de setor quando necessário. Para Party, usar `pokemon-save-layouts.json` e a contagem ativa; bytes residuais após a contagem não são Pokémon ativos.
2. Nos primeiros 80 bytes, ler `personality` em `0x00`, OT ID de 32 bits em `0x04` e checksum interno em `0x1c`. Decriptar `0x20..0x4f` por palavras little-endian de 32 bits com chave `personality XOR otId`. Escolher a ordem das quatro subestruturas de 12 bytes por `personality % 24`: Growth (G), Attacks (A), EVs/Contest (E) e Misc (M). Somar as 24 palavras little-endian do payload decriptado módulo `0x10000` e comparar ao checksum de `0x1c` **antes** de mostrar valores detalhados. O parser existente `parseGen3BoxCore` já executa essa validação.
3. Em G: espécie nativa `u16@0`, item segurado `u16@2`, experiência `u32@4`. Em A: quatro move IDs `u16@0,2,4,6` e PP `u8@8..11`. Em E: seis EVs `u8@0..5`; os outros bytes incluem condições de Contest, não stats de batalha. Em M: met location `u8@1`; a palavra `u16@2` separa met level (`bits 0..6`), met game (`7..10`), Pokébola (`11..14`) e sexo do OT (`15`). `u32@4` contém seis IVs de cinco bits, flag de ovo e ability slot. `u32@8` contém cinco ranks de ribbons de Contest (três bits por categoria), ribbons booleanas e bits especiais que não devem virar ribbons inventadas. Esses offsets seguem a [estrutura original de Emerald](https://github.com/pret/pokeemerald/blob/master/include/pokemon.h).
4. Shiny é calculado de PID e duas metades de OT ID; o sexo do **Pokémon** depende de PID, espécie e `genderRatio`. O dataset de base stats atual não tem `genderRatio`, então sexo exige ampliar a tabela validada, mantendo os casos macho, fêmea e sem sexo. A [implementação de Ruby](https://github.com/pret/pokeruby/blob/master/src/pokemon_2.c) confirma a regra; `otGender` do passo anterior não a substitui.
5. O `metGame` de quatro bits tem códigos documentados no [decomp de Emerald](https://github.com/pret/pokeemerald/blob/master/include/constants/global.h): Sapphire=1, Ruby=2, Emerald=3, FireRed=4, LeafGreen=5 e GameCube=15. Guardar o código bruto para valores não mapeados; não confundi-lo com `source.gameId`. A Pokébola tem ID de quatro bits, e os IDs Gen III de bolas são contíguos de Master Ball a Premier Ball no [catálogo de itens](https://github.com/pret/pokeemerald/blob/master/include/constants/items.h); validar a correspondência exata nos títulos suportados antes de publicar labels.
6. Os 20 bytes adicionais da Party começam em `0x50`: status `u32@0x50`, nível `u8@0x54`, mail `u8@0x55`, HP atual `u16@0x56`, HP máximo `u16@0x58`, ataque/defesa/velocidade/ataque especial/defesa especial `u16@0x5a..0x62`. O Hub pode reter uma representação `party-record`; Box e um Hub originado de Box só têm o core. O nível de Box é derivável da experiência; HP atual/condição da Party não são dados presentes em todo record. A leitura de stats calculados depende do título usado para espécies com forma por jogo, como Deoxys.

### Requisitos de integridade e de contrato identificados

- **Dois decoders hoje:** `decodePcRecord` não verifica o checksum interno do Pokémon, enquanto `parseGen3BoxCore` verifica. O detalhe não pode apresentar valores de um core cujo checksum falhou, ainda que o setor do `.sav` tenha checksum válido. A mudança da política de adoção/transferência diante desse caso precisa ser tratada separadamente da view, pois altera requisitos de integridade existentes.
- **Representação e revisão:** a adoção grava os 80/100 bytes completos, mas não prova que `canonical` contenha todos os dados. O detalhe deve distinguir `pc-record` e `party-record`, validar comprimento e SHA-256 do record, usar a revisão atual e evitar cache que sobreviva à troca da representação.
- **Proveniência:** `originSourceKey` já inclui `save:<saveProfileId>:<gameId>` quando o primeiro avistamento foi em save; indexar os IDs somente quando esse formato estiver comprovado. Um record observado primeiro em `hub:<hubProfileId>` não permite recuperar retroativamente o profile original por suposição. `metGame` do Pokémon é independente dessa proveniência.
- **Catálogos faltantes:** os dados binários permitem ler move ID, item ID, ball ID e ribbon bits, mas a base atual não inclui nomes de moves/itens nem gender ratio. O requisito para começar é uma projeção correta de IDs e flags com fallback explícito; labels exigem catálogo licenciado e verificado por título.
- **Limite do editor:** `writeSlot` e `writeParty` copiam bytes de Pokémon e recalculam checksums de setor; não editam move, item, OT ou ribbons no core. Decodificar para o card não autoriza escrever esses campos. Um editor futuro precisaria reordenar/recriptar subestruturas, recalcular checksum do core, checksums dos setores, revisionar o save e provar round-trip sem perda.
- **Leitura em lote:** o coordinator hoje mantém `readRecord` privado para adoção/sync/flush. A futura projeção de perfil precisa resolver, de uma vez, os IDs dos slots ocupados, localizar os respectivos records e aplicar o escopo de acesso do backend profile e do Hub profile ou save profile. A resposta não contém bytes nativos ou Secret ID.

### Estado das fixtures locais nesta pesquisa

Foi feita somente leitura de `test-data/*.sav`, sem editar arquivos: os três `.sav` Emerald têm 128 KiB mas estão inteiramente em `0xff`, portanto o validador os rejeita como não inicializados. `Pokemon Ruby.sav` tem 131.088 bytes; seus primeiros 128 KiB formam uma cópia Gen III válida, mas o arquivo completo não cumpre o contrato atual do adapter. A leitura exploratória dessa fatia encontrou **zero** Pokémon ocupados. Os 16 bytes extras não foram identificados formalmente e não devem ser descartados em produto com base nesse teste. Assim, essas fixtures não validam moves, ribbons, bola, item, sexo ou stats reais. Os testes existentes usam records sintéticos principalmente para espécie, shiny, OT ID e Party materialization; ainda faltam fixtures não vazias e conferência independente para os campos do card.

## Contrato pretendido para expandir

1. `apps/packages/` deve decodificar uma projeção somente de leitura a partir da representação nativa validada e manter um índice de proveniência `originSaveProfileId` associado ao primeiro `save:<profileId>:<gameId>` conhecido do record. Para records inicialmente observados no Hub sem source de save comprovado, esse índice é desconhecido, nunca inferido do dono atual. O record e os bytes permanecem a autoridade; dados derivados não substituem nem regravam o payload cifrado.
2. O backend deve disponibilizar, ao carregar **cada perfil**, os detalhes de **todos** os `pokemonInstanceId` ocupados nele e as revisões usadas para produzi-los, com valores tipados e uma indicação explícita de campo desconhecido/indisponível. O frontend recebe tudo antes de abrir um card; clicar em um Pokémon não faz requisição. Os snapshots frequentes de placement continuam pequenos.
3. A resposta deve separar `identity` (espécie, shiny, sexo), `training` (nível, experiência e stats definidos para a view), `moves`, `ribbons`, `origin` (OT ID, `metGame`, proveniência do Hub), `capture` (bola) e `heldItem`. IDs nativos devem acompanhar labels resolvidos quando houver catálogo confiável.
4. O frontend deve exibir somente esses dados e o sprite local já usado pelo Hub. Se uma imagem ou label faltar, o dado bruto conhecido continua legível. Valor desconhecido não deve aparecer como zero, falso, “sem item” ou outra afirmação incorreta.
5. Transferir um Pokémon entre save e Hub deve manter o mesmo `pokemonInstanceId` e os bytes/record conforme Specs 024, 075 e 077. Uma projeção desatualizada deve ser invalidada quando a representação nativa ou sua revisão mudar.
6. Uma falha ao decodificar detalhes para a view não deve reescrever o `.sav` ou o record. A política de aquisição e integridade do source continua governada pelos contratos existentes; o card não afrouxa validações necessárias nem vira requisito para iniciar jogo.

## API e hidratação dos perfis — decisão de escopo desta revisão

**Regra solicitada:** o card é somente leitura. Cada carregamento de perfil traz todos os dados necessários de todos os seus Pokémon em uma resposta agregada. O navegador mantém esses detalhes em memória e consulta o mapa local quando o usuário clica no slot. Não há rota de detalhe por Pokémon, fetch por clique, gravação de campos decodificados, edição do core nem mudança de protocolo de snapshot.

### Pontos de carga existentes

| Momento | Caminho existente | Ampliação somente de leitura |
| --- | --- | --- |
| Abrir Pokémon Hub | `PokemonHub` chama `getPokemonHubProfiles()` em `hub-client.js`; `GET /api/pokemon-hub/profiles` chama `readProjectedPokemonHubProfiles()` em `server.mjs`. Esse helper lista todos os Hub profiles, busca o snapshot de cada source Hub vinculado e monta `grid.entries` com ID, espécie e shiny. | A mesma resposta inclui `pokemonDetailsById` para **todos** os IDs ocupados de **todos** os perfis Hub retornados. O grid continua leve e usa ID para encontrar o detalhe. Um perfil sem Pokémon retorna mapa vazio. |
| Abrir perfil de save | O fluxo efetivo `submitStructuralPokemonHubPaneChange` usa `getSaveProfileLayout(gameId, profileId, session.profileId)` ao atribuir um save ao container; `GET /api/pokemon-hub/save-profiles/:gameId/:profileId/layout` inspeciona Party/Boxes e associa IDs do source adotado. Existe uma função local `loadSaveLayout`, mas a busca atual no arquivo encontrou só sua definição, sem chamadas. | A mesma resposta de layout inclui `pokemonDetailsById` para todos os slots ativos/ocupados daquela Party e das 14 Boxes. O card já está pronto quando o layout aparece; não se lê `.sav` ao clicar. |
| Mover ou corrigir placements | O frontend mantém snapshots por source e reprojeta grids; o comando canônico de sessão envia/recebe placements por ID. | Reindexar as referências locais aos detalhes pelos IDs, sem copiar payload completo no comando. Se uma correção trouxer ID que não está no cache, recarregar o **perfil inteiro** pelo ponto de carga existente antes de habilitar o card desse ID. |

“Carregar os perfis” aqui cobre todos os Hub profiles na abertura da tela e, para cada save profile selecionado, a carga de seu layout completo. O catálogo global de jogos (`GET /api/games`) continua metadado de ROM/profile; não deve carregar records de todos os saves que ainda não foram abertos no workspace. Nenhum clique em Pokémon depende da rede. Se a intenção futura for pré-carregar também **todos os save profiles de todos os jogos** já na abertura do Hub, será uma ampliação explícita desta fronteira de carga, com medição do volume de dados e da disponibilidade de cada `.sav`.

### Forma prevista da resposta

Manter os campos atuais de `GET /api/pokemon-hub/profiles` (`profiles[].grid.entries`) e do layout (`party`, `boxes`, `layout`) para não quebrar consumidores. Acrescentar o mesmo campo agregado às duas respostas:

```js
{
  // ...campos atuais da resposta de perfis Hub OU do layout de um save...
  pokemonDetailsById: {
    [pokemonInstanceId]: {
      pokemonInstanceId,
      availability: 'ready',  // ou 'unavailable', sem fatos inventados
      sourceRevision,          // revisão do source que associou o ID ao slot
      recordRevision,          // revisão da representação lida
      identity: { species, nativeSpeciesId, shiny, gender, isEgg },
      training: {
        level,
        stats: { hp, attack, defense, specialAttack, specialDefense, speed },
        ivs: { hp, attack, defense, specialAttack, specialDefense, speed },
        partyRuntime: null, // ou { currentHp, maxHp, condition } se comprovado
      },
      moves: [
        // sempre quatro posições: { slot: 0..3, moveId: 0|ID, label: null|string,
        //                         pp: null|number, maxPp: null|number }
      ],
      ribbons: [
        // somente possuídas: { ribbonId, rank: null|1|2|3|4,
        //                      label: null|string, iconKey: null|string }
      ],
      origin: { trainerId, metGameId, metGameLabel, originSaveProfileId, originGameId },
      capture: { ballId, ballLabel },
      heldItem: { itemId, itemLabel },
      unavailableFields: [/* nomes de campos não interpretáveis */],
    },
  },
}
```

Os nomes e subcampos são um contrato proposto para a próxima implementação, não um formato já servido. Na implementação, tipos devem ser fechados em um validador compartilhável: `availability: 'unavailable'` traz `pokemonInstanceId`, revisões e um `errorCode` estável, sem campos falsos; `ready` pode ter `null` e `unavailableFields` apenas para fatos isolados não verificáveis. `species` é National Dex para o sprite; `nativeSpeciesId` é diagnóstico de catálogo, não identidade. `pokemonDetailsById` contém somente projeções de leitura: nunca `bytesBase64`, PID, OT ID completo/Secret ID, histórico de eventos ou dados de save não pedidos. ID bruto conhecido é mantido mesmo sem label. `moveId:0` representa slot vazio; `maxPp` só é publicado quando PP Ups e base PP puderem ser conferidos, e não deve ser confundido com PP atual. `rank` de Contest usa 1..4; ribbons booleanas usam `null`. `iconKey` é chave local de asset, não URL externa. `partyRuntime` só é aplicável ao Pokémon que **está** na Party do source carregado e cuja representação física/revisão seja comprovada. Ao sair da Party, o card não deve exibir HP/condição antigos como atuais. Um stat dependente do título, por exemplo forma de Deoxys, precisa do contexto de título comprovado da representação; se esse contexto não existe para um record legado no Hub, o stat derivado fica indisponível em vez de usar `metGame` ou o save de origem como substituto.

### Sequência do backend

1. **Perfis Hub:** `handlePokemonHubProfiles` chama um projetor em `apps/packages/`. Para cada profile com owner, lê o source canônico uma vez, coleta IDs ocupados distintos, lê os records correspondentes em lote sob o namespace do owner, verifica `placement`, representação vigente, comprimento, SHA-256 e revisões, e decodifica os campos do card. O backend só devolve o agregado depois de garantir que detalhes e placements pertencem à mesma geração; se uma mudança concorrente invalidar essa relação, repete a leitura limitada ou devolve erro de revisão, nunca combina gerações silenciosamente. Perfil sem owner/source válido segue a regra atual de disponibilidade, sem dados inventados.
2. **Perfis de save:** `getSaveLayout` já resolve game/profile, lease, save revision, layout e adapter, inspeciona Party/Boxes e associa IDs aos slots. A hidratação percorre exatamente os slots ocupados dessa mesma revisão do save, usa o parser compartilhado e, quando houver source/record correspondente, verifica ID ↔ slot ↔ representação. Falta ou divergência de record é erro de integridade para o detalhe; não casar Pokémon por PID/OT ID isolado. O resultado só é publicado se o `saveRevision` e `sourceRevision` ainda descreverem a mesma ocupação.
3. **Projeção:** uma função de pacote pura recebe representação nativa, kind (`pc-record`/`party-record`), título comprovado quando necessário e proveniência existente. Valida o core e produz dados tipados. Sem persistir cache, sem salvar, sem alterar checksums. Catálogos resolvem labels no backend; o browser recebe apenas valores do card.
4. **Volume e unicidade:** o backend percorre todos os IDs dos perfis carregados e deduplica leituras do mesmo `pokemonInstanceId` dentro da resposta; encontrar o mesmo ID em dois placements distintos é erro de integridade, não duas entradas válidas. O custo de decodificação e o tamanho da resposta acompanham os Pokémon ocupados; os slots vazios permanecem só na estrutura de layout. A resposta não inclui o blob binário de 80/100 bytes por Pokémon; a implementação deve medir tamanho/latência com inventário representativo e preservar uma resposta completa, sem paginação ou busca por item.

`getSaveLayout` **já pode gravar metadados do Hub** por meio de `adoptPokemonHubSave` e `refreshTransferCapability` quando detecta um save novo/desatualizado. Essa é uma característica preexistente do carregamento de save, não uma escrita do card. Para cumprir “somente leitura” de forma literal na implementação desta feature, a hidratação nova deve ser uma função pura; nenhuma nova adoção, regravação de record, materialização ou `saveStore.put` pode ser disparada por ela. Se a intenção passar a ser que o próprio `GET /layout` inteiro jamais grave metadados, separar a adoção preexistente dessa rota será uma mudança arquitetural adicional, a documentar e validar à parte.

### Estado do frontend e atualização

`hub-client.js` valida `pokemonDetailsById` nas duas respostas agregadas. `pokemon-hub-ui.jsx` mantém um mapa de detalhes por `pokemonInstanceId` com a revisão do source que o trouxe. `loadPokemonHubProfiles` o preenche para Hub profiles; o caminho **ativo** de `submitStructuralPokemonHubPaneChange` o preenche para o save profile escolhido. A função local `loadSaveLayout` está sem chamadas hoje: remover ou ligar essa função é decisão de limpeza da implementação, não um segundo caminho de hidratação presumido. `selectPokemonHubLocation` resolve o ID do slot ocupado e abre o card a partir do mapa; não chama API. Se o slot está vazio ou o detalhe da revisão atual falta, não mostra um card antigo como se fosse válido.

Após movimento aceito, o detalhe segue o mesmo ID para a nova localização; valores de Party runtime deixam de ser considerados atuais quando a localização muda. Ao carregar/recarregar um perfil, substituir os detalhes ligados à sua revisão e descartar IDs que não pertencem mais a nenhum source carregado. Em resposta de correção canônica ou mudança externa, reconciliar placements primeiro e atualizar os perfis afetados pelos dois endpoints agregados antes de reabrir o card de dados ausentes. A sincronização frequente e as respostas `200` vazias / `409` com snapshot cru da Spec 029 permanecem intactas; o mapa de detalhes é estado de leitura local, nunca parte do comando.

## Esboço do card no frontend

O card pertence ao **container (pane) que contém o slot selecionado** e fica centralizado na área de conteúdo desse container. O workspace atual aceita de um a três containers; com três abertos, cada um pode exibir simultaneamente seu próprio card, sem um card global que substitua os outros. A seleção visual usada hoje para transferências entre containers (`pokemonHubSelection`) continua distinta da seleção de detalhe por container. Trocar ou fechar um container limpa apenas seu detalhe; mover um Pokémon atualiza o card correspondente pelo `pokemonInstanceId` e pela revisão hidratada, ou o fecha se o dado atual ainda não estiver disponível.

O formato é **horizontal**, com cantos arredondados e altura alvo de aproximadamente `33dvh` em desktop. A largura cabe integralmente no container, com margem interna, inclusive quando a tela está dividida em três. O card não invade containers vizinhos. Em altura ou largura insuficiente, preserva os campos pedidos com rolagem **dentro do card**; o sprite e seus ícones continuam visíveis. O breakpoint e medidas finais devem ser conferidos no workspace real, inclusive nos containers empilhados do layout estreito. O tema segue o verde escuro existente, sem página nova ou elementos decorativos adicionais.

```text
┌──────────────────────────────────────────────────────────────────┐
│  sprite  [♂/♀] [✦]  │  HP  Ataque  Defesa  At. Esp.  Def. Esp.  Vel. │
│                      │  IV de cada um dos seis stats               │
│  Nível               │                                             │
│  Original Trainer ID │  Moves (até quatro, na ordem do save)      │
│  Original Game       │  Ribbons possuídas (ícone original + nome) │
│  Pokébola · item     │                                             │
└──────────────────────────────────────────────────────────────────┘
```

| Região | Conteúdo e comportamento |
| --- | --- |
| Esquerda | Sprite local da espécie e variante shiny correta; sobre ele, dois ícones pequenos e legíveis: `♂` azul ou `♀` vermelho/rosa conforme o sexo, e uma marca de pequenas estrelas/centelhas **somente quando shiny**. Sem símbolo de sexo para espécie sem sexo ou dado indisponível; nunca usar `otGender`. Abaixo: nível, Trainer ID público do OT, jogo de origem nativo, tipo de Pokébola e item segurado ou “Sem item” quando o ID 0 foi confirmado. O nome do profile original não aparece. |
| Divisor | Linha vertical entre a apresentação do Pokémon e os dados, sem dividir o workspace inteiro. |
| Direita | Seis stats na ordem HP, Ataque, Defesa, Ataque Especial, Defesa Especial, Velocidade, cada um com valor e IV correspondente (`0..31`) claramente distinto do stat. Para Party, HP atual/máximo quando válido; nos demais, HP máximo derivado e sem afirmação de HP atual. Logo abaixo, os quatro moves na ordem dos slots, com PP quando decodificado. Por último, apenas as ribbons possuídas, com seus ícones originais e nomes/ranks verificados. Uma ribbon de Contest com rank alcançado deve refletir corretamente os ranks obtidos, conforme a semântica Gen III, sem virar uma ribbon genérica. |

Os ícones pequenos são posicionados sobre/ao lado imediato do sprite e não substituem texto acessível: cada um precisa de nome acessível (“Macho”, “Fêmea”, “Shiny”); ribbons precisam de nome acessível além do desenho. Dado sem interpretação confiável permanece “Desconhecido” ou ID bruto, conforme o campo. Sprite ausente não oculta os dados. Nenhum campo do card abre fetch por Pokémon, nem executa escrita.

### Interação no workspace atual

`PokemonHubPane` já isola cada container e `.pokemon-workspace-body-3` usa três colunas iguais. Os slots do Hub são botões e já chamam `selectPokemonHubLocation`; os slots de Party/Box em `SaveSlot` são hoje elementos `role="img"` dentro do drag and drop, sem seleção por clique. A implementação deve tornar **todos os slots ocupados** selecionáveis por mouse e teclado, preservando drag/drop e o estado de transferência existente. A seleção de detalhe é indexada pelo container e pelo ID do Pokémon, nunca pelo número de slot isolado. Slot vazio não abre card. Como o card cobre parte dos slots, ele precisa de fechamento acessível no próprio container (botão pequeno de fechar e `Escape`); selecionar novamente o mesmo Pokémon pode também fechar quando o slot estiver alcançável. Fechar um card não fecha o container nem o workspace.

### Auditoria dos assets e requisito de sincronização

| Asset | Estado verificado | Encaminhamento no spec |
| --- | --- | --- |
| Sprite normal/shiny | `sync-pokemon-resources.mjs` lê `pokemon.sprites.other.home.front_default/front_shiny` da PokéAPI e gera arquivos locais em `/resources/pokemon/`, conforme Spec 020. | Reusar o resolver local atual; o ícone shiny é **separado** do sprite shiny. |
| Ícones de gênero e marca shiny | Não estão no sincronizador nem no contrato do manifest de sprites. O repositório oficial [PokeAPI/sprites](https://github.com/PokeAPI/sprites/tree/master/sprites) organiza `badges`, `items`, `pokemon` e `types`; variantes chamadas `female` e `shiny` são sprites de Pokémon, não selos para sobreposição. Em [Emerald](https://github.com/pret/pokeemerald/blob/master/src/pokemon_summary_screen.c), gênero é desenhado como glifo `♂`/`♀` colorido; o jogo diferencia shiny pela paleta do retrato, sem arquivo de selo separado nesse trecho. | Definir ícones locais minúsculos para os glifos de gênero e a marca visual de pequenas estrelas solicitada, com fonte/forma verificada antes de fixar pixels finais. Não afirmar que a PokéAPI fornece um “shiny badge” oficial. Incluir esses ícones no inventário de assets do card; eles não são downloads da PokéAPI enquanto não houver endpoint/arquivo comprovado. |
| Ribbons | Não há diretório/endpoint de ribbon no catálogo de sprites auditado; em `sprites/items` da PokéAPI, a busca por nome `ribbon`, `gender`, `male` e `female` não retornou arquivos. O [decomp de Emerald](https://github.com/pret/pokeemerald/blob/master/src/pokenav_ribbons_summary.c) referencia os atlas originais `graphics/pokenav/ribbons/icons.png` e `icons_big.png`, paletas e a tabela de IDs/ranks do PokéNav. | Acrescentar ribbons ao **inventário de assets necessários**, com fonte própria e mapeamento `ribbonId/rank → ícone original`, separado do download de sprites da PokéAPI. Antes de automatizar a obtenção, conferir procedência/permissão de distribuição, recortes e paletas, e validar cada ícone contra a tabela Gen III. Se o ícone faltar, mostrar nome/ID da ribbon sem imagem incorreta. |

A sincronização futura deve produzir caminhos locais estáveis e um manifest de completude para os ícones do card, sem mudar silenciosamente o schema/critério de completude dos sprites da Spec 020. Uma falha na obtenção dos ícones não altera leitura de save, hidratação, launch ou integridade dos Pokémon; o card exibe os dados disponíveis. A solicitação de “colocar na lista de assets baixados da PokéAPI” fica atendida como **levantamento de inventário**; a fonte de ribbon precisa ser distinta porque a PokéAPI auditada não disponibiliza esses ícones originais.

## Dossiê de implementação: caminhos reais e decisões verificáveis

Esta seção registra o estado do código em 27/09/2026. Ela distingue **existente**, **necessário** e **a confirmar**. O escopo desta feature continua leitura e apresentação: nenhum campo decodificado se torna autoridade para writers, e nenhum clique executa chamada individual à API.

### Fronteiras e contratos que já existem

| Camada | Arquivos/funções atuais | Consequência para esta feature |
| --- | --- | --- |
| Entrada do Hub | `apps/frontend/src/main.jsx` carrega `PokemonHub` por `React.lazy`; `apps/packages/pokemon-hub-ui.jsx` monta catálogo de jogos e lista de perfis em paralelo ao abrir. | A lista agregada do Hub deve trazer detalhes antes de habilitar o card; o catálogo global de jogos não é fonte de bytes do Pokémon. |
| Perfil Hub | `server.mjs:handlePokemonHubProfiles` devolve `{profiles}` de `readProjectedPokemonHubProfiles`; cada perfil com `ownerProfileId` lê `getSnapshot` do source `hub:<hubProfileId>` e projeta `grid.entries`. | Acrescentar o agregado no **mesmo GET**, preservando `profiles[].grid.entries`. Perfis Hub podem pertencer a owners distintos: a leitura de records usa o owner de cada source, nunca um profile de save inferido. Perfis sem owner/source seguem a semântica atual de vazio/legado, sem procurar records de outro namespace. |
| Perfil de save | `server.mjs:getSaveLayout` valida jogo/profile, bloqueia lease de player ativo, lê `saveStore.get`, resolve layout/adapter, inspeciona, adota ou atualiza source e anexa ID aos slots. | Acrescentar agregado no **mesmo GET** e usar o `workspaceProfileId` efetivo para o namespace do coordinator. O query param já altera esse namespace; não deduzir owner do `profileId` da URL quando os dois diferirem. Preservar 404 `SAVE_MISSING`, 409 de lease/layout/adapter e a forma atual de `party`/`boxes`. |
| Estado de sessão | `createGameSessionSourceSnapshot`, `createHubSessionSourceSnapshot`, `snapshotToSaveLayout` e `projectSessionSnapshots` em `pokemon-hub-session-view.mjs`/UI transportam IDs e display leve. | A projeção do card é outro mapa local. O snapshot canônico de três panes e seus `200` vazio/`409` cru não ganham detalhes nem mudam formato (Specs 024, 029 e 075). |
| Persistência | `pokemon-hub-profile-store.mjs` guarda catálogo `pokemon-hub:profiles`; `pokemon-hub-snapshot-coordinator.mjs` guarda source e record em chaves `pokemon-hub:v2:{ph:<backendProfileId>}:...`. | O grid legado no catálogo não é prova de ocupação do source. A leitura de card deve usar placements do source e records por ID no mesmo namespace; não listar chaves globais nem confiar em `profile.grid.entries` como payload nativo. |
| Recursos visuais | `pokemon-resource-catalog.mjs:spriteUrl` gera `/resources/pokemon/<nationalDex>[-shiny].png`; `sync-pokemon-resources.mjs` baixa `other.home` no `predev` e normaliza para canvas 96×96, manifest schema 1. | Reusar a imagem local. A sincronização de ícones de card precisa manifest próprio ou evolução versionada; não atrelar disponibilidade de sprites à ausência de ribbons. O card não requisita PokéAPI em runtime. |

O coordinator hoje fornece `getSnapshot` público e `getSaveFlushPlan` que reúne source+records para **flush**. `readRecord` e `readSource` são privados. Não usar o plano de flush como API de card: ele tem semântica de escrita e reúne dados internos sem o contrato de projeção. O ponto novo esperado é uma leitura em lote, somente de leitura, encapsulada em `apps/packages/`, chamada pelo backend. Ela recebe `profileId + sourceKey`/IDs esperados, devolve uma fotografia coerente de placements, revisões e projeções, e nunca publica Base64 ou Secret ID. A implementação deve decidir a primitive de leitura consistente conforme o mecanismo de persistência efetivo; duas leituras independentes sem conferência de geração não bastam.

### Inventário dos bytes e do parser a ampliar

| Fato pedido | Byte/base já presente | Trabalho de leitura e validação |
| --- | --- | --- |
| Espécie/sprite/shiny | `pokemon-gen3-adapter.mjs:decodePcRecord` extrai species nativa, converte para National Dex e calcula shiny de PID+OT ID. | Concentrar decriptação/checksum em `parseGen3BoxCore`; manter species **nativa** para tabelas e National Dex para asset. O método resumido atual não valida checksum interno. |
| Sexo | PID de `0x00`; gender ratio não está em `pokemon-gen3-party-species.json`. | Acrescentar tabela Gen III de gender ratio por species nativa, incluindo macho/fêmea fixos e sem sexo; testar limiares com referência dos títulos. `otGender` no Misc é outra pessoa. |
| Nível/stats/IVs | `parseGen3BoxCore` já fornece experiência, natureza, EVs e seis IVs; `getGen3PartySpeciesData` traz base stats/growth; `materializeGen3PartyRecord` calcula nível e seis stats. | Extrair cálculo **puro** para projeção sem criar 100 bytes. Party usa valores nativos de runtime da representação física compatível; Box/Hub usa cálculo quando título/formas comprovados. Checar espécies especiais, Shedinja (`fixedHp`) e Deoxys por título. |
| Moves | subestrutura A de 12 bytes ainda não é exposta no parser compartilhado. | Ler quatro `u16` e quatro PP `u8`, na ordem, preservar slot 0 como vazio e conferir IDs/PP e PP Ups antes de rotular. Não trocar ordem em transferência. |
| Ribbons | palavra de ribbons em M ainda não é exposta. | Decodificar cinco ranks de Contest, flags booleanas, flags especiais e gift ribbon com a semântica do título. A tabela do [PokéNav Emerald](https://github.com/pret/pokeemerald/blob/master/src/pokenav_ribbons_summary.c) é referência para IDs e atlas; gift ribbon pode depender de dados adicionais do save, portanto não atribuir nome/ícone específico apenas pelo bit quando o índice/descrição externa não estiver disponível. |
| OT/origem/bola/item | OT ID está no cabeçalho; `heldItem` já sai de G; `metGame` e `pokeball` estão em M. | Projetar Trainer ID público em decimal com formatação Gen III, preservar IDs brutos de jogo/bola/item e só emitir labels após tabela validada. `metGame` indica origem registrada no Pokémon, independente de `gameId`/`originSourceKey`. Item ID 0 confirmado significa sem item. |

O parser de card deve aceitar somente representações `gen3-gba-v1` de 80 (`pc-record`) ou 100 bytes (`party-record`), conferir comprimento, SHA-256 do record e checksum interno dos 48 bytes decriptados antes de mostrar qualquer campo detalhado. Os checksums de setor já cobertos pela validação do `.sav` não dispensam essa verificação. O parse produz dados, não bytes reserializados. Não aplicar `materializeGen3PartyRecord` para simplesmente exibir um Box/Hub: isso fabricaria um runtime de Party que nunca existiu naquele placement.

O seletor atual de save (`selectNewestPokemonGen3SaveCopy`) aceita a cópia válida mais recente e, em empate, mantém a primeira. O seletor de **edição** (`selectUnambiguousPokemonGen3SaveCopy`) rejeita cópias válidas de mesmo índice com bytes diferentes. O detalhe, por ser leitura, deve explicitar qual cópia seguiu e marcar ambiguidade se as cópias empatadas divergirem; não declarar uma delas a origem confiável de stats sem uma política decidida. O arquivo deve continuar com 128 KiB exatos no contrato atual. Offsets Party são RSE `0x234/0x238`, FRLG `0x34/0x38`; são 6 slots Party + 14×30 Box, total máximo 426 Pokémon por save carregado.

### Autoridade quando há movimento ainda não publicado no `.sav`

`source.placements` pode já refletir um movimento aceito enquanto `source.needsSaveFlush` ainda é verdadeiro. O `.sav` físico pode então mostrar bytes em posições antigas. Também é possível um Pokémon em Party ter record com apenas `pc-record`: `pokemon-hub-save-materializer.mjs` gera os 20 bytes de runtime no **flush**, mas não converte automaticamente a representação persistida do record. Um Pokémon que saiu da Party mantém representação de 100 bytes no record, embora o destino Box use apenas seus primeiros 80 bytes.

Regras para a hidratação: (1) identidade e fatos estáveis vêm do record ligado ao ID/placement lógico do source; (2) dado runtime da Party só vem de uma representação Party ou do slot físico **comprovadamente correspondente** ao mesmo ID/core e à revisão de save alinhada; (3) se source está dirty, se a posição física diverge, ou se só existe `pc-record`, `currentHp`/condição ficam indisponíveis, sem leitura do ocupante anterior; (4) stats calculáveis continuam disponíveis a partir do core e do contexto de título; (5) flush e adoção posterior invalidam detalhes anteriores por revisão. O GET de layout atual projeta ocupação física e sobrepõe IDs por posição lógica; a implementação deve confrontar essas duas perspectivas explicitamente para não hidratar Pokémon A com runtime de B.

`sourceRevision`, `snapshotRevision`, `saveRevision` e `record.revision` têm papéis diferentes. `sourceRevision` muda com placements/adoção; `record.revision` pode mudar só por movimentação sem mudar o hash nativo; `saveRevision` refere-se ao arquivo físico; `snapshotRevision` é transporte. O cache do card precisa associar pelo menos source/record revision e representação/hash, além de descartar runtime físico quando `saveRevision` ou placement não corresponder. O API público não precisa expor hash, mas o servidor usa hash para a checagem interna.

### Resposta agregada, falhas e custo

O backend constrói um mapa de **uma entrada por ID ocupado** na fotografia do perfil. Uma entrada pode ter `availability: 'ready'` com todos os fatos verificáveis, ou `availability: 'unavailable'` e código técnico quando o detalhe daquele ID não puder ser decodificado; assim todos os IDs estão representados sem inventar dados. Campos individuais sem catálogo ou contexto usam `null`/ID bruto, sem derrubar o restante. Falha de card não bloqueia lançamento do jogo nem cria pré-requisito de lease/transferência; divergência estrutural de source/record continua sujeita às regras de integridade existentes e não é “consertada” pelo projetor. Se a fotografia muda durante a leitura, repetir de forma limitada ou devolver detalhe indisponível para a geração afetada; nunca misturar versões. Registrar motivo no backend sem incluir bytes, PID, Secret ID ou conteúdo do save no log.

`GET /profiles` devolve todos os perfis Hub em uma chamada; cada owner/source é lido uma vez e seus IDs distintos são projetados. `GET .../layout` devolve Party e todas as Boxes do save escolhido, inclusive detalhes de Pokémon fora da Box visível. Não fazer uma chamada por Pokémon e não acrescentar detalhes a heartbeat, snapshot ou comando de movimento. Com 426 Pokémon por save mais os perfis Hub, medir tamanho JSON, tempo de validação, latência e memória em inventário representativo; o requisito funcional continua resposta completa sem paginação por Pokémon. Se o volume exigir compactação HTTP, ela é de transporte e não altera o contrato JSON.

### Estado React, layout e interação: pontos de inserção

`pokemon-hub-ui.jsx` guarda `pokemonHubPanes` (até 3), `pokemonHubProfiles`, `saveLayoutsBySource`, snapshots em ref e `pokemonHubSelection` global para transferência. A seleção do card precisa ser outra estrutura, indexada pelo container, com `{sourceKey,pokemonInstanceId}`; não aproveitar `pokemonHubSelection`, que hoje comporta no máximo duas escolhas em containers diferentes e é zerada em mudanças estruturais. `addWorkspacePane`, `closePokemonHubPane`, troca de source, exclusão de Hub profile, correção canônica e fechamento do workspace precisam limpar ou reconciliar os cards afetados. Como `key={index}` acompanha posição visual, remover pane exige reindexar explicitamente a seleção de detalhe ou ancorá-la na identidade da fonte, evitando card da pane removida aparecer na vizinha.

O clique do slot Hub já passa `location,pane`. `SaveSlot` de Party/Box ainda não passa `onSlotSelect` e usa `div role="img"`; torná-lo acionável por teclado/mouse exige tratamento de semântica de botão e do sensor de drag (`PointerActivationConstraints.Distance({value:6})`). Clique curto abre card, arrasto não abre card nem dispara seleção ao soltar. Para evitar capturar o próprio slot selecionado, o card é uma camada centrada **dentro** de `.pokemon-workspace-pane`/`.pokemon-pane-content`, com `z-index` local; não usar o `Modal` global de perfil ou uma camada que cubra os três containers. Considerar o overlay de bloqueio de transferência já existente (`.pokemon-hub-transfer-block-overlay`, `z-index:5`) na ordem de camadas, sem permitir que o card esconda motivo de bloqueio ou autorize drag indevido.

O card mostra no máximo quatro moves e só as ribbons presentes; texto longo e muitas ribbons rolam na coluna direita, mantendo sprite/ícones estáveis. O tamanho alvo `33dvh` é uma intenção visual, limitado pela altura útil da pane; usar medidas relativas à **pane** para largura. O CSS atual empilha panes sob 680px, com altura mínima 420px, então verificar também a largura estreita e foco de teclado. Os labels do card podem ser copiados/selecionados se necessário para Trainer ID, apesar de `.pokemon-workspace, .pokemon-workspace * { user-select:none }` hoje impedir seleção de texto; não tratar isso como dado inacessível por leitor de tela. Componente e estilos continuam no projeto de apresentação; parser e contratos ficam em `apps/packages/`.

### Catálogos locais e assets: preparação concreta

| Necessidade | Fonte atual/referência | Artefato de implementação proposto |
| --- | --- | --- |
| Growth/base stats | `pokemon-gen3-party-data.mjs` + JSON nativo, com Deoxys por título e Shedinja. | Reusar sem duplicação; extrair cálculo de stat para leitura pura. |
| Sexo | Ausente no dataset local; [regra de sexo de Ruby](https://github.com/pret/pokeruby/blob/master/src/pokemon_2.c) e dados de espécie de cada título. | Tabela de `genderRatio` nativa e testes de macho/fêmea/sem sexo, conferida nos cinco jogos. |
| Moves e itens | IDs nativos no core; [PokéAPI Move/Item](https://pokeapi.co/docs/v2) pode fornecer nomes, mas seu ID não deve ser presumido idêntico ao ID interno Gen III. | Mapeamento versionado por título/geração, gerado ou revisado offline; frontend não consulta PokéAPI por card. Resolver nome com fallback `Move #ID`/`Item #ID` comprovado. |
| Jogo/bola | Constantes Gen III de [origem](https://github.com/pret/pokeemerald/blob/master/include/constants/global.h) e [itens](https://github.com/pret/pokeemerald/blob/master/include/constants/items.h). | Tabela curta de código bruto → label; testar valores desconhecidos e GameCube. |
| Ribbon | [atlas e tabela PokéNav](https://github.com/pret/pokeemerald/blob/master/src/pokenav_ribbons_summary.c), fora do repositório PokéAPI de sprites. | Manifest local `ribbonId/rank → caminho, fonte, versão`, com recorte/paleta conferidos. Sem atlas validado, conservar label/ID sem ícone falso. |
| Gênero/shiny | Glifos de gênero na [summary screen Emerald](https://github.com/pret/pokeemerald/blob/master/src/pokemon_summary_screen.c); selo de estrelas pedido para o Hub, sem arquivo correspondente comprovado na PokéAPI. | Glifos vetoriais/locais minúsculos e marca de centelhas com label acessível; asset local versionado, sem download inventado. |

`apps/frontend/package.json` executa `scripts/sync-pokemon-resources.mjs --background` no `predev`; o sync só roda se o catálogo de sprites não estiver completo, usa lock e troca diretório por staging. O manifest atual exige uma imagem normal e shiny por entrada, e o [Spec 020](020-local-pokemon-sprite-resources.md) exclui variantes só de gênero. Uma atualização do card não deve apagar/invalidar todo o catálogo de sprites para acrescentar alguns ícones. Definir manifest separado de ícones, atualização atômica e fallback local. O sprite Home atual pode não corresponder à arte específica por sexo em espécies dimórficas; isso é limite do catálogo atual, não erro do cálculo de sexo. Questões de procedência e distribuição dos atlas originais precisam ser resolvidas antes de automatizar download/empacotamento.

### Matriz de verificação para a implementação futura

1. **Parser:** fixtures independentes de R/S/E/FR/LG com 80/100 bytes, permutations de PID, checksum interno válido/inválido, todos os seis IVs, níveis por growth rate, nature, HP de Party, quatro moves/PP, item 0/presente, bola, OT ID, metGame, macho/fêmea/sem sexo, shiny e ribbons de Contest/booleanas/gift. Fixture sintética isolada não substitui amostra real não vazia validada contra jogo/decomp.
2. **Persistência:** record `pc-record` em Box/Hub, `party-record` em Party/Box, Party lógica dirty com `.sav` antigo, record movido com revisão nova e hash igual, source/record divergentes, hash/Base64/length inválidos, owner distinto e source ausente. Provar que o GET não escreve e que dado indisponível não vira zero/falso.
3. **HTTP:** as duas rotas GET entregam uma entrada para cada ID ocupado, mantêm layout/grid e erros preexistentes, não expõem bytes/Secret ID, não fazem fetch individual, não confundem `workspaceProfileId` com save profile. Verificar resultado sob mudança concorrente de revisão.
4. **Frontend:** Hub/Party/Box abrem card sem rede; três panes podem ter três cards; clique e teclado funcionam sem iniciar drag; drag não abre card; trocar/remover pane reconcilia card; correção 409/flush/reload invalida detalhe antigo; sprite/imagem faltante e dezenas de ribbons preservam leitura, foco e limites de pane.
5. **Regressão:** snapshots/heartbeat continuam compactos; transferência e Party guards das Specs 063/071 continuam com as mesmas regras; nenhuma gravação nativa decorre da abertura/fechamento do card; a aquisição e lançamento de jogo não passam a depender do catálogo visual de ícones.

### Sequência de implementação

1. Fechar fixtures e tabelas Gen III; extrair parser compartilhado com checksum, projeção pura e testes do mapa de campos.
2. Adicionar leitura coerente de source+records e projetor em lote no pacote; integrar os dois GETs e seus testes de contrato/erro/revisão.
3. Hidratar o mapa local no fluxo React **ativo**, reconciliar revisões e seleção independente por pane; implementar card e interação acessível de slots.
4. Produzir catálogo local de ícones validado e sua sincronização separada; conferir os três layouts e os casos de ausência de asset.

Essa ordem foi usada na implementação iniciada por solicitação explícita do usuário. As Specs 024, 029, 040, 063, 071 e 075 continuam definindo os limites de integridade que o card não deve mascarar.

### Estado da implementação iniciada em 27/09/2026

- `pokemon-gen3-card-data.mjs` projeta core nativo validado por checksum: sexo via tabela das 386 espécies Gen III, shiny, espécie, nível, seis stats, seis IVs, moves/PP, ribbons, OT público, jogo, Pokébola e item. `pokemon-gen3-name-catalog.json` guarda nomes nativos de espécies, moves e itens derivados das tabelas de `pret/pokeemerald`. Forma de Deoxys no Hub sem título atual fica com stats indisponíveis.
- `pokemon-hub-card-hydration.mjs` verifica placement, namespace, Base64, SHA-256 e checksum antes de projetar cada ID. HP atual da Party só vem do slot físico quando core, localização e save revision coincidem e o source está limpo. Falhas isoladas viram `availability: unavailable`.
- O coordinator expõe `getDetailSource` somente para leitura e confere fonte e records após carregá-los. `GET /api/pokemon-hub/profiles` e `GET .../layout` agora devolvem `pokemonDetailsById` no mesmo payload, sem bytes nativos. `GET .../layout` usa `workspaceProfileId` como owner efetivo. O frontend não chama API ao clicar em um slot.
- `pokemon-hub-ui.jsx` mantém mapa de detalhes e seleção independente para até três panes. Party, Box e Hub usam botões acionáveis por teclado; o card abre dentro da pane e fecha por botão ou Escape. Mudança de fonte ou snapshot corrige a seleção, e movimento local descarta HP atual em cache.
- `sync-pokemon-card-icons.mjs` baixa o atlas e cinco paletas originais de ribbons do decomp de Emerald e gera 32 ícones locais com manifest separado do catálogo PokéAPI. A obtenção é opcional: texto da ribbon continua visível sem imagem. Gênero e shiny usam pequenos glifos locais sobre o sprite.
- A validação automatizada cobre projeção, degradação por ID, Party dirty/revision, duas rotas HTTP, seleção após remoção de pane, catálogo de assets e lint. Ainda falta conferir visualmente o card com saves reais ocupados dos cinco títulos e validar o comportamento em viewport estreita com dados de produção; fixtures sintéticas não provam esses casos.

## Questões para a próxima revisão

- Confirmar se “status” também inclui condições temporárias da Party (paralisia, sono etc.); os seis stats, IVs e regra de HP já estão definidos acima.
- Validar dimensões responsivas e posição do controle de fechamento no workspace real.
- Validar a forma exata do selo de estrelas shiny e a procedência dos atlas de ribbon antes de produzir os assets locais.
- Definir idioma/fonte dos nomes de moves, itens, ribbons, jogos e bolas, com fallback para ID bruto.
- Definir a forma de migrar ou preencher `originSaveProfileId` em records existentes a partir de proveniência verificável. Decidir se esse ID fica apenas no backend ou entra em uma projeção técnica; o nome do profile não entra no card.
- Validar as tabelas e offsets em fixtures representativas dos cinco jogos, incluindo shiny, sem sexo, ovo, item ausente, ribbons, Party versus Box e Pokémon trocado entre versões.
- Auditar records persistidos em ambiente real de forma somente de leitura antes de qualquer migração: verificar hash dos bytes, formato da representação, source/placement e cobertura de registros, sem presumir que a existência de um `canonical` signifique completude.

## Critérios iniciais de aceite

1. Para o mesmo `pokemonInstanceId`, card aberto no save ou no Hub retorna os mesmos fatos nativos estáveis; mudanças de placement não alteram OT, origem, bola, ribbons ou shiny.
2. Um round-trip save→Hub→save conserva o core nativo byte a byte onde a política de transferência atual o permite. O card não participa da escrita.
3. Party e Box distinguem dados atuais de runtime dos derivados do core. Faltas de catálogo ou de interpretação são explícitas.
4. `GET /api/pokemon-hub/profiles` traz detalhes de todos os Pokémon de todos os Hub profiles retornados; `GET .../layout` traz detalhes de toda a Party e das 14 Boxes do save profile carregado. Nenhum clique em Pokémon faz requisição. Bytes cifrados, Secret ID e representação Base64 não são enviados ao browser.
5. Após movimento ou correção, o card usa o detalhe da revisão correta ou recarrega o perfil agregado; não mostra runtime antigo da Party, não acrescenta detalhes aos comandos canônicos e não consulta IDs isolados.
6. A hidratação e o card não gravam `.sav`, record ou campo derivado. Testes da implementação futura verificam as duas respostas agregadas, ausência de fetch por clique, projeção consistente sob revisão e fixtures Gen III validadas por título. Nenhum build é executado para este esboço.
7. Com três containers abertos, três cards independentes podem ficar centralizados, um por container, sem sobreposição entre containers. Cada card mantém sprite e ícones de gênero/shiny visíveis, mostra seis stats e respectivos IVs, moves e ribbons com ícones originais quando disponíveis.

