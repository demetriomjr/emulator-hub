---
title: Pokémon Hub multi-select e transferência em grupo
date: 2026-09-28
tags: [spec, pokemon-hub, multi-select, drag-and-drop, integridade]
status: levantamento
---

# Spec 081 — Pokémon Hub: seleção por área e movimento em grupo

## Estado e objetivo

Este é o spec canônico desta conversa. Registra o comportamento pedido, o fluxo encontrado na árvore de trabalho de 28/09/2026 e as decisões de interação ainda abertas. Não autoriza implementação. O checkout tinha alterações locais preexistentes em UI, backend e specs 021/078/080; nenhum desses arquivos foi modificado por este levantamento.

O usuário quer selecionar vários Pokémon de **uma Box de Save ou de um perfil do Hub** desenhando um retângulo enquanto segura `Ctrl`, e arrastar a seleção como grupo para uma posição escolhida. Os espaços internos do arranjo devem sobreviver ao movimento, inclusive quando o primeiro Pokémon deve começar na segunda coluna do destino. Nenhum movimento pode perder, duplicar ou substituir Pokémon, nem violar as regras de save e transferência existentes.

## Comportamento solicitado

1. Enquanto `Ctrl` estiver pressionado, o drag normal de Pokémon fica desativado. Pressionar e arrastar o ponteiro desenha um retângulo visível; soltar conclui a seleção dos slots **ocupados** intersectados em uma única Box de Save ou em um único grid de perfil Hub. Seleção vazia não cria grupo.
2. Os itens escolhidos permanecem visualmente selecionados após soltar `Ctrl`. O drag iniciado em um item selecionado move o grupo inteiro. Clique simples em qualquer item ou outro lugar da tela limpa a seleção do grupo; esse clique conserva a ação normal do elemento, como abrir o card do Pokémon.
3. O grupo preserva offsets de linhas e colunas e lacunas entre itens. **A âncora é o Pokémon selecionado em que o usuário começou o drag**, mesmo quando ele não é o primeiro do retângulo. O slot sob o ponteiro indica onde essa âncora cairá; o algoritmo não procura automaticamente o próximo espaço livre nem compacta os Pokémon. Se a geometria, o limite ou a ocupação impedirem o encaixe, o drop inteiro é recusado, sem movimento parcial.
4. Durante o hover no destino, mostrar a projeção do grupo sobre os slots finais, preservando os espaços internos. Indicar quando o conjunto inteiro não encaixa e não insinuar um drop válido. Essa prévia usa a mesma função de mapeamento e validação do drop, sem alterar snapshots.
5. A operação é uma única intenção de workspace e uma única sincronização canônica, com a mesma garantia de correção, retry e fechamento que o movimento individual.

**Escopo assumido para este primeiro recorte:** seleção em uma única área contínua visível: uma Box de Save ou um perfil Hub. A Party permanece fora da seleção por área. Movimentos de Party existentes continuam como hoje. O usuário mencionou “dentro de um box, seja Save ou seja Pokémon Hub”; ampliar para Party, combinar origens ou atravessar Boxes em uma seleção exige decisão explícita.

## Fluxo atual confirmado no código

