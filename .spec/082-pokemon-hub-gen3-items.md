---
title: Pokémon Hub — itens da geração III
date: 2026-09-28
tags: [spec, pokemon-hub, gen3, items, saves]
status: levantamento de requisitos
---

# Spec 082 — Controle de itens da geração III

## Intenção e estado

Este é o spec canônico desta conversa para o controle de itens. O objetivo pedido é dar a cada **perfil do Pokémon Hub** uma aba **Itens**, capaz de guardar quantidades sem limite fixo de slots, e permitir retirar itens dos saves e devolvê-los. Os saves abrangidos são os de **Ruby, Sapphire, Emerald, FireRed e LeafGreen**. O usuário quer inspecionar os espaços livres no PC e em cada bolso da Bag, ler os itens do PC e do inventário, empilhar itens iguais e traduzir seus IDs entre jogos. As restrições de quais itens podem circular e de como circulam serão decididas depois. Este documento registra requisitos e uma proposta de contrato; não autoriza implementar transferências com política ainda indefinida.

“Computador” pode significar o PC de itens **dentro do save** ou o armazenamento do Pokémon Hub. Aqui os dois são locais distintos: `save.pc` e `hub.items`. Esta versão pressupõe movimentos `save.bag → hub.items`, `save.pc → hub.items`, `hub.items → save.bag` e `hub.items → save.pc`. Movimento direto `save.bag ↔ save.pc`, sem passar pelo Hub, fica como decisão aberta.

## Escopo

- Um armazenamento de itens por `hubProfileId`, independente da grade de Pokémon desse perfil e dos outros perfis Hub.
- Leitura de todos os slots de itens do PC e dos cinco bolsos da Bag de cada save suportado: Items, Key Items, Poké Balls, TMs/HMs e Berries. Em FireRed/LeafGreen, os dois últimos aparecem no jogo como TM Case e Berry Pouch.
- Projeção de slots ocupados, quantidades, capacidade e `freeSlots` por bolso e para o PC. A contagem é de **posições disponíveis**, não de unidades que ainda cabem numa pilha existente.
- Transferência de itens entre Hub e save, sujeita à política que será definida; a quantidade transferível e a divisão/soma de pilhas devem preservar a contagem total do mesmo item semântico.
- Mapeamento explícito de identidade semântica para ID nativo em cada título. Um número de ID igual em dois jogos não prova que seja o mesmo item; nomes traduzidos também não são identidade suficiente.
- Projeção e edição somente de saves geridos pelo backend, associados ao perfil real e ROM verificada. Nenhum upload de `.sav` ou edição binária pelo navegador.

Fora deste recorte de **leitura e edição de saves**: jogos de outras gerações, ROM hacks com tabelas/layouts diferentes, item segurado por Pokémon, Mail anexado a Pokémon, Pokéblocks, decoração, dinheiro, moedas, criação de itens, edição de flags de evento/progresso e uma página separada de detalhes de item. O catálogo **visual** de sprites abaixo tem alcance maior: deve contemplar itens conhecidos de todos os jogos Pokémon, mesmo que o Hub ainda não leia seus saves.

## Evidência levantada no projeto

- `apps/packages/pokemon-gen3-save-validation.mjs` seleciona uma cópia válida e não ambígua do save e resolve offsets lógicos por seção.
- `apps/packages/pokemon-gen3-inventory.mjs` já lê **Key Items** e **PC**, incluindo a chave de quantidade de Emerald/FireRed/LeafGreen, mas só escreve os quatro itens de evento catalogados; não é ainda um adaptador geral de inventário.
- O Spec 074 trata da entrega automática de itens de evento e de seus flags. Essa entrega é uma integração própria; um movimento comum de item não deve aplicar, remover nem inferir flags de evento por acidente.
- O Pokémon Hub já usa perfis Hub persistidos, fontes de save selecionadas, sessões/snapshots canônicos, lease global por save e flush de `.sav`. O inventário precisa respeitar a mesma identidade `{profileId, gameId}`, exclusividade e invalidação de runtime state que os movimentos de Pokémon.
- Os arquivos de origem dos jogos mostram cinco bolsos e um inventário de PC, cada um com capacidade por título. A tabela abaixo é de **slots nativos**, não de quantidades máximas por pilha.

| Save | PC | Items | Key Items | Poké Balls | TMs/HMs | Berries |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ruby / Sapphire | 50 | 20 | 20 | 16 | 64 | 46 |
| Emerald | 50 | 30 | 30 | 16 | 64 | 46 |
| FireRed / LeafGreen | 30 | 42 | 30 | 13 | 58 | 43 |