| Camada | Comportamento observado | Consequência para o grupo |
| --- | --- | --- |
| UI `pokemon-hub-ui.jsx` | `DragDropProvider` usa `PointerSensor` com distância 6. Cada slot ocupado registra `useDraggable`; todos os slots registram `useDroppable`. `onDragEnd` envia uma origem e um destino a `persistPokemonHubSessionMove`. | O provedor e o payload atuais representam um item; será preciso distinguir gesto `Ctrl` e arraste do grupo sem disparar o drag individual. |
| Seleção atual | `pokemonHubSelection` guarda até localizações de dois panes e aplica classe `selected` ao grid Hub e a uma grade auxiliar. `SaveSlot` não usa esse estado visual. `pokemonCardSelection` é independente e controla o card por pane/ID. | A seleção por área precisa de estado próprio por IDs e localizações de uma origem, aplicação visual na Box Save e Hub, e limpeza sem quebrar clique/card. Não reutilizar silenciosamente a seleção atual de dois panes como se fosse grupo. |
| Grade Save | `.pokemon-save-box-grid` fixa 6 colunas; a projeção usa 30 slots por Box. `sessionSlot` converte Box `b`, slot `s` em `party.length + b*30+s`. Somente a Box ativa aparece, com navegação anterior/próxima. | Um grupo de Box tem coordenadas locais de 6 colunas e não pode vazar para outra Box ao exceder a borda. A Party tem índice separado. |
| Grade Hub | `getPokemonHubColumnCount` deriva as colunas da largura disponível; `getPokemonHubVisibleSlotCount` mostra ao menos cinco linhas e uma linha extra após a maior ocupação. `createHubSessionSourceSnapshot` começa com pelo menos 60 placements; `extendHubSessionSourceSnapshot` cresce o vetor por slots contíguos. | Índice linear não preserva forma quando as colunas diferem. O plano deve usar coordenadas no layout de origem capturado e colunas atuais do destino. Extensão de slots visuais/autoridade precisa ser conferida para cada destino, respeitando o crescimento máximo. |
| Movimento local | `persistPokemonHubSessionMove` verifica origem ocupada, destino ocupado entre sources, Party e sessão; `applyLocalSessionMove` faz swap no mesmo source, move entre sources e compacta Party. Depois `schedulePokemonHubSnapshot` marca o snapshot sujo. | Repetir o movimento individual N vezes produziria estados intermediários, swaps, validações e snapshots parciais. O grupo deve construir primeiro o resultado completo e aplicá-lo de uma vez. |
| Snapshot canônico | `createCanonicalPokemonHubSnapshot` envia três panes, com ID+slot para Hub, Party e Boxes. O serviço de sessão reconstrói placements, compara o **conjunto** de IDs antes/depois e rejeita slot ausente; o coordenador verifica revisões, leases, duplicação, Party e políticas por Pokémon. | A intenção de grupo pode caber no protocolo de snapshot completo **se** o resultado for validado antes de publicar. Não há necessidade demonstrada de endpoint novo. O backend continua autoridade e pode devolver correção canônica. A comparação de conjunto não substitui a prova de multiplicidade; o coordenador detecta duplicação no resultado. |
| Regra de retenção Gen III | `evaluateGenerationIIITransfer` avalia `sourcePokemonCount - 1` para cada mudança individual. O coordenador passa a contagem original do source a cada Pokémon alterado. | Um grupo que exporte N Pokémon poderia satisfazer N validações individuais e deixar menos Pokémon que o mínimo. O backend precisará validar a contagem **final por source** para a transação inteira, mantendo as regras de título e destino por indivíduo. |
| Durabilidade | O frontend usa `snapshotFlight`/`requestGate`; mudança de pane drena o snapshot pendente; fechamento manda a intenção final. Save alterado é materializado por flush posterior. | Seleção transitória não deve ir para snapshot. A transação de placements é a unidade de persistência; preservar idempotência, revisão e recovery existentes. |

As regras de transferência vigentes estão nos Specs 024, 028–030, 040, 063, 070, 071 e 075. Este spec não altera essas regras. `pokemon-hub-grid-transfer-service.mjs` é um serviço separado de transferência individual e não é o caminho invocado pelo drag atual da UI; não basear o grupo nele sem encontrar consumidor real.

## Modelo proposto de seleção e geometria

Uma seleção tem `sourceKey`, área (`hub` ou `box` + índice da Box), conjunto de `{pokemonInstanceId, slot, row, column}` e quantidade de colunas usada na captura. IDs vêm do snapshot/projeção autoritativa, não de espécie, sprite ou ordem visual. O retângulo usa coordenadas de ponteiro do viewport para desenhar; somente os slots ocupados com interseção geométrica pertencentes à área de origem entram no grupo. Começar fora de um slot deve funcionar; se o retângulo cruzar panes ou áreas, somente a primeira área ocupada alcançada participa — **hipótese a confirmar** para evitar operação com múltiplas origens.

Offsets são calculados a partir do slot selecionado em que o usuário segurou o ponteiro para iniciar o drag. Para cada selecionado, `deltaRow = row - anchorRow` e `deltaColumn = column - anchorColumn`. No hover e no drop, o slot sob o ponteiro é a posição da âncora: calcular `targetRow + deltaRow` e `targetColumn + deltaColumn`; rejeitar se coluna/linha sair do grid. Converter cada par em slot com o número de colunas **do destino**, sem usar a largura do grid de origem para indexar o destino. Um grupo esparso mantém células não selecionadas vazias entre seus itens; não é necessário reservar o retângulo inteiro, apenas as posições finais dos Pokémon.

Mudança de largura do pane Hub, navegação de Box, troca de source, correção do backend, perda de lease, fechamento ou atualização autoritativa que invalide qualquer ID/slot selecionado limpa a seleção antes de outro drag. A geometria para um drag iniciado deve ser congelada no começo do gesto e validada novamente no drop.

## Validação de um drop em grupo

1. Resolver origem e destino nos snapshots carregados da sessão; conferir que cada ID selecionado ainda ocupa seu slot original e que todos os IDs são distintos. Nenhum source novo pode ser inferido apenas de elemento DOM.
2. Verificar área de destino permitida. Para este recorte: Box de Save ativa ou grid Hub. Party não recebe grupo. Conferir regras por Pokémon para o par de sources e condições da transação inteira, inclusive o mínimo de Pokémon restante por save exigido pela política Gen III e a preservação de ao menos um Pokémon na Party (mesmo que o recorte atual não selecione Party). O backend deve impor as condições agregadas, não confiar apenas na pré-validação da UI.
3. Calcular todos os slots finais antes de tocar em placements. Rejeitar coluna negativa, wrap de linha, Box diferente, slot fora da capacidade Save, índice inválido/fora do limite de crescimento do Hub, ou dois itens mapeados ao mesmo slot.
4. Simular a remoção de **todos** os IDs selecionados da origem; então conferir ocupação dos destinos no estado resultante. Sobreposição consigo mesmo é permitida. Um Pokémon não selecionado no destino bloqueia o grupo inteiro, inclusive dentro do mesmo source. O swap individual atual não define um swap coletivo e não deve ocorrer por acidente.
5. Construir cópias de todos os snapshots afetados, removendo cada ID exatamente uma vez e inserindo cada ID exatamente uma vez. Comparar o multiconjunto de IDs antes/depois e validar unicidade de ocupação, shape de Party, source ownership e índices canônicos. Somente depois publicar localmente e marcar **um** snapshot dirty.
6. Se o backend corrigir/rejeitar, aplicar o snapshot canônico e limpar a seleção. Uma falha ou resposta perdida segue o mecanismo de retry/idempotência atual; não repetir N operações individuais.

**Exemplo de colocação:** numa Box de 6 colunas, itens nas colunas 2 e 4 da mesma linha têm offsets 0 e +2 se o drag começa na coluna 2. Soltar na coluna 2 de uma Box destino ocupa colunas 2 e 4; coluna 1 permanece como estava. Soltar na coluna 5 é inválido porque o segundo item excederia a sexta coluna.

## Pontos que precisam de decisão antes do desenho final

1. **Retângulo cruzando áreas/panes:** fixar a primeira Box/grid alcançada, a área sob o ponteiro inicial, ou permitir múltiplas origens? Recomendação inicial: uma única área de origem, pois o layout e o source são distintos.
2. **Arraste sobre slot ocupado no mesmo source:** recomendação inicial é bloquear Pokémon não selecionado; isso muda o swap para grupos, mas deixa o swap individual intacto. Confirmar a expectativa visual e de interação.
3. **Grid Hub responsivo:** se a largura mudar após selecionar, limpar seleção ou manter os offsets capturados? Recomendação inicial: limpar, porque a forma visível mudou.
4. **Retângulo e controles:** definir se `Ctrl` + drag iniciado em cabeçalho, botão de navegação ou card deve produzir seleção ou respeitar o controle. Recomendação inicial: não interceptar controles interativos; iniciar no fundo/área dos slots.

## Verificação exigida na futura implementação

- Seleção por `Ctrl` em Box Save e Hub; drag individual bloqueado enquanto `Ctrl` está pressionado; clique simples limpa a seleção e preserva card/controle.
- Geometrias esparsas, primeira coluna vazia, diferentes larguras de origem/destino, Box de 6 colunas para Hub responsivo e vice-versa, bordas, overflow e crescimento de Hub.
- Movimento dentro do mesmo source com sobreposição consigo mesmo, destino ocupado por não selecionado, cross-source, grupo de um item, drop fora de alvo, mudança de pane/Box/largura durante seleção.
- Snapshot único, multiconjunto de IDs invariável, slot único por ID, correção 409, retry após resposta perdida, close/flush e invalidação de runtime state quando Save muda.
- Regras de transferência Gen III aplicadas a **cada** Pokémon e mínimos de retenção calculados sobre o estado final de cada source, além das regras de Party; cenários negativos não alteram estado local nem canônico. Caso essencial: exportar vários Pokémon que passariam isoladamente mas juntos deixariam o save abaixo do mínimo.

Nenhum build, commit ou deploy faz parte deste levantamento; as regras locais exigem pedido explícito no prompt corrente para build e commit.