As capacidades vêm das constantes dos projetos [pokeruby](https://github.com/pret/pokeruby/blob/master/include/constants/global.h), [pokeemerald](https://github.com/pret/pokeemerald/blob/master/include/constants/global.h) e [pokefirered](https://github.com/pret/pokefirered/blob/master/include/constants/global.h). A organização dos campos em `SaveBlock1` é documentada nos respectivos arquivos `include/global.h`: [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/include/global.h), [Emerald](https://github.com/pret/pokeemerald/blob/master/include/global.h) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/include/global.h). Os offsets e a codificação foram mapeados no JSON abaixo; fixtures reais ainda são necessárias antes de escrever inventários gerais.

## Mapeamento binário pesquisado

O arquivo [pokemon-gen3-item-layouts.json](../apps/packages/pokemon-gen3-item-layouts.json) é o **catálogo legível por máquina dos endereços**. Ele cobre os cinco títulos em três perfis de formato, com origem das informações e commit do PKHeX fixados. Contém somente layout e regra de leitura: sua presença não habilita transferência de nenhuma classe de item. Esta pesquisa conferiu [PlayerBag3RS](https://github.com/kwsch/PKHeX/blob/09e7f18fbb33635e35cf9ffcbfd3322403780f8e/PKHeX.Core/Items/Bags/PlayerBag3RS.cs), [PlayerBag3E](https://github.com/kwsch/PKHeX/blob/09e7f18fbb33635e35cf9ffcbfd3322403780f8e/PKHeX.Core/Items/Bags/PlayerBag3E.cs), [PlayerBag3FRLG](https://github.com/kwsch/PKHeX/blob/09e7f18fbb33635e35cf9ffcbfd3322403780f8e/PKHeX.Core/Items/Bags/PlayerBag3FRLG.cs), seus `SaveBlock3Large*`/`SaveBlock3Small*` e o leitor [InventoryPouch3](https://github.com/kwsch/PKHeX/blob/09e7f18fbb33635e35cf9ffcbfd3322403780f8e/PKHeX.Core/Saves/Substructures/Inventory/Pouch/InventoryPouch3.cs). Só foram transcritos fatos de layout; código GPL do PKHeX não é copiado.

### Como chegar ao byte

1. O `.sav` gerido pelo projeto tem 128 KiB. As duas cópias principais começam em `0x00000` e `0x0E000`, com 14 setores de `0x1000` cada. Os setores rodam de posição física. A rotina existente `selectUnambiguousPokemonGen3SaveCopy` valida IDs, assinaturas, checksums e save index, seleciona a cópia mais nova e rejeita empate com conteúdo diferente. O [SAV3 do PKHeX](https://github.com/kwsch/PKHeX/blob/09e7f18fbb33635e35cf9ffcbfd3322403780f8e/PKHeX.Core/Saves/SAV3.cs) também reconstrói os blocos a partir dos IDs dos setores, em vez de confiar na ordem física.
2. O bloco pequeno fica na seção lógica `0`. O bloco grande concatena as seções `1` a `4`, cada uma com espaço lógico de `0xF80` bytes. Para offset `L` do bloco grande: `sectionId = 1 + floor(L / 0xF80)` e `sectorLocal = L % 0xF80`. O endereço físico é `selected.sectors[sectionId].offset + sectorLocal`. Para o bloco pequeno, usa-se a seção `0` e o offset direto. **Todas as seis áreas de itens destes cinco jogos estão na seção lógica 1**; isto não é um endereço físico fixo.
3. Cada slot ocupa quatro bytes: `uint16-le itemId` em `+0`, `uint16-le rawQuantity` em `+2`. O slot é vazio quando `itemId === 0`; nessa condição, não tratar `rawQuantity` como quantidade de item. Em Ruby/Sapphire, `quantity = rawQuantity` para Bag e PC. Em Emerald, `quantity = rawQuantity XOR (securityKey & 0xFFFF)` para a Bag, com chave `uint32-le` no bloco pequeno `0x0AC`. Em FireRed/LeafGreen, a mesma regra usa chave no bloco pequeno `0x0F20`. **PC não usa XOR** nos cinco jogos. Essa distinção consta em `PlayerBag3E`/`PlayerBag3FRLG`, que aplicam a chave a todos os bolsos exceto PC.
4. Para um slot `i`, `L = area.logicalOffset + 4*i`, com `0 <= i < area.slots`. Vagas são `count(itemId === 0)`. Um `itemId` ocupado com quantidade inválida ou desconhecida deve ser mostrado como problema de leitura daquela área e bloquear mutação até análise; não deve virar vaga automaticamente. O limite máximo aceito de cada pilha é regra de jogo/política futura, não dedução do campo `uint16` nem dos limites do editor PKHeX.

| Títulos | PC | Items | Key Items | Poké Balls | TMs/HMs | Berries | Chave da Bag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ruby/Sapphire | `0x498` | `0x560` | `0x5B0` | `0x600` | `0x640` | `0x740` | nenhuma |
| Emerald | `0x498` | `0x560` | `0x5D8` | `0x650` | `0x690` | `0x790` | bloco pequeno `0x0AC` |
| FireRed/LeafGreen | `0x298` | `0x310` | `0x3B8` | `0x430` | `0x464` | `0x54C` | bloco pequeno `0x0F20` |

Os números na tabela são **offsets lógicos no bloco grande**, não offsets absolutos do `.sav`. O PKHeX define os bolsos por deslocamentos relativos ao começo de `LargeBlock.Inventory`: `0x498` em Ruby/Sapphire e Emerald, `0x298` em FireRed/LeafGreen. Somar esses deslocamentos reproduz a tabela e os campos de `SaveBlock1` nas decompilações originais. O leitor atual já coincide para Key Items/PC; faltam os outros bolsos e o uso desse catálogo compartilhado. Não presumir que o JSON substituiu o código atual até uma implementação posterior fazer essa integração.

## Proposta de modelo e contratos

### Catálogo de itens

O pacote compartilhado em `apps/packages/` deve definir um catálogo versionado de `itemKey` estáveis, por exemplo `potion`, com `nativeIdByTitle` e metadados necessários para classificar o bolso válido em cada título. A tabela deve ser derivada e revisada **por título** a partir das constantes e definições originais de itens: [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/include/constants/items.h), [Emerald](https://github.com/pret/pokeemerald/blob/master/include/constants/items.h) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/include/constants/items.h). Itens sem equivalência comprovada não ganham mapeamento por proximidade de nome ou ID. O catálogo diferencia item existente, item sem correspondência no destino e ID desconhecido/inválido na origem.

O armazenamento do Hub usa `{hubProfileId, itemKey, quantity}` como agregado lógico. Dois depósitos do mesmo `itemKey` no mesmo perfil somam suas quantidades; perfis distintos nunca se misturam. A “lista infinita” significa ausência de limite de slots imposto pelo produto, não um inteiro ilimitado: quantidades e operações precisam de representação inteira segura, persistência paginável e limite técnico explícito contra overflow. Nenhum ID de item do save é a chave de persistência do Hub.

Como os itens da box do Hub podem ser reorganizados, a projeção de cada `itemKey` também precisa de uma **posição persistida** no perfil. Essa posição é independente da quantidade e da procedência. Reordenar altera apenas posições na mesma revisão de inventário, sem criar ou consumir unidades; um depósito de item já existente preserva sua posição em vez de criar outro cartão.

### Manifesto futuro de download dos sprites de itens

Haverá um **manifesto versionado e legível por máquina**, produzido quando a integração visual for implementada, para baixar localmente um ícone por identidade visual de item. Seu universo é a união dos itens conhecidos nos jogos oficiais de Pokémon, inclusive itens que ainda não podem ser transferidos e títulos além da geração III. Cobertura do manifesto visual não amplia a lista de saves editáveis. O `itemKey` semântico do catálogo de itens faz a ligação com o ícone; ID numérico de um jogo, nome localizado e geração do save nunca escolhem a imagem. Formas visuais realmente distintas (por exemplo, um item cuja arte depende de conteúdo/variante) exigem chave visual própria e vínculo explícito, sem colapsá-las por nome semelhante.

**Regra de escolha:** para cada chave visual, enumerar as artes candidatas **efetivamente atribuídas ao mesmo item**, com jogo/edição de origem comprovado. Selecionar o ícone da edição oficial mais recente que tenha uma arte verificável para aquele item. Se o item não aparecer ou não tiver arte acessível nessa edição, procurar a edição anterior mais recente que o represente; nunca usar automaticamente o sprite da geração do save. Quando duas edições contemporâneas tiverem artes diferentes, fixar uma precedência explícita e documentar a escolha. Data de upload, data do commit, resolução, nome do arquivo e URL `default` não comprovam modernidade da arte. Uma nova edição pode substituir a seleção apenas após revisão do vínculo item ↔ arte e da ordem cronológica de lançamento.

A [API de itens da PokéAPI](https://pokeapi.co/docs/v2#items) fornece identidade e uma URL `sprites.default`, mas não atribui nessa propriedade um jogo de origem. O [repositório de sprites da PokéAPI](https://github.com/PokeAPI/sprites) lista itens padrão e versões de sprites de Pokémon; isso, por si só, não demonstra que cada ícone de item seja o mais recente. O [PokéSprite](https://github.com/msikma/pokesprite) oferece mapa de itens e arquivos legados, úteis como candidatos e para comparação, mas também precisa de conferência por edição. Nenhuma fonte isolada deve ser tratada como lista completa de **todos** os jogos e itens. Na implementação, levantar catálogos por jogo, reconciliar a união de identidades e registrar lacunas, inclusive de títulos fora da série principal; não declarar cobertura total apenas por ter percorrido a PokéAPI.

Contrato proposto para o futuro `apps/frontend/pokemon-item-sprite-requirements.json` (nome sujeito ao padrão definitivo do projeto):

```json
{
  "schemaVersion": 1,
  "catalogRevision": "revisao-fixada",
  "items": [
    {
      "itemKey": "potion",
      "visualKey": "potion",
      "status": "resolved",
      "artworkOrigin": { "game": "edicao-verificada", "releaseOrder": 0 },
      "source": { "repository": "origem-verificada", "revision": "commit-fixado", "path": "caminho/na/origem.png", "url": "https://origem-verificada/arquivo.png" },
      "sha256": "digest-hexadecimal-verificado",
      "localPath": "/resources/items/potion.png"
    }
  ]
}
```

Os valores do exemplo são **marcadores de formato**, não fontes, ordem de lançamento ou hashes aprovados para download. Cada entrada efetiva deverá ter chave estável, estado `resolved` ou `missing`, edição de origem, origem e revisão imutável, URL, caminho local determinístico, SHA-256 e registro da situação de atribuição/uso da imagem. Entradas `missing` registram motivo e candidatos rejeitados; não apontam para uma imagem de outro item. O gerador valida unicidade de chaves e caminhos, resolução da fonte, hash, correspondência semântica, existência da arte e a ausência de candidato comprovadamente mais recente antes de publicar uma revisão. Um relatório de cobertura cruza todas as identidades inventariadas com entradas resolvidas/pendentes por jogo e distingue item sem arte conhecida de falha de coleta. Atualizações do catálogo geram revisão auditável do manifesto, sem sobrescrever silenciosamente a escolha anterior.

O download e a normalização de dimensões, quando implementados, pertencem a `apps/packages/`, seguindo o padrão de recursos locais dos [Specs 020](020-local-pokemon-sprite-resources.md) e [021](021-pokemon-hub-sprite-rendering.md): arquivo versionado de requisitos, cache local, verificação de hash e publicação atômica de cada recurso. Sprites baixados e inventário gerado ficam fora do Git. Ícone ausente mostra uma representação neutra do item e um diagnóstico de cobertura; não bloqueia leitura, transferência autorizada, lançamento ou persistência do save. **Nesta etapa não criar o manifesto de produção nem baixar imagens:** ficam definidos somente o contrato e a pesquisa necessária para preenchê-lo com fontes verificadas.

### Adaptador Gen III

Uma função de leitura por título retorna `saveRevision`, cada bolso e PC com `{capacity, freeSlots, slots: [{index, nativeId, itemKey?, quantity}]}`. A leitura de ID desconhecido preserva `nativeId` para diagnóstico e exibição segura; não o normaliza como outro item. O leitor valida cópia, seção, ocupação, quantidade e codificação antes de declarar um slot utilizável. Slots estranhos ou saves ambíguos não podem ser “consertados” silenciosamente por uma transferência.

O escritor atua sobre cópia privada do save validado. Ele calcula todo o resultado antes de escrever: subtrai da origem, distribui no destino compatível, empilha onde a política/capacidade permitirem, ocupa novos slots somente se necessário, atualiza checksums das seções tocadas e relê o resultado. Nenhuma falha pode publicar apenas metade da mudança. A representação nativa de quantidade da Bag em Emerald/FireRed/LeafGreen e a do PC são tratadas separadamente; a lógica específica da entrega de eventos não é reaproveitada como política geral.

### Transação e integração

Cada intenção identifica origem, destino, `itemKey`, quantidade positiva, revisão esperada de cada fonte e uma chave de idempotência. O backend confirma que o item e a quantidade ainda existem, que o destino é válido e que a política permite a operação. A conservação é por `itemKey`: quantidade antes = quantidade depois em todas as fontes envolvidas. Repetição da mesma intenção não duplica itens; conflito ou falha devolve projeção autoritativa atualizada sem alterar o saldo aceito.

Uma transferência que toca save adquire e mantém o lease global existente desse save. A estratégia de persistência precisa encaixar-se no coordenador atual de sessões/flush, ou ser demonstrada equivalente em atomicidade, recovery e fencing; **não** acrescentar campos de item ao snapshot de placements de Pokémon sem versionar e validar o contrato. Depois de gravar `.sav`, atualizar revisões e invalidar snapshots/runtime states antigos conforme as regras já vigentes. Um save em jogo ou sem lease disponível não pode ser alterado pelo Hub.

### Snapshot e prevenção de duplicidade de itens

O snapshot canônico atual de [Spec 029](029-pokemon-hub-canonical-session-snapshot.md) e `pokemon-hub-canonical-session-snapshot.mjs` só descreve **posições de Pokémon**. O coordenador confere IDs únicos, fontes reservadas, revisão e conjunto de registros antes de aceitar um movimento; o `save-flush` grava o `.sav` depois e invalida estados de runtime. Esses mecanismos são uma base de ciclo de vida, mas **não conferem saldo de itens**. Itens empilháveis são fungíveis: duas poções iguais não têm um ID individual confiável. Aplicar a regra “ID aparece uma vez” dos Pokémon a pilhas de itens não detectaria criação de unidades.

Para itens, a autoridade proposta é um **snapshot de inventário do backend** por fonte reservada: Bag/PC do save mais saldo do `hubProfileId`, todos com revisão e quantidades por `itemKey`. A UI lê projeções e envia uma intenção de deslocar `q` unidades entre duas fontes já identificadas; não envia um saldo arbitrário para ser aceito. O backend calcula o candidato a partir do snapshot confirmado. Para cada item semântico envolvido, `soma(quantidades antes, em todas as fontes da operação) = soma(quantidades depois)`. O delta da origem é exatamente `-q`, o do destino `+q`, e as demais chaves e fontes têm delta `0`. Divisão ou fusão de pilha altera slots, nunca esse saldo. Itens de evento automáticos do Spec 074 são operações de **grant** distintas, auditadas fora dessa conservação de transferência.

Uma projeção de leitura poderia ter a forma abaixo; é contrato de pesquisa, ainda não um endpoint implementado. `sourceRevision` representa a autoridade de cada fonte, `saveRevision` o último `.sav` materializado. `hubProfileId` e o identificador real de save permanecem separados. O servidor preenche quantidades e slots, e nunca recebe essa estrutura de volta como verdade absoluta.

```json
{
  "inventoryRevision": 12,
  "sources": [
    { "kind": "hub-items", "hubProfileId": "...", "sourceRevision": 8, "balances": [{ "itemKey": "potion", "quantity": 17 }] },
    { "kind": "save-items", "profileId": "...", "gameId": "pokemon-emerald", "sourceRevision": 4, "saveRevision": 3,
      "areas": [{ "id": "items", "capacity": 30, "freeSlots": 29, "slots": [{ "index": 0, "itemKey": "potion", "nativeId": 13, "quantity": 5 }] }] }
  ]
}
```

O exemplo de item/ID serve apenas para ilustrar o formato, não substitui o catálogo semântico por título. A intenção correspondente deve nomear origem/destino, slot de origem quando for save, `itemKey`, quantidade, revisões esperadas e idempotency key. O servidor resolve o ID nativo e bolso do destino; não confia em `nativeId` enviado pelo cliente. Para uma origem Hub agregada, não há slot físico. Mesmo que a UI mostre vários slots nativos do mesmo item, o backend confere a quantidade no slot escolhido **e** o saldo total da fonte.

O processamento da intenção deve seguir uma única serialização por sessão/fonte e fazer, nesta ordem: (1) conferir leases e fence global, ROM/título, revisões de inventário e save e chave de idempotência; (2) reler autoridade, validar item/quantidade/mapeamento/capacidade/política; (3) construir resultado para origem e destino em memória, inclusive forma dos slots nativos; (4) verificar conservação e limites inteiros; (5) persistir **um resultado canônico durável** com saldos, revisões, operação e marcador de save sujo em transição atômica; (6) materializar o save por compare-and-swap de revisão, invalidar os estados de runtime e só então liberar a fonte. Se a persistência do resultado envolver chaves/arquivos diferentes, usar journal ou transição atômica equivalente que permita concluir/repetir sem creditar o Hub duas vezes.

O materializador de `.sav` deve compor as posições autoritativas de Pokémon **e** o inventário autoritativo sobre a mesma base de save e fazer um único `saveStore.put` por revisão. Dois flushes independentes construídos a partir da mesma revisão poderiam sobrescrever as alterações um do outro. Se uma queda ocorrer depois do write do `.sav` e antes da confirmação do flush, reler a revisão e comparar com o candidato gravado: se já coincidir, concluir a mesma operação; se divergir, manter o lease/fence e sinalizar conflito para recuperação. Nunca repetir a intenção como novo depósito. Um replay com a mesma chave de idempotência e mesmo fingerprint devolve o resultado original; mesma chave com outro payload é conflito. O recibo precisa sobreviver até que o save e o saldo Hub estejam definitivamente conciliados, inclusive após fechamento ou expiração da sessão.

A entrega automática de eventos do Spec 074 também escreve itens no save. Se ocorrer após o player fechar e antes de uma adoção do Hub, a próxima leitura precisa partir da revisão nova. Se algum dia ocorrer enquanto a fonte de itens estiver reservada, deve entrar pela mesma autoridade de inventário ou aguardar a liberação: um grant paralelo aos saldos canônicos faria o próximo flush apagar o presente. O grant é uma criação autorizada de unidades, portanto seu recibo informa `itemKey`, `+q`, revisão e motivo; não deve ser disfarçado de transferência que promete conservação.

Se o cliente estiver otimista, uma rejeição por revisão ou lease substitui a projeção local pelo snapshot de inventário autoritativo. O formato `{revision, panes}` usado pelos snapshots de Pokémon não deve receber itens informalmente: a futura API de itens precisa de contrato e revisão próprios, vinculados à sessão existente, sem alterar o esquema estrito da correção de Pokémon. Fechar/remover pane ou expirar sessão exige o mesmo flush final e barreira de lease para itens. Uma cópia antiga do save, snapshot de emulador ou recuperação local não pode ser aceita como novo save depois de uma retirada para o Hub; usar os marcadores/fences e a invalidação de [Spec 070](070-pokemon-hub-runtime-state-invalidation.md) e [Spec 040](040-global-game-save-access-leases.md).

**Limite da garantia:** isso evita duplicação nos fluxos geridos pelo produto. Se um `.sav` antigo for reintroduzido por um caminho externo, nenhum contador de slots prova sozinho a origem das unidades iguais. O backend precisa detectar divergência do fingerprint/revisão conhecida e bloquear reconciliação automática desse save até existir uma política explícita de restauração. Não prometer prevenção absoluta contra edição externa do arquivo.

O backend mantém catálogo, bytes, regras e saldos. O frontend React em `apps/packages/pokemon-hub-ui.jsx` mostra a aba **Itens** do perfil Hub selecionado e as projeções de PC/Bag das fontes de save carregadas, incluindo vagas por área e motivo de uma transferência indisponível. A navegação exata entre Pokémon e itens nas panes existentes fica para o desenho de interface, sem criar página de detalhes ou controles adicionais por suposição. A UI envia intenção, nunca offsets, checksum, bytes ou ID nativo escolhido por ela.

### Layout da lista de itens do perfil Hub

A aba **Itens** reutiliza o padrão de grade de quadrados já usado no perfil Hub. Cada item semântico agregado aparece uma única vez: o quadrado contém seu ícone, a parte superior mostra `×N` com a quantidade total daquele item no perfil, e o nome legível fica **abaixo do ícone**. O tamanho dos quadrados pode aumentar em relação aos de Pokémon para acomodar o nome sem prejudicar a leitura do ícone ou da quantidade. A grade se adapta à largura disponível sem cortar esses três elementos.

Não mostrar jogo, save, bolso, ID nativo, data ou histórico de origem em cada item, nem criar agrupamento por procedência. Itens iguais vindos de jogos diferentes continuam em um único quadrado com a quantidade somada. A origem técnica permanece apenas nos dados necessários à transação, ao snapshot e à auditoria; ela não faz parte do cartão visual. A disposição de Bag e PC nas panes de save continua pendente.

### Arrastar, empilhar, posicionar e escolher quantidade

O gesto de arrastar tem três resultados distintos, calculados pela **identidade semântica** do item e pelas fontes/áreas envolvidas:

1. **Dentro da mesma box do Hub:** soltar sobre outra posição reorganiza os cartões conforme a posição escolhida. É uma operação de ordem, sem modal de quantidade e sem mudança de saldos. O backend persiste a nova ordem com revisão; uma resposta antiga não pode desfazer a organização atual.
2. **Entre fontes, item já presente na área de destino:** o item entra na pilha existente. A posição física sobre a qual o ponteiro é solto não cria uma segunda entrada nem substitui o outro item que estiver ali. Durante o arraste, a UI localiza o cartão/slot do mesmo `itemKey` no destino, aplica nele uma **borda espessa e bem visível** e rola automaticamente o contêiner de destino até colocá-lo à vista quando necessário. O realce acompanha mudanças de lista/scroll e desaparece ao cancelar, sair do destino ou terminar a operação. A escolha da pilha é semântica, nunca comparação de ID nativo entre jogos.
3. **Entre fontes, item ainda ausente da área de destino:** a posição de soltura determina onde a nova entrada será inserida. Na box do Hub, isso define a posição persistida do novo cartão; numa área do save, aponta o slot vazio compatível que deverá ser validado e ocupado. Soltar sobre item diferente não o substitui: o alvo de inserção precisa ser inequívoco e válido. Se não houver espaço ou destino válido, indicar o motivo e não abrir confirmação de uma transferência impossível.

Em **toda transferência entre fontes**, soltar abre um **modal sobre o contêiner de destino** para escolher a quantidade; soltar sozinho não movimenta nenhuma unidade. O modal identifica item, origem e destino apenas no contexto da operação, mostra uma quantidade editável `q` e exige confirmação explícita. Cancelar fecha o modal e deixa posições e quantidades intactas. Para destino Hub, mostrar `q / disponível na origem`: o Hub não limita a pilha pelo número de unidades. Para destino em jogo, mostrar `q / máximo transferível agora`, bem como o saldo existente no destino e o teto aplicado, para que o usuário entenda por que o máximo é menor que a origem. A quantidade deve ser inteira, com `1 ≤ q ≤ máximo`; se o máximo virar zero antes da confirmação, impedir o envio e atualizar a projeção. O valor inicial de `q` e o controle exato de edição ficam para a implementação visual, sem assumir que o usuário quer transferir tudo.

O máximo exibido é uma **prévia** derivada do snapshot atual, nunca uma autorização definitiva. Para uma pilha de destino em jogo, `disponívelOrigem = S`, `existenteDestino = D` e `limiteDestino = L`; o espaço nessa pilha é `max(0, L - D)`, então `máximo = min(S, espaçoNaPilha, capacidadeFísicaRestanteAplicável)`. A capacidade física considera slot compatível, vagas e as regras nativas daquela área. Se o item já existe, a UI não cria outra pilha para contornar o teto do cartão destacado; o tratamento de saves que já contenham várias pilhas nativas do mesmo item exige regra explícita antes da escrita. Se o destino for o Hub, `máximo = S` porque sua pilha não tem teto de jogo, preservados apenas limites técnicos de inteiro. O backend recalcula tudo no momento da confirmação com as revisões de origem/destino, rejeita `q` fora do intervalo e devolve saldos atualizados se algo mudou durante o modal.

Exemplo em **Emerald, bolso Items**, com uma pilha existente de 10 e limite 99: se a origem tem 10, o modal mostra até `10`; confirmar `10` deixa 20 no destino. Se a pilha de destino tem 90 e a origem tem 10, o modal mostra até `9`; confirmar `9` deixa 99 no destino e 1 na origem. O [código original de Emerald](https://github.com/pret/pokeemerald/blob/master/include/constants/items.h) define 99 para itens comuns da Bag, mas 999 para PC e Berries; [a rotina de adição](https://github.com/pret/pokeemerald/blob/master/src/item.c) aplica limites por bolso e pode distribuir certas categorias em mais de um slot nativo. Portanto, `L` deve vir de uma tabela verificada **por título, área e categoria**, não de uma constante global de 99 nem da largura `uint16` do save. O exemplo fixa a experiência de empilhar no cartão existente; a política para múltiplos slots nativos e para classes especiais continua pendente.

O drop confirmado envia uma intenção de transferência com `q`, posição/slot alvo quando houver criação, revisões esperadas e chave de idempotência. O backend revalida item, destino, teto, vagas e posição antes de persistir; transferência parcial reduz apenas `q` na origem e aumenta apenas `q` no destino. Se a confirmação falhar, o modal explica o conflito e atualiza o máximo, sem aplicar uma parte silenciosa da quantidade pedida. A rolagem e o realce são assistência visual e não alteram snapshot, saldos ou ordem por si só.

## Abordagens consideradas

1. **Recomendação: catálogo semântico + adaptador por título + transação no ciclo de sessão existente.** Permite empilhar o mesmo item de jogos diferentes no Hub e aproveita leases, revisões e recovery. Exige ampliar com cuidado a projeção de sessão e o materializador de save.
2. **Guardar pilhas com ID nativo e título de origem.** É simples para devolver ao mesmo jogo, mas não resolve a identidade entre jogos nem o empilhamento solicitado; fica descartado como modelo principal.
3. **Criar serviço isolado que edita `.sav` fora da sessão do Hub.** Reduz a integração inicial, mas abre concorrência com player, Pokémon e flush; fica descartado sem prova de equivalência de fencing e recuperação.

## Regras de integridade já fixadas

- Nunca trocar um item por outro por fallback de ID, nome parecido ou bolso parecido.
- Se o destino não tiver item correspondente, não escrever um ID substituto.
- Não sobrescrever slot ocupado, ultrapassar quantidade/slot nativo, truncar inteiro nem aceitar quantidade negativa ou zero.
- Não tocar em Pokémon, itens segurados, flags, progresso, outras seções ou na outra cópia do save por causa de uma operação de item, salvo os metadados/checksums necessários ao save válido.
- Falhas de catálogo, leitura, validação, mapeamento, capacidade ou persistência não devem enfraquecer a validação do save nem deixar item duplicado/perdido.
- O fluxo de itens não vira requisito para iniciar um jogo e carregar/salvar normalmente.

## Decisões pendentes para a próxima conversa

1. **Elegibilidade:** quais classes podem sair/entrar no save? Key Items, TMs/HMs, itens de evento, Mail, itens exclusivos de versão e itens sem equivalência exigem política explícita. A entrega automática do Spec 074 continua independente.
2. **Destino no save:** permitir retirada/devolução em qualquer bolso válido e PC, ou limitar certas classes/rotas? Haverá movimento direto Bag ↔ PC?
3. **Pilhas nativas:** completar a tabela de limite por título/área/categoria; decidir leitura e escrita de múltiplos slots do mesmo item já existentes no save, duplicatas e compactação, sem contornar a pilha destacada na UI.
4. **Controle de quantidade:** decidir valor inicial do modal e forma de edição; a confirmação de quantidade inteira entre 1 e o máximo calculado já está fixada acima.
5. **Itens ligados ao estado do jogo:** registered item, evento/flag, TM Case/Berry Pouch e outros metadados exigem regras específicas antes de permitir mutação correspondente.
6. **Experiência visual ainda aberta:** disposição de Bag/PC nas panes de save e navegação entre Pokémon e itens; a grade de itens do perfil Hub está definida acima.

Enquanto essas decisões estiverem abertas, o caminho implementável com segurança é **leitura e contagem**. Movimentação fica especificada como comportamento desejado e não deve ser liberada por uma regra implícita de “todos os itens”.

## Verificação exigida quando houver implementação

- Fixtures de saves reais/descartáveis para os cinco títulos: cópias/sectores válidos e ambíguos, cinco bolsos, PC, slots vazios/intercalados e quantidade codificada.
- Matriz completa `itemKey ↔ nativeId` por título, com casos iguais, divergentes, ausentes e desconhecidos; round-trip de leitura/escrita sem alterar bytes não relacionados.
- Depósito e retirada parciais/totais, empilhamento de depósitos de jogos diferentes, capacidade de slot e pilha, falta de espaço, conflito de revisão, retry idempotente e falha após cada etapa persistente.
- Concorrência player/Hub e dois workspaces, fechamento/expiração de sessão, flush, invalidação de runtime state e reabertura do save no EmulatorJS para conferir PC e Bag no jogo.
- Cenários de queda entre commit do saldo, escrita do `.sav`, invalidação de runtime e marcação do flush; replay da mesma operação após resposta perdida; idempotency key reutilizada com payload diferente; Pokémon e itens alterados na mesma sessão antes de um único flush.
- A UI mostra capacidade e `freeSlots` corretos em cada bolso e PC e não apresenta o Hub como se tivesse slots nativos limitados.
- A aba Itens do perfil Hub mostra um quadrado por `itemKey`, com ícone, `×N` no topo e nome abaixo; a quantidade soma depósitos de jogos diferentes e o cartão não exibe origem.
- Arrastar dentro da box do Hub persiste somente a nova ordem; transferir entre fontes abre modal sobre o destino, permite quantidade parcial, destaca/rola até a pilha existente ou usa a posição de soltura para item novo, sem criar pilha duplicada no cartão destacado.
- Para destino em jogo, o máximo do modal respeita origem, quantidade já existente, teto verificado do título/área/categoria e espaço físico; em Emerald/Items, `S=10, D=10, L=99` permite 10 e `S=10, D=90, L=99` permite 9. Revisão alterada entre drop e confirmação recalcula/rejeita sem transferir parcialmente.
- O futuro manifesto visual cobre a união de itens inventariados por jogo, registra lacunas e variantes, seleciona para cada identidade a arte comprovadamente mais recente, fixa origem/hash e não usa a geração do save como critério; ausência de sprite não afeta o fluxo de save.
