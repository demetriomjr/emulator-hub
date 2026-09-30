---
title: Pokémon Hub — remoção de ownerProfileId e independência dos containers
date: 2026-09-30
status: implementação e validação automatizada concluídas; migração real ensaiada e auditada três vezes em dev
---

# Spec 086 — Remover a propriedade entre perfis do Pokémon Hub

## 1. Objetivo e limite desta etapa

Documentar o problema, reconstruir a razão técnica da introdução de
`ownerProfileId` e levantar os requisitos para eliminar esse vínculo do sistema.
O usuário determinou a interrupção do fix em andamento e o início desta spec.
O levantamento anterior foi documental. A implementação por tópicos foi
autorizada posteriormente; o registro de execução está na seção 24. Os limites
de autonomia para decisões de arquitetura e infraestrutura continuam aplicáveis.

Este documento substitui integralmente o rascunho 086 anterior desta conversa e
permanece como sua única spec canônica. A proposta anterior de persistência
compartilhada não era uma decisão aprovada na etapa documental; as decisões
posteriormente aprovadas e sua implementação estão discriminadas na seção 24.
As alterações locais de código e testes iniciadas antes da interrupção continuam
incompletas, sem commit e sem validação integral. Não representam o estado de
produção nem uma implementação concluída deste documento. Não houve deploy.

A análise do comportamento anterior usa o código versionado em `ec84597` e seu
histórico, distinguindo-o das alterações locais interrompidas. A restauração dos
dados de produção está sendo tratada em outro chat e não pertence a esta etapa.

**Limite explícito de autonomia:** decisões de arquitetura e infraestrutura
devem ser tomadas junto com o usuário. O agente não tem autorização para escolher
sozinho topologia, armazenamento, protocolo transacional, infraestrutura de
backup, estratégia de migração/corte ou mecanismos equivalentes. Ao precisar de
uma dessas decisões, deve apresentar a questão, as alternativas e suas
consequências ao usuário antes de prosseguir com trabalho dependente dela.
Requisitos fornecidos pelo usuário não devem ser confundidos com aprovação de
uma solução técnica. A seção 2 consolida o comportamento definido em conjunto;
os mecanismos de implementação ainda dependem das decisões indicadas adiante.

## 2. Design consolidado da sessão, dos perfis e do backup

Esta seção reúne o comportamento definido pelo usuário ao longo da conversa e
é a referência funcional para o restante da spec. A unidade do backup está
definida: **uma cópia original por perfil, capturada na primeira abertura desse
perfil em cada sessão e preservada durante todo o trabalho**. A interpretação
anterior de gerar backup a cada alteração foi substituída por este contrato.

### 2.1 Objetivo e modelo das caixas

O Pokémon Hub é uma mesa de trabalho onde o usuário organiza conteúdo entre
caixas independentes. Existem caixas de estoque, representadas pelos perfis Hub,
e caixas de cliente, representadas pelos perfis de Save. É possível mover
conteúdo do estoque para um cliente, de um cliente para o estoque, diretamente
entre clientes ou entre caixas do estoque. O destino de um objeto é determinado
pela intenção de movimentação, nunca por uma relação de propriedade entre os
perfis.

Na camada que organiza esse trabalho, **perfil é perfil**. Hub e Save têm a
mesma condição de origem ou destino. Seu tipo continua informando como ler,
validar e persistir o conteúdo no formato adequado, mas não estabelece hierarquia
nem exige uma combinação Hub/Save para iniciar ou continuar a sessão.

O dia de trabalho da analogia corresponde a uma sessão do Pokémon Hub,
identificada por `sessionId`. Não precisa durar um dia civil: cada abertura do
Pokémon Hub inicia seu próprio período de trabalho. As caixas podem entrar,
sair e voltar durante esse período sem mudar sua identidade ou reiniciar a
sessão. O container é somente o lugar onde uma caixa está aberta naquele momento.

O objetivo combina organização fluida, conservação do conteúdo e recuperação.
Uma transferência retira uma instância de Pokémon da origem e a coloca no
destino uma única vez; para itens, diminui e aumenta a mesma quantidade. O estado
atual é acompanhado e salvo durante o trabalho. O backup permite recuperar os
originais se houver erro humano ou bug, sem interferir no fluxo normal.

### 2.2 Sessão, estado ativo e backup têm papéis distintos

| Elemento | Responsabilidade e ciclo de vida |
|---|---|
| Sessão | Identifica uma abertura do Pokémon Hub e organiza todo o trabalho realizado nela. Surge automaticamente antes da escolha do primeiro perfil e é comunicada ao backend. |
| Blocos ativos | Até três lugares de trabalho, que podem ser acrescentados ou removidos. Cada bloco pode receber um perfil Hub ou Save e trocar entre quaisquer desses tipos. |
| Estado e snapshots ativos | Representam os perfis atualmente abertos e as movimentações em curso. Frontend e backend mantêm esse controle para validar as transições, conservar conteúdo e impedir duplicidade. Mudam conforme o trabalho avança. |
| Persistência atual do perfil | Mantém o resultado atualizado do trabalho no local de persistência daquele perfil. É atualizada durante a manipulação; ao fechar ou substituir o perfil, sua persistência precisa estar concluída antes da retirada do estado ativo. |
| Backup da sessão | Reúne os originais dos perfis que já passaram pela sessão. Cada perfil entra nesse conjunto uma única vez, na primeira abertura; sua cópia não é atualizada por movimentos, saves, fechamento ou reabertura. |

O limite de três se aplica aos blocos ativos, não ao número de perfis protegidos
pelo backup. Uma sessão pode trabalhar sucessivamente com muitos perfis e
acumular seus originais, mesmo que apenas três estejam abertos simultaneamente.

Snapshots ativos e backup não são intercambiáveis. O snapshot acompanha o estado
mais recente; o backup preserva o original. Remover um perfil do snapshot ativo
não apaga seu backup. Salvar o estado atual também não sobrescreve o original.
Manter snapshots em frontend e backend é parte obrigatória do contrato de
integridade; o mecanismo concreto para sincronizá-los ainda será definido em
conjunto. Duas cópias sem validação de transições não bastam para demonstrar essa
garantia.

### 2.3 Ciclo de trabalho e regra da primeira abertura

1. **Abrir o Pokémon Hub.** Gerar automaticamente a nova `sessionId` e informar
   ao backend que aquela sessão foi iniciada, antes de carregar qualquer perfil.
   Não esperar a primeira seleção, não derivar a sessão de um perfil e não pedir
   ao usuário que crie a sessão manualmente.
2. **Abrir um perfil em um bloco.** O backend verifica se aquele perfil específico
   já possui backup associado àquela `sessionId`. A identidade usada nessa
   verificação é a do recurso, não o nome apresentado nem a posição do bloco.
3. **Se ainda não existir backup.** Capturar e guardar o original íntegro antes
   de permitir manipulação pela sessão. A captura deve corresponder à versão
   efetivamente carregada. Se falhar, o perfil não pode entrar em uso editável
   sem essa proteção.
4. **Se o backup já existir.** Preservá-lo e seguir com a abertura do estado
   atual do perfil. Ignorar a criação de outro backup; não ignorar a abertura
   solicitada. Reenvio de requisição também não pode substituir o original.
5. **Manipular o conteúdo.** Movimentar entre origens e destinos explícitos,
   atualizar os snapshots ativos e salvar o estado corrente em tempo real.
   Essas alterações não geram novas versões do backup original da sessão.
6. **Fechar ou substituir o perfil.** Garantir a persistência do estado mais
   recente no backend, retirar o perfil do snapshot ativo e liberar ou reutilizar
   seu bloco. Seu backup original continua vinculado à sessão. Uma falha de
   persistência não pode ser apresentada como fechamento concluído com sucesso.
7. **Reabrir o mesmo perfil.** Carregar seu conteúdo atualizado, inclusive as
   alterações já feitas naquela sessão, e reutilizar o backup original existente.
   Reabrir não restaura nem cria outra identidade para os objetos.
8. **Encerrar o Pokémon Hub.** Concluir a persistência dos perfis ainda ativos e
   conservar os backups associados à sessão para a recuperação posterior. Uma
   próxima abertura inicia outra sessão, com sua própria verificação de backups.

Salvar durante a manipulação e garantir a persistência ao fechar são obrigações
complementares. O fechamento não é o único momento de salvamento. Frequência de
envio, agrupamento de escritas e protocolo de confirmação não foram escolhidos
por esta explicação; devem preservar o comportamento definido pelo usuário.

Trocar o perfil de um bloco executa o fechamento daquele perfil e a abertura do
próximo dentro da mesma sessão. Isso vale para Hub→Hub, Save→Save, Hub→Save e
Save→Hub. Os outros blocos preservam seleção e conteúdo; nenhuma troca local
justifica reiniciar a sessão, restaurar outros perfis ou exibir processamento
global. Uma transferência pendente envolvendo o perfil que sai precisa manter
a integridade das duas pontas, sem alterar um terceiro perfil alheio à operação.

### 2.4 Exemplo completo com cinco perfis e três blocos

Considere uma sessão S iniciada às 7h30, no horário de Brasília. H1 e H2 são
perfis Hub; A, B e C são perfis de Save distintos. "Original" abaixo significa
a versão capturada na primeira entrada do perfil em S.

| Momento | Perfis ativos após a ação | Backups preservados em S |
|---|---|---|
| Abrir o Pokémon Hub e organizar três blocos vazios. | Nenhum perfil carregado. | Nenhum; a sessão já existe no backend. |
| Abrir H1, A e B. | H1, A, B. | Original de H1, original de A, original de B. |
| Mover Pokémon e itens entre eles. | H1, A, B com estado atualizado e salvo. | Os mesmos três originais, sem alterações. |
| Substituir H1 por H2. | H2, A, B; H1 foi persistido e saiu do snapshot ativo. | Os três anteriores mais o original de H2, capturado antes de seu uso. |
| Substituir A por C. | H2, C, B; A foi persistido e saiu do snapshot ativo. | Os quatro anteriores mais o original de C. |
| Substituir H2 por H1 novamente. | H1 atualizado, C, B; H2 foi persistido. | Continuam os mesmos cinco originais; o de H1 não é refeito. |

Se P e Q saíram de A e foram para H1, reabrir H1 mostra P e Q no seu estado
atual; reabrir A mostra que eles já saíram. O backup de A ainda contém seu
original e o de H1 ainda contém o original anterior à entrada de P e Q. Essas
cópias são dados de recuperação, não outras localizações ativas dos Pokémon.

### 2.5 Significado de versão pré-session ID

"Versão pré-session ID" é o nome funcional dado pelo usuário ao original
protegido contra as alterações daquela sessão. A captura é progressiva: acontece
na primeira abertura de cada perfil, não por uma cópia antecipada de todos os
perfis existentes ao iniciar o Pokémon Hub.

Se S começou às 7h30 e um perfil só foi aberto às 8h, seu backup é capturado às
8h, antes de ser manipulado por S, e fica associado à sessão iniciada às 7h30.
Não se afirma que esse arquivo foi capturado às 7h30 nem que todos os originais
da sessão representam uma captura simultânea. Os dois momentos precisam ser
distinguíveis: início da sessão e primeira captura de cada perfil.

O original permanece o mesmo durante toda S, mesmo que o perfil seja aberto,
fechado, salvo e reaberto várias vezes. Em outra sessão, a primeira abertura
protege a versão encontrada naquela nova sessão, sem substituir o backup de S.
A política de retenção futura não está definida; fechar blocos ou encerrar a
sessão não é uma instrução para descartar os originais necessários à recuperação.

### 2.6 Identificação da sessão e escolha do backup para restauração

O usuário pode relatar: "Abri o Pokémon Hub às 7h30, horário de Brasília, e
encontrei um erro; preciso da versão anterior". A busca precisa localizar a
sessão desse período e, por sua `sessionId`, o conjunto de originais dos perfis
que passaram por ela, incluindo os que já tinham saído dos blocos ativos.

Data e horário de abertura, interpretados no fuso de Brasília, e a sequência de
aberturas permitem distinguir as sessões. O usuário pode esclarecer "foi na
segunda vez que abri o Pokémon Hub". Se as informações não identificarem uma
única sessão, o agente pergunta qual foi antes de restaurar; não escolhe por
proximidade de horário ou por suposição. O início e as primeiras capturas devem
ser recuperáveis no backend para sustentar essa identificação.

Depois de identificada S, o backup correto é o original de cada perfil dentro
de S. "Mais recente anterior" não significa escolher arbitrariamente o último
arquivo de backup do servidor ou a versão atual de cada perfil: significa
recuperar a versão protegida antes de aquele perfil ser manipulado nessa sessão.
O conjunto não é limitado aos três perfis visíveis no momento do erro.

A recuperação deve considerar todos os perfis envolvidos no trabalho que se
pretende desfazer. Restaurar A para antes de uma transferência e manter H1 com
os Pokémon recebidos de A poderia duplicá-los. Por isso, o backup por sessão é
uma base para recuperar o trabalho de forma coerente. O tratamento de alterações
posteriores, de outra sessão ou do player, e o mecanismo de restore ainda
precisam de decisão conjunta; esta explicação não autoriza sobrescrevê-los
automaticamente. Nenhuma seleção, troca ou reabertura normal aciona restauração.

### 2.7 Fronteira entre o design definido e a implementação pendente

Estão definidos o início automático da sessão, a igualdade dos perfis como
participantes, os até três blocos dinâmicos, o backup original único por
perfil/sessão, a persistência contínua do estado ativo, sua confirmação ao fechar,
os snapshots em frontend e backend e a identificação assistida da sessão para
recuperação. Esses comportamentos não permanecem como alternativas em aberto.

Permanecem para discussão conjunta os endereços físicos, as transações, a
sincronização dos snapshots, os mecanismos de concorrência, o armazenamento e a
retenção dos backups, a migração e a execução segura da restauração. Este texto
registra o design funcional em linguagem técnica, sem código de implementação
nem escolha unilateral de arquitetura ou infraestrutura.

## 3. Problema relatado

O usuário abriu três containers: um perfil Hub e dois perfis de Save. Depois de
mover Pokémon de um Save para o Hub, trocou somente o perfil Hub. Observou o
splash do container e um segundo splash cobrindo o workspace inteiro. Ao terminar,
os Pokémon reapareceram no Save; ao consultar o Hub anterior, estavam também lá.

Há três violações a investigar em conjunto:

1. A seleção de um Hub interfere no ciclo de vida dos Saves de outros containers.
2. Uma operação local ativa processamento visual global.
3. O estado anterior da origem pode reaparecer enquanto o destino mantém a
   transferência, resultando em duplicação.

Os dois splashes não provam, sozinhos, a existência de dois processos paralelos.
No código anterior, o fluxo da seleção ativa explicitamente o splash global
dentro de uma seleção que já tem splash local; a troca de sessão encadeia close,
open e recarga. O problema de escopo já existe sem presumir paralelismo.

## 4. De onde veio ownerProfileId

| Etapa | Evidência no repositório | Consequência |
|---|---|---|
| Modelo inicial | [Spec 011](011-profile-pokemon-hub.md) descrevia o Hub dentro do namespace de um perfil de jogo. | O motor inicial recebia `profileId` como contexto de inventário e transferência. |
| Perfis Hub independentes | [Spec 013](013-pokemon-hub-profile-creation-plan.md) define coleção própria, `hubProfileId` e armazenamento independente dos perfis genéricos e dos `.sav`. Seu documento não contém `ownerProfileId`. | A seleção de Hub passa a ter identidade própria; o motor antigo não deveria definir essa identidade. |
| Vínculo permanente | Commit `b9e136d`, de 18/09/2026, introduz schema 6, `bindOwner` e `ownerProfileId`. A [spec 026](026-pokemon-hub-persistent-grid-transfers.md) registra que uma grade fica vinculada permanentemente ao primeiro perfil que nela armazena um registro. | Hub independente é encaixado num motor particionado por perfil. Outro perfil passa a provocar conflito. |
| Dependências posteriores | Sources, records e leases usam chaves particionadas por `profileId`; a [spec 082](082-pokemon-hub-gen3-items.md) coloca o ledger de itens em `ownerProfileId + hubProfileId`. | O campo passa a localizar Pokémon e itens e a restringir operações. |
| Contorno na UI | Commit `815ca3b`, de 29/09/2026, acrescenta `switchPokemonHubSession`; a [spec 084](084-pokemon-hub-e2e.md) documenta fechar a sessão e recarregar todos os Saves ao mudar de owner. | Uma troca local de Hub vira uma transição global e restringe a coexistência de Hubs. |

A razão técnica inferida dessa sequência é a reutilização do namespace do motor
antigo para acomodar o novo perfil Hub. `ownerProfileId` permite encontrar a
partição em que o Hub foi guardado e impedir que outra partição trate a mesma
grade como se fosse uma fonte nova. Essa é uma dependência criada pela organização
do armazenamento, não uma necessidade funcional das caixas.

O histórico comprova a introdução da restrição e seu uso; não comprova que o
usuário tenha solicitado ou aprovado essa decisão. O usuário declara nesta
conversa que não a prescreveu nem recebeu explicação explícita. A existência de
uma spec ou de um commit não será usada como substituto dessa autorização.

## 5. Como o vínculo se tornou acoplamento

No código anterior à tentativa interrompida:

1. `pokemon-hub-profile-store.mjs::bindOwner` grava o vínculo e rejeita outro
   owner com `POKEMON_HUB_PROFILE_OWNER_CONFLICT`.
2. `server.mjs::acquirePokemonHubSnapshot` vincula o Hub ao perfil da requisição
   quando precisa adotar sua fonte. O vínculo pode ocorrer ao abrir a fonte,
   antes de uma transferência, apesar da formulação mais restrita da spec 026.
3. `pokemon-hub-redis-keys.mjs` inclui o perfil do workspace no endereço de sources,
   records e leases. `save:<saveProfileId>:<gameId>` pode, portanto, existir sob
   mais de um namespace, mesmo apontando para o mesmo Save físico.
4. `server.mjs::getSaveLayout` usa `workspaceProfileId` para escolher/adotar esse
   snapshot. A identidade física do Save e a partição do workspace se misturam.
5. `readProjectedPokemonHubProfile` usa `ownerProfileId` para buscar o snapshot,
   os detalhes dos Pokémon e o ledger de itens do Hub.
6. `pokemon-hub-item-transfer-service.mjs` exige owner igual ao perfil da sessão
   e usa esse perfil para endereçar o ledger. O vínculo já afeta Pokémon e itens.
7. `pokemon-hub-ui.jsx::submitStructuralPokemonHubPaneChange` escolhe o perfil da
   sessão a partir do owner do Hub selecionado. Se ele difere do atual, ativa o
   splash global e chama `switchPokemonHubSession`.
8. `switchPokemonHubSession` fecha a sessão anterior, abre outra e recarrega os
   Saves de todos os containers. Também rejeita dois Hubs de owners diferentes.

O mesmo campo passou a cumprir quatro papéis: endereço histórico dos dados,
restrição de operação, escolha da sessão e localização de itens. Nenhum deles
justifica uma relação permanente entre um Hub e um Save no comportamento desejado.

`profileId` continuará necessário quando identifica o próprio Save junto com
`gameId`. Um identificador de sessão também continua legítimo. Eles não podem
ser usados como um proprietário implícito dos conteúdos de outro perfil.

## 6. Evidências e limites sobre rollback e testes

- A regressão E2E executada antes da alteração do frontend comprovou que trocar
  somente o Hub emitia close de sessão e novas leituras dos dois Saves. Nessa
  fixture nova, não reproduziu o rollback de produção.
- Um teste isolado do flush comprovou que um source baseado numa revisão antiga
  podia sobrescrever um Save físico mais novo: o código usava a revisão atual
  lida do arquivo para o write, sem compará-la à revisão-base do source. O teste
  demonstra essa falha de validação; não reconstrói sozinho o incidente real.
- `getSaveLayout` combina inspeção do `.sav` com IDs do snapshot e evita readotar
  um snapshot dirty. Essa combinação exige investigação quando a projeção lógica
  já mudou, mas o arquivo ainda não foi materializado.
- A suíte anterior de ciclo de perfis materializava as transferências antes de
  alternar repetidamente os Hubs. Outro teste exigia a mensagem que impede dois
  owners diferentes. Esses testes protegiam o contorno implementado, sem provar
  o contrato de independência informado pelo usuário.

Remover o vínculo elimina a razão funcional para fechar e recarregar todo o
workspace ao trocar um Hub. Entretanto, apagar a propriedade, mantendo partições
duplicadas ou caminhos de restauração obsoletos, não demonstra que a duplicação
foi resolvida. O critério de conclusão é conservação comprovada do conteúdo.

## 7. Requisitos para remoção

| ID | Requisito |
|---|---|
| R01 | Eliminar `ownerProfileId` do modelo ativo, criação, normalização, projeções HTTP, seletores e decisões de negócio dos perfis Hub. |
| R02 | Remover `bindOwner` e as rejeições baseadas em igualdade entre perfil Hub e perfil de sessão/Save. Não recriar o vínculo sob outro nome. |
| R03 | Identificar Hub por sua própria identidade e Save pela identidade do próprio Save/jogo. Abrir em outro container ou sessão não cria outra versão autoritativa do conteúdo. |
| R04 | Permitir qualquer combinação de até três fontes distintas já suportadas: Hub/Hub/Hub, Hub/Hub/Save, Hub/Save/Save e Save/Save/Save. A ordem de abertura não altera compatibilidade nem persistência. |
| R05 | Fechar ou substituir qualquer perfil, Hub ou Save, conclui sua persistência e o retira do snapshot ativo do container escolhido. A sessão e os outros containers permanecem; não reler, publicar ou restaurar seus conteúdos por consequência da seleção. O backup do perfil que saiu permanece na sessão. |
| R06 | Mostrar processamento no container afetado. Nenhum splash global, bloqueio global ou limpeza de estado alheio deve decorrer de mudar seu perfil. Operações realmente dependentes de uma transferência pendente respeitam essa dependência, sem reinicializar caixas. |
| R07 | Conservar a identidade de cada Pokémon numa movimentação. Para itens empilháveis, conservar a soma das quantidades. Compatibilidade de jogos, slots e itens permanece validada pelas regras existentes. |
| R08 | Tratar origem e destino como uma operação indivisível no resultado confirmado. Falha, repetição, atraso ou perda de resposta não pode confirmar apenas uma metade nem aplicar a transferência duas vezes. Uma terceira fonte permanece inalterada. |
| R09 | Um Pokémon tem uma única localização autoritativa. A propriedade é verificada entre as fontes envolvidas e as fontes persistidas relevantes, não só entre os slots visíveis naquele momento. |
| R10 | Reabrir perfil, trocar container, fechar/reabrir workspace ou reiniciar serviço deve mostrar o último estado confirmado. Um snapshot ou `.sav` anterior não pode ressuscitar a origem de uma transferência. |
| R11 | Manter proteção contra escritores concorrentes e conflito com o player, baseada no recurso realmente editado. Lease identifica quem pode escrever temporariamente; não cria parentesco permanente entre perfis. |
| R12 | Retirar a dependência de owner dos itens do Hub, incluindo leitura, transferência, reordenação, exclusão e recuperação. Preservar quantidades, revisões e localização de cada ledger durante a transição. |
| R13 | Remover caminhos antigos de sessão/troca de perfil que reintroduzam o acoplamento, inclusive rotas ainda acessíveis e serviços legados. Só retirar código após mapear seus consumidores. |
| R14 | Preservar íntegros os Saves e os dados que não participam da operação. A remoção não altera progresso de jogo, eventos, bytes alheios à movimentação ou regras de descarte. |
| R15 | Testar comportamento e persistência reais. Aprovar a ausência textual de `ownerProfileId` ou a presença de um método não é prova suficiente de independência ou conservação. |
| R16 | Abrir o Pokémon Hub gera automaticamente uma nova sessionId e a comunica ao backend antes da primeira seleção de perfil. Identificar o ambiente exclusivamente por essa sessão, inclusive heartbeat, carga, sincronização, itens e encerramento. Referências a perfis identificam recursos participantes, nunca a sessão. |
| R17 | Preservar uma autoridade persistente por fonte, independente da sessão que a abriu. Não substituir o namespace de owner por cópias particionadas por `sessionId`. |
| R18 | Na abertura de cada perfil, verificar seu backup para a sessionId. Se ausente, capturar e verificar o original completo antes de liberar manipulação; se existente, mantê-lo sem nova captura. Falha na primeira captura impede uso editável sem backup. A regra é igual para Hub e Save. |
| R19 | Manter os originais associados à sessão e à identidade estável de cada perfil, com revisões/hashes e momentos de início da sessão e de captura distinguíveis. O conjunto cresce na primeira abertura de novos perfis e conserva os backups de perfis fechados, sem limite de três entradas e sem exigir captura simultânea. |
| R20 | Reabertura, salvamento, movimentação e retry não substituem nem versionam novamente o backup original de um perfil na mesma sessão. Reenvio de transferência também não pode aplicar o movimento duas vezes. Uma nova sessão tem seu próprio conjunto de originais. |
| R21 | Aceitar origem e destino explícitos em qualquer direção suportada. O tipo de perfil seleciona o adaptador e valida a capacidade, mas não determina qual lado pode ocupar nem um perfil proprietário. |
| R22 | Manter snapshots ativos no frontend e backend para controlar a integridade das transições. O estado atual é manipulado e salvo em tempo real, com persistência concluída ao fechar cada perfil; não esperar somente o fechamento para salvar. Distinguir preview, confirmação durável e materialização, impedindo que fechamento, expiração ou reinício exponham duas metades de uma transferência. |
| R23 | Impedir que respostas antigas, operações expiradas ou observadores de outra sessão escrevam numa revisão mais nova. A validação deve proteger a gravação, não somente a entrada da requisição. |
| R24 | Aplicar as mesmas garantias às rotas alternativas, jobs, reordenações, exclusões e recuperação. Não deixar um escritor antigo capaz de contornar backup, identidade ou exclusão mútua. |
| R25 | Preservar o fluxo do player: lease do Save real, gravação íntegra, revisão, invalidação de estados de execução incompatíveis e adoção posterior sem criar autoridade paralela. |
| R26 | Preservar histórico e procedência como informação histórica. Ter vindo de um Save não torna o Pokémon ou o Hub dependente desse Save para leitura, movimentação ou permanência. |
| R27 | Localizar a sessão a restaurar pela data, horário de Brasília e contexto/ordem de abertura informados pelo usuário; perguntar se houver ambiguidade. Usar os originais dessa sessão, inclusive de perfis já fechados, e considerar o conjunto de transferências e alterações posteriores para evitar restauração unilateral. Nunca restaurar automaticamente por seleção, fechamento ou reabertura. |
| R28 | Preservar os limites existentes de containers, unicidade da fonte aberta, capacidades de jogo, party, slots e itens. Independência não autoriza conversões ou compatibilidades novas. |

### Migração: remover a dependência sem perder o conteúdo

M01. Inventariar todos os endereços dependentes do owner: catálogo, grades,
records, histórico, ledgers, sessões, leases, operações pendentes, índices e
metadados de recuperação. Um arquivo físico e todas as suas cópias lógicas
devem ser correlacionados antes de definir a transição.

M02. Preservar IDs de Hub e Pokémon, representações nativas, posições, passaportes,
histórico, itens e revisões relevantes. Remover a relação de propriedade não é
criar novos Pokémon a partir de cópias dos mesmos bytes.

M03. Definir tratamento explícito de operações pendentes e dados divergentes.
Não escolher arbitrariamente por timestamp, maior revisão de namespaces
diferentes, ordem de leitura ou nome de perfil. Não deduplicar produção como
efeito colateral da migração.

M04. A transição precisa ser recuperável e repetível sem duplicação ou perda.
Escolher e ensaiar o corte e a recuperação antes de qualquer deploy. Nenhuma
alteração de produção está autorizada por este documento.

M05. A leitura de `ownerProfileId`, se necessária para localizar dados antigos,
fica delimitada ao mecanismo de migração/diagnóstico histórico. O funcionamento
normal final não depende do campo, de um fallback permanente ou de um alias que
recrie a mesma propriedade. O armazenamento físico final ainda será especificado.

## 8. Fronteiras e levantamento restante

| Área | Responsabilidade exigida / levantamento |
|---|---|
| React e `pokemon-hub-ui.jsx` | Apresentação, seleção local e aplicação de respostas atuais. Levantar referências compartilhadas que possam substituir estado de outros containers. |
| `hub-client.js` e backend HTTP | Distinguir identidade de Save, Hub e sessão. Levantar parâmetros/rotas que usam `profileId` como owner implícito, inclusive `workspaceProfileId`. |
| Stores, coordenador e sessão em `apps/packages` | Definir identidade estável de fonte, autoridade única, concorrência, recuperação e lifecycle sem propriedade entre perfis. |
| Serviços de transferência de Pokémon e itens | Validar explicitamente as duas fontes; conservar conteúdo e limitar os efeitos à operação. Levantar serviços antigos ainda chamáveis. |
| Flush, materialização e recuperação | Impedir publicação obsoleta e reintrodução de estados anteriores. Preservar os controles exigidos pelo fluxo de jogo/save. |
| Persistência e migração | Mapear endereços existentes e desenhar a remoção completa do vínculo sem adotar previamente uma topologia nova. |
| Testes | Substituir expectativas que legitimam o acoplamento e incluir conservação, estado pendente e isolamento efetivo. |

O contrato funcional da seção 2 já está determinado, inclusive backup original
único na primeira abertura de cada perfil em cada sessão. Não é uma opção criar
uma sessão por container como substituto do owner. Permanecem em aberto o formato
físico de armazenamento, o protocolo de confirmação/recuperação, a implementação
do backup e a transição dos dados existentes. As seções seguintes registram as
dependências e os bloqueadores encontrados, sem escolher antecipadamente um
namespace global ou um novo store.

## 9. Critérios de aceitação a transformar em testes

1. Reproduzir o relato: um Hub e dois Saves, retirar dois Pokémon de um Save,
   trocar o Hub e retornar. Origem continua sem ambos, Hub anterior contém ambos
   exatamente uma vez e o segundo Save permanece igual.
2. Executar a mesma sequência antes do envio pendente, durante resposta atrasada
   e depois de confirmado. Verificar UI, autoridade backend e persistência após
   materialização/reabertura, com identidades e conteúdo nativo além de contagens.
3. Observar toda a troca: splash exclusivamente local, mesma sessão dos demais
   containers, nenhuma recarga/flush/restauração dos Saves causada pela seleção.
4. Carregar e usar simultaneamente Hubs que possuíam owners históricos diferentes,
   inclusive sem qualquer Save aberto. Não deve existir conflito de owner.
5. Exercitar as combinações de R04, permutar a ordem de abertura e fazer Save→Hub,
   Hub→Save, Hub→Hub e Save→Save dentro das compatibilidades existentes.
6. Repetir com itens empilháveis, quantidades parciais e ledgers legados. Conservar
   quantidades após troca, retorno, fechamento e reabertura.
7. Duas sessões tentam editar a mesma fonte; respostas chegam fora de ordem;
   transferência é reenviada após perda de resposta. Nenhum segundo escritor ou
   retry pode duplicar, perder ou restaurar conteúdo antigo.
8. Interromper a operação nos limites de confirmação e de publicação do Save.
   Recuperação produz um único resultado consistente, sem duas metades aceitas.
9. Migrar fixtures com múltiplos namespaces, IDs existentes, itens, estado dirty
   e conflito explícito. Preservar dados válidos e não escolher silenciosamente
   entre autoridades conflitantes.
10. Inspecionar schema, API e consumidores após a remoção: ausência do vínculo
    funcional e de substituto equivalente, com exceção histórica delimitada em M05.

Execuções em memória, com Saves sintéticos ou em um processo devem ser identificadas
como tais. Elas não comprovam por si sós comportamento sob Redis real, múltiplos
processos ou os dados restaurados da VPS. O levantamento e os testes futuros
devem registrar essas diferenças, sem declarar o incidente resolvido antes da prova.

## 10. Precedência e continuidade

A instrução explícita atual define a remoção do vínculo e a independência das
caixas. As restrições de owner nas specs 026, 078, 082 e o contorno de troca global
da spec 084 são antecedentes a substituir, não requisitos a preservar. A carga
local da spec 080 permanece coerente com a intenção atual. Regras de integridade
e de compatibilidade que não exigem propriedade entre perfis permanecem válidas.

O levantamento detalhado abaixo complementa estes requisitos. O próximo avanço
é resolver seus bloqueadores e consolidar o desenho nesta mesma spec.
Implementação, migração, build, commit e deploy não fazem parte desta etapa.

## 11. Vocabulário e limites de identidade

As referências de código das próximas seções correspondem ao baseline `ec84597`.
Os nomes de função são os pontos de navegação; os arquivos locais parcialmente
alterados podem apresentar diferenças. "Confirmado no código" significa fluxo
ou dependência observados estaticamente; não significa reprodução do incidente.

| Identificador | Uso observado hoje | Contrato exigido |
|---|---|---|
| `hubProfileId` | Identidade do catálogo Hub; conteúdo é procurado também sob seu owner. | Identidade suficiente para localizar o recurso Hub, seus Pokémon e itens. |
| `saveProfileId` + `gameId` | Identificam o `.sav`; o código frequentemente chama o primeiro apenas de `profileId`. | Identidade legítima do Save. Não pode ser removida ao eliminar ownership. |
| `profileId` da sessão/coordenador | Particiona sessão, source, record, eventos, leases e operações; pode diferir do perfil do Save manipulado. | Eliminar este papel de namespace proprietário. Separar os usos que identificam efetivamente um Save. |
| `ownerProfileId` | Ponte permanente do catálogo Hub para a partição anterior. | Ausente do modelo ativo; permitido somente no leitor histórico delimitado de migração. |
| `sourceKey` | `hub:<hubProfileId>` ou `save:<saveProfileId>:<gameId>`, ainda aninhado sob `profileId`. | Referência estável à fonte independente; o mesmo recurso não pode gerar autoridades distintas por sessão. |
| `sessionId` / `workspaceId` | UUID da sessão, repassado como workspace, mas resolvido junto com `profileId`. | Identidade do ambiente de trocas. Suas fontes são referências a recursos, não cópias proprietárias deles. |
| Associação de backup sessão/perfil | O baseline inspecionado não implementa o contrato de primeira abertura definido na seção 2. | Identifica um único original por perfil naquela sessão; permanece mesmo após sair do snapshot ativo. Não define o endereço do conteúdo atual do perfil. |
| `sourceSessionId` / `leaseToken` | Identificam a concessão temporária de escrita da fonte. | Continuam sendo controle transitório de concorrência, sem vínculo permanente entre perfis. |
| `pokemonInstanceId` | Identifica o registro e sua localização lógica. | Preservado ao mover, reabrir e migrar. Uma mudança de container não emite outra identidade. |
| `operationId` / chave de idempotência | Identificam algumas operações; hoje estão também particionados por perfil. | Identificam uma intenção e seu resultado recuperável, vinculados à sessão e aos participantes explícitos. |
| Revisões | Sessão, source/snapshot, record, Save físico e ledger possuem contadores distintos. | Cada revisão protege sua própria autoridade; números de namespaces diferentes não elegem um vencedor. |
| `ownerKind` do lease de Save | Distingue temporariamente player e Hub na exclusão de escritores. | Não confundir com ownership de perfil. Preservar a função de exclusão mútua. |

Simetria de Hub e Save é simetria de participação: ambos podem originar e receber
conteúdo. Não exige formatos físicos idênticos. Um Save precisa de um adaptador
capaz de inspecionar e gravar o formato daquele jogo; Hub guarda representações
nativas e metadados. Regras de compatibilidade pertencem às capacidades desses
adaptadores, nunca à igualdade entre seus perfis.

Exemplo conceitual de uma intenção, sem definir ainda o schema HTTP final:

```text
transferência
  sessionId, operationId
  origem: referência da fonte + localização + revisão esperada
  destino: referência da fonte + localização + revisão esperada
  conteúdo: identidade do Pokémon OU identidade semântica do item + quantidade
```

Uma operação interna à mesma caixa tem um participante; entre caixas tem dois.
Uma terceira caixa só participa se houver uma alteração explícita nela. Uma
resposta canônica pode descrever todo o workspace, mas isso não autoriza gravar,
readotar, materializar ou restaurar todos os seus recursos.

## 12. Fluxo atual, do container à persistência

### 12.1 Abertura e seleção de fontes

`PokemonHub`, em [pokemon-hub-ui.jsx](../apps/packages/pokemon-hub-ui.jsx), mantém
panes, layouts de Saves, perfis Hub, snapshot canônico, requisições pendentes e
estado otimista em memória. O workspace admite de um a três containers e evita
abrir a mesma fonte simultaneamente em dois deles. `ensurePokemonHubSession`
abre a sessão sob um `profileId`; a UI guarda esse ID ao lado de `sessionId`.
O heartbeat é periódico, de três segundos na UI.

`selectPokemonHubPane` reserva a seleção e enfileira mudanças estruturais.
`submitStructuralPokemonHubPaneChange` aguarda a fila de itens e usa o owner do
Hub recebido para decidir qual perfil deve identificar a sessão. Ao encontrar
outro perfil, entra em `switchPokemonHubSession`, ativa `busy` global, encerra a
sessão anterior com seu snapshot final, abre outra e relê as fontes do workspace.
A reserva/carregamento local já existe; daí os dois escopos de splash observados.

No caminho normal de `loadCanonicalPane`, o serviço de sessão adquire a fonte
que entra, pode publicar a fonte que sai, atualiza o snapshot e libera a fonte
anterior. O contrato desejado deve preservar os outros panes e seus estados
pendentes. É legítimo concluir uma operação já iniciada que envolva a fonte de
saída; isso não autoriza gravar um terceiro Save por causa da seleção.

`getSaveLayout` não é uma leitura sem efeitos: pode adotar ou readotar o Save e
gravar sources/records. Usa `workspaceProfileId` para escolher a partição lógica,
mas lê os bytes usando o perfil real do Save. Se o snapshot estiver dirty, não o
readota; a montagem do layout combina a inspeção do arquivo com identidades do
snapshot. O contrato de leitura precisa impedir a mistura de duas revisões.

### 12.2 Movimento de Pokémon e confirmação

`persistPokemonHubSessionMove` valida o movimento e usa `applyLocalSessionMove`
para projetá-lo imediatamente. O mecanismo em
[pokemon-hub-snapshot-flight.mjs](../apps/packages/pokemon-hub-snapshot-flight.mjs)
envia snapshots, mantém uma requisição em voo, reúne modificações posteriores e
usa chave de idempotência. Vários gestos podem acabar num mesmo envio. A imagem
otimista não constitui evidência de persistência nem de backup.

`runCanonicalSnapshot`, em
[pokemon-hub-session-service.mjs](../apps/packages/pokemon-hub-session-service.mjs),
valida schema/revisão, trata reenvio, protege a transição da sessão, adquire fontes
necessárias e chama o coordenador com as localizações desejadas. O conjunto de
Pokémon da sessão é conferido para impedir inserção/remoção indevida. Fechamento
e saída de fontes têm etapas de flush/liberação.

O coordenador valida leases, revisões-base, fontes ativas, unicidade de IDs no
pedido e regras de localização. A sincronização exige o conjunto de fontes do
workspace; esta exigência não significa que todas devam sofrer mutação.
Hoje ele escreve os sources alterados, depois records, depois eventos e o
resultado idempotente, em chamadas sucessivas. Não há uma transação única
abrangendo todos esses writes. A proteção Lua da sessão não inclui esses dados.

A resposta de sincronização pode aceitar o estado lógico com Saves dirty antes
da publicação nos arquivos. Portanto, há três estados diferentes a considerar:
preview local, estado lógico aceito e Save físico materializado. A remoção de
ownership precisa definir como eles convergem sem tornar uma metade visível
enquanto a outra volta ao estado anterior.

### 12.3 Adoção, registro e materialização

`adopt` em
[pokemon-hub-snapshot-coordinator.mjs](../apps/packages/pokemon-hub-snapshot-coordinator.mjs)
reaproveita identidades encontradas no source anterior da mesma partição a partir
da representação nativa; caso contrário cria UUIDs. Adotar o mesmo Save em outra
partição pode, portanto, gerar outros records. Igualdade de bytes não é prova
suficiente de identidade única para uma migração: dois Pokémon distintos podem
exigir preservação mesmo quando suas representações coincidem.

O record guarda identidade, localização, revisão, dados de apresentação,
representações nativas, procedência e, quando presente, passaporte. O source
guarda placements, revisão lógica, revisão-base do Save, dirty e capacidades.
No modelo atual os dois documentos também carregam `profileId` proprietário.

[pokemon-hub-save-flush.mjs](../apps/packages/pokemon-hub-save-flush.mjs) obtém o
plano lógico, materializa as posições sobre bytes do Save, grava o arquivo e só
depois marca o source como publicado. No baseline, a revisão esperada do write
vem do arquivo recém-lido, sem exigir que corresponda à revisão-base do source.
Uma autoridade lógica antiga pode assim ser materializada sobre bytes mais
novos. Se o arquivo for gravado e a marcação seguinte falhar, também é necessário
um protocolo de recuperação que reconheça a publicação já feita.

O materializador deve continuar preservando os bytes alheios à operação e as
regras do adaptador. Remover ownership não autoriza retirar validações de party,
layout, checksum ou compatibilidade nativa.

### 12.4 Transferência e reordenação de itens

O backend seleciona
[pokemon-hub-item-transfer-service.mjs](../apps/packages/pokemon-hub-item-transfer-service.mjs)
quando uma ponta é Hub e
[pokemon-item-reorder-service.mjs](../apps/packages/pokemon-item-reorder-service.mjs)
para os caminhos entre Saves/reordenação de Save. As pontas já são explícitas,
mas o serviço Hub exige owner igual ao perfil da sessão e endereça seu ledger
sob esse perfil. O ledger usa o pseudo game ID `.hub-items-<hubProfileId>`.

Os serviços verificam revisões/capacidades, simulam o resultado, podem publicar
Pokémon pendentes nos Saves envolvidos e reler suas revisões. Para um Hub novo,
pode haver criação do ledger vazio antes da gravação final. Transferências usam
`saveStore.putPair`; reordenações usam uma gravação individual. Depois atualizam
metadados lógicos e invalidam snapshots de recuperação incompatíveis.

`putPair`, em [save-store.mjs](../apps/packages/save-store.mjs), ordena locks,
confere revisões/fences e grava um journal durável com os **estados resultantes**
antes de publicar os dois arquivos. A recuperação completa esses resultados.
O journal contém hashes/revisões anteriores, mas não as duas cópias completas
anteriores; é removido após sucesso. É recuperação de conclusão, não backup
restaurável anterior. Os endpoints de itens também não apresentam o mesmo
contrato de chave de idempotência dos snapshots canônicos.

### 12.5 Fechamento, expiração, player e rotas antigas

Fechar o Hub aguarda filas e envia snapshot final. A UI pode fechar localmente
antes de terminar a conclusão remota. O backend possui observador periódico de
sessões e leases expirados, com tentativas de flush e liberação. A perda da aba
ou de conexão transfere a responsabilidade de conclusão a esses caminhos.
Eles precisam compartilhar as garantias de backup, revisão e recuperação.

O player grava no Save real sob seu lease. Depois do write, `adoptSaveIfSupported`
atualiza a representação Hub usando o perfil real. Hoje isso pode coexistir com
outras representações do mesmo Save sob perfis de workspace diferentes. A
adoção pós-player não pode criar outra autoridade nem recuperar um snapshot
obsoleto. Os tipos de snapshot de execução `cloud-recovery` e `user-state` são
outra camada; sua vinculação à revisão/hash/fence do Save continua necessária.

O backend ainda despacha rotas antigas de inventário, `transfers` e snapshots
`acquire/renew/sync/release`. A transferência pode selecionar
`pokemon-hub-grid-transfer-service.mjs` ou `pokemon-hub-service.mjs` conforme o
payload. O primeiro exige uma combinação Save/Hub e chama `bindOwner`; o segundo
é o motor legado particionado por perfil, com gravações e compensações próprias.
A existência desses dispatches é confirmada; não foi demonstrado que todos os
formatos legados ainda funcionam integralmente na configuração de produção.
Cada consumidor deve ser identificado e o caminho retirado ou adaptado antes do
corte, impedindo que contorne o novo contrato.

## 13. Mapa de remoção e impacto por ponto do sistema

Este é um mapa de trabalho futuro, não autorização para editar código nesta etapa.
`P` significa preservação obrigatória de comportamento legítimo; `R` significa
remoção/substituição do acoplamento ou do contrato que depende dele.

| Ponto no repositório | Dependência atual / efeito | Exigência da mudança |
|---|---|---|
| `apps/packages/pokemon-hub-profile-store.mjs`: create, normalizeProfile, bindOwner | Schema 6 aceita/preserva owner; bindOwner grava vínculo e conflito; catálogo guarda grid histórico. | R: eliminar vínculo/validador/conflito do modelo ativo; migrar schemas. P: identidade, nome, criação e conteúdo existente. |
| `apps/backend/server.mjs`: list/readProjectedPokemonHubProfile | Lista expõe owner; detalhe usa owner para snapshot, cards e itens; sem owner pode retornar catálogo vazio. | R: buscar conteúdo pela identidade Hub e revisão coerente. Não apagar owner antes de tornar dados endereçáveis. |
| `apps/backend/server.mjs`: acquirePokemonHubSnapshot | Adoção de Hub chama bindOwner; Save adota no perfil da rota. | R: adquirir/adotar a mesma fonte estável em qualquer sessão. P: validação do Save e exclusão com player. |
| `apps/backend/server.mjs`: getSaveLayout / rota de layout | `workspaceProfileId` escolhe outra partição; GET pode escrever adoção/capacidade. | R: eliminar parâmetro proprietário; distinguir leitura de inicialização e proteger toda mutação decorrente. |
| `apps/packages/hub-client.js` | Operações de sessão exigem profileId no path; layout envia workspaceProfileId. | R: contratos de sessão identificados por sessionId; pontas de Save preservam identidade real. |
| `apps/packages/pokemon-hub-ui.jsx`: ensure/persist/submitStructural/switch | Sessão depende da primeira fonte e do owner; troca global, restrição entre Hubs, fallback de profileId. | R: retirar derivação/troca por perfil e restrição entre owners. P: sessão do ambiente, filas e processamento local. |
| `apps/packages/pokemon-hub-workspace.mjs` | Bindings de panes, limite e deduplicação de fontes. | P: até três fontes distintas; R: garantir que a troca modifique somente o binding escolhido. |
| `apps/packages/pokemon-hub-session-view.mjs` e `pokemon-hub-snapshot-flight.mjs` | Projeção, captura integral do workspace, coalescência e correção. | R: manter snapshots ativos coerentes e impedir respostas antigas; separar confirmação dos movimentos do backup original por perfil/sessão. |
| `apps/packages/pokemon-hub-canonical-session-snapshot.mjs` | Contrato de panes, sources e placements canônicos. | R: conferir referências sem owner; P: identidade/membership, revisão e validações estruturais. |
| `apps/packages/pokemon-hub-session-service.mjs` | open/requireLive/heartbeat/pane-load/sync/close usam profileId+sessionId; índices e resultados também. | R: ciclo inteiro por sessão e fontes explícitas. Preservar semântica de expiração, replay e fechamento recuperável. |
| Mesmo serviço: método compacto applySnapshot | Caminho antigo contém filtro dirty `save:${profileId}:`. | R: retirar pressuposto de que os Saves da sessão pertencem ao seu perfil. Determinar consumidores antes de manter/remover. |
| `apps/packages/pokemon-hub-snapshot-coordinator.mjs`: ensureHubSource/adopt/read/write/sync | Chaves e documentos por perfil; IDs reutilizados dentro da partição; writes de várias entidades separados. | R: fonte/record estáveis e confirmação recuperável entre pontas; backup cobre inicialização que altera conteúdo. |
| `apps/packages/pokemon-hub-redis-keys.mjs` | Hash tag `{ph:<profileId>}` organiza todas as chaves v2. | R: redesenhar endereço e colocação das chaves usadas por Lua; migrar índices e operações, além dos objetos principais. |
| `apps/packages/pokemon-hub-event-store.mjs` | Endereço e identidade de evento incluem profileId. | R: preservar histórico consultável e idempotência sem propriedade. P: eventos não devem passar a armazenar bytes nativos indevidamente. |
| `apps/packages/pokemon-hub-grid-transfer-service.mjs` | Valida uma ponta Save, outra Hub, mesma partição; requer bindOwner. | R: retirar ou convergir no contrato com duas pontas independentes; sem rota de escape. |
| `apps/packages/pokemon-hub-service.mjs`, `pokemon-hub-store.mjs`, `pokemon-hub-session-store.mjs`, `pokemon-hub-snapshot-store.mjs` | Motor/store e controles anteriores convivem com sessão/coordenador atuais. | R: mapear chamadas efetivas e desativar ou migrar consumidores antigos. Não confundir stores em memória com a sessão durável atual. |
| `apps/packages/pokemon-hub-item-transfer-service.mjs` | Owner valida acesso e localiza ledger para transferir/reordenar. | R: resolver Hub pelo próprio ID, integrar backup e idempotência; P: quantidades, limites e semântica de itens. |
| `apps/packages/pokemon-hub-item-ledger.mjs` | Formato de inventário e pseudo game ID interno. | R: decidir endereço físico sem Save proprietário; P: identidade semântica, stacks, bytes e revisões migradas. |
| `apps/packages/pokemon-item-reorder-service.mjs` | Saves explícitos, mas sessão ainda sob perfil; flush prévio e writes individuais/pareados. | R: mesmo contrato de sessão e backup; cobrir efeitos anteriores ao putPair. |
| `apps/packages/pokemon-hub-save-adoption.mjs` / server adoptSaveIfSupported | Perfil do Save e perfil da partição podem divergir. | R: adoção única para cada Save real, inclusive após escrita pelo player. |
| `apps/packages/pokemon-hub-save-flush.mjs` e materializador | Snapshot pode partir de revisão antiga; publicação/mark são separados. | R: impedir publicação obsoleta e recuperar publicação parcial; P: bytes não envolvidos e validação do formato. |
| `apps/packages/save-store.mjs` | Save real, ledgers internos, locks, revisão, fence, journal putPair e remoção do ledger. | R: integrar garantias de backup/recuperação sem perder locks e checks existentes. Não renomear perfil real do Save. |
| `apps/packages/game-save-lease-coordinator.mjs` e player lease | Exclusão global do recurso físico, expiração e geração. | P: proteção de escritor; R: coordenar expiração/dirty/recuperação com a nova autoridade única. |
| `apps/packages/snapshot-store.mjs` e invalidação no backend | Snapshots de execução vinculados ao Save físico. | P: não permitir ressurreição de runtime antigo depois de transferência; R: alinhar publicação e invalidação recuperável. |
| `apps/backend/server.mjs`: DELETE de perfil Hub | Consulta itens sob owner; exclusão do catálogo e ledger em etapas; ocupação do catálogo pode não representar source. | R: verificar conteúdo autoritativo, lease, backup e descarte; excluir sem órfãos nem reaparecimento. |
| `apps/packages/backend-state-backup.mjs` / startup / rota ops | Backup global separado dos comandos; Redis e arquivos lidos em sequência. | R: garantir original consistente na primeira abertura de cada perfil/sessão, sem sobrescrita posterior; diferenciar exportação global desse conjunto progressivo de originais. |
| `apps/packages/redis-legacy-migration.mjs` | Importa documentos/endereços antigos; execução no startup. | R: impedir reintrodução do owner e cópias após corte/restore; versionar migração e marcar conclusão verificável. |
| `apps/backend/server.mjs`: observer de expiração | Pode gravar por recuperação, sem gesto atual de UI. | R: mesma autoridade, backup prévio aplicável e fencing; não reviver lease/source antigo. |
| `apps/electron/main.cjs` e frontend distribuído | Electron consome frontend pré-compilado; clientes antigos podem manter contrato anterior. | R: planejar compatibilidade/corte de versões e rejeição sem efeitos de escritores incompatíveis. Sem novo motor Electron. |
| `apps/tests/pokemon-hub/`, testes dos packages e specs anteriores | Fixtures/helpers e expectativas codificam owner, workspaceProfileId e rejeição entre Hubs. | R: fixtures independentes, novos contratos e testes de conservação; não apenas atualizar strings esperadas. |

Além do grep por `ownerProfileId`, a revisão futura precisa seguir todos os usos
de `profileId`, `workspaceProfileId`, `bindOwner`, filtros `save:<profileId>`,
chaves, callbacks de flush e rotas alternativas. A ausência do nome do campo não
prova a ausência do vínculo. Referências históricas nesta spec não são defeitos.

## 14. Backup obrigatório: conteúdo, momento e recuperação

### 14.1 O que existe hoje e por que não satisfaz a intenção

`backend-state-backup.mjs` exporta Redis e Saves, incluindo ledgers internos com
`includeInternal: true`, para um arquivo comprimido publicado por rename.
A fila própria serializa backups, mas não bloqueia os escritores de perfis.
Ele lê Redis e depois arquivos: uma transferência concorrente pode ficar entre
essas leituras. Um arquivo gravado integralmente pode representar um corte
inconsistente do sistema. O módulo não fornece, por si, um protocolo de restore
transacional entre perfis.

O backup de startup é opcional e ocorre depois da migração legada e da criação
do servidor, que inicia o observador. Portanto, nem mesmo o nome "startup" prova
que a cópia antecedeu todos os escritores. Também há backup administrativo;
nenhum desses pontos implementa a captura obrigatória na primeira abertura de
cada perfil em cada sessão do Hub.

O journal de itens é de conclusão com estados posteriores. Eventos de Pokémon
não contêm todas as representações nativas. A cópia anterior existente no fluxo
especial de `eventGrantReceipt` do Save não é um backup geral das operações Hub.
São mecanismos com objetivos diferentes; nenhum cobre sozinho R18–R20.

### 14.2 Unidade e conteúdo do original

A unidade funcional está fechada na seção 2: um original íntegro por perfil,
capturado na primeira abertura em cada sessão. O conjunto cresce conforme novos
perfis entram. Não existe uma nova cópia por transferência ou por salvamento.
O original contém o estado completo do perfil aberto, não apenas os slots/itens
que o usuário vier a mover. Copiar um `.sav` obsoleto sem considerar uma autoridade
lógica pendente não garante uma cópia da versão efetivamente aberta.

| Participante / controle | Conteúdo original que precisa ser recuperável |
|---|---|
| Perfil Save aberto | Bytes nativos completos, identidade perfil/jogo, revisão, hash e metadados pertinentes; estado lógico necessário para reconstruir com integridade a versão realmente aberta. |
| Perfil Hub aberto | Identidade e metadados, conteúdo autoritativo inteiro, placements, records, representações nativas, procedência/passaportes, inventário de itens e revisões. |
| Associação à sessão | Identidade da sessão e do perfil, início da sessão, momento da primeira captura, versão e integridade da cópia. Metadados devem permitir localizar os originais mesmo após a saída dos blocos ativos. |
| Histórico pertinente | Dados necessários à preservação da procedência e à recuperação coerente. Um evento sem bytes não substitui o original; eventos de movimentação posteriores não substituem o backup. |
| Recursos internos ainda inexistentes | A ausência de um ledger na primeira abertura faz parte do estado original. Criá-lo durante o uso não autoriza reescrever esse original. |
| Estados de execução do Save | Definir em conjunto a preservação ou invalidação dos vínculos e blobs capazes de carregar estado incompatível. O exportador atual não deve ser presumido backup completo desses blobs. |

O armazenamento físico desse conteúdo e o mapeamento entre o perfil aberto e
os documentos/arquivos legados são pendências de implementação em B06. Isso não
reabre a decisão de quando fazer backup ou de quantas versões guardar por
perfil/sessão. Não ampliar silenciosamente o backup para todos os jogos de um
perfil genérico, nem reduzir o perfil aberto a slots isolados: qualquer dúvida
de correspondência com o modelo legado deve ser discutida com o usuário.

### 14.3 Primeira abertura, reutilização e recuperação

A abertura consulta a associação entre sessão e perfil. Se já houver original
completo, a abertura utiliza o estado atual e deixa essa cópia intacta. Se não
houver, a captura deve ser concluída e verificada antes da liberação de edição.
Essa garantia precisa resistir a repetição, concorrência e falha parcial de
captura; um registro incompleto não vale como backup pronto. O mecanismo para
isso ainda será decidido em conjunto.

Depois de protegido, o perfil pode ser manipulado, salvo, fechado e reaberto
várias vezes na mesma sessão. Nenhum desses eventos redefine seu original.
Inicializações que alterem conteúdo durante a primeira carga precisam respeitar
a proteção anterior. Os escritores posteriores devem preservar o vínculo e a
cópia existente, sem exigir outra captura a cada flush ou reorder.

As capturas de perfis diferentes podem ocorrer em horários diferentes. Cada
original deve ser internamente consistente e anterior à manipulação daquele
perfil pela sessão. Não se exige um scan simultâneo de todos os perfis no início
nem a recriação do conjunto quando um novo perfil entra. A confirmação de
transferências continua exigindo integridade entre as pontas; esse requisito
não transforma o backup em um journal por operação.

O procedimento de recuperação parte da identificação da sessão, conforme a
seção 2.6, e de seus originais preservados, incluindo perfis já fechados. Deve
considerar o trabalho entre os participantes e as alterações posteriores para
não restaurar a origem mantendo o destino de uma transferência. Não há restore
automático na seleção de perfis. Retenção/espaço, concorrência externa e execução
da recuperação são pendências técnicas a resolver com o usuário.

## 15. Persistência e migração: inventário necessário para o corte

| Família persistida | Localização/dependência atual | Condição de preservação |
|---|---|---|
| Catálogo Hub | `pokemon-hub:profiles`, schema até 6 normalizado com owner. | Todos os IDs/metadados preservados; conteúdo deixa de depender do campo antes da retirada. |
| Sources e records | Chaves `pokemon-hub:v2` com hash tag de perfil; documentos também carregam profileId. | Uma autoridade por recurso, todos os registros/representações correlacionados; não copiar e deixar dois escritores. |
| Eventos | Namespace e event ID derivados também de profileId. | História continua consultável sem duplicar eventos ou reatribuir procedência. |
| Sessões, leases e resultados | Perfil+session/workspace, operações, terminais e índices globais de expiração. | Nenhum processo antigo retoma um endereço anterior depois do corte; operações confirmadas não perdem idempotência. |
| Saves | Arquivos por perfil real/gameId e metadados. | Identidade legítima mantida; reconciliar revisão física com autoridade lógica sem sobrescrever arbitrariamente. |
| Ledgers Hub | Save store no perfil owner, pseudo game `.hub-items-<id>`. | Quantidades/identidades/revisões preservadas; destino independente de qualquer Save. |
| Journals e metadados de recuperação | Journals de itens, fences, invalidação de runtime e recibos especializados. | Pendências concluídas ou traduzidas de modo verificável antes de retirar leitores antigos. |
| Dados anteriores ao coordenador | Inventários/docs do motor antigo, grids históricos e importação JSON legada. | Descobrir conteúdo efetivo; distinguir legado real de projeção vazia e não abandoná-lo. |
| Backups existentes | Exportações com chaves antigas e bytes de Save/ledger. | Documentar versão e restore compatível; restauração não pode reativar silenciosamente ownership. |

As funções de chaves incluem nomes como outbox e marcador de migração, mas sua
declaração e testes de hash slot não demonstram escritores/consumidores ativos.
Não foi identificado nesses caminhos um outbox operacional que torne atômicas
as gravações de sources, records e eventos. Não fundamentar a migração nessa
garantia inexistente no fluxo inspecionado.

O levantamento de dados de produção ainda não foi executado nesta etapa. Antes
de escolher uma migração, será necessário produzir relatório somente de leitura
que correlacione cada Save real e Hub com todas as suas partições, revisões,
identidades, ledgers e operações pendentes. Divergências são entradas para uma
decisão explícita, não para escolher automaticamente a maior revisão. A mesma
espécie, quantidade ou hash nativo isolado não é critério de deduplicação.

O corte deverá ter backup consistente anterior, versão verificável, exclusão de
escritores antigos, transformação repetível, validação de conservação e plano
de recuperação. Nenhum desses passos autoriza deploy ou manipulação dos dados
reais nesta fase. A restauração do incidente em outro chat permanece separada.

## 16. Bloqueadores e decisões que precisam ser resolvidos

As pendências técnicas abaixo continuam abertas. As decisões funcionais da
seção 2 já foram estabelecidas e não devem ser tratadas como alternativas a
escolher novamente. Os bloqueadores impedem a implementação ou o corte seguro
conforme indicado; não bloqueiam este levantamento. "Risco"
designa uma consequência possível do código, sem alegar reprodução em produção.

### B01 — Retirar o campo antes de resolver os endereços esconde conteúdo

**Evidência:** projeção de Hub, detalhes e ledger usam owner; fontes e records
estão sob a partição correspondente. **Quebra possível:** Hub aparentemente
vazio, itens inacessíveis ou readopção com novos IDs. **Fechamento necessário:**
contrato de identidade/endereço e mapa de migração completos, com leitura de
todos os perfis após retirada sem fallback proprietário permanente. Bloqueia
remoção de schema e corte; não há justificativa funcional para manter ownership.

### B02 — Autoridades divergentes já podem existir

**Evidência:** a mesma source Save é endereçada sob workspaceProfileId distinto;
adoção reutiliza records apenas na partição lida. **Quebra possível:** escolher
uma cópia errada perde alterações ou ressuscita Pokémon. **Fechamento necessário:**
inventário real e regra explícita para conflitos, com preservação de IDs e
evidência de conservação. Não comparar revisões de partições como um relógio
global. Bloqueia migração automática de dados conflitantes.

### B03 — Sessão ainda precisa de perfil em todo o contrato

**Evidência:** cliente, rotas, serviço, terminais e índices usam profileId.
**Quebra possível:** trocar só a URL deixa heartbeat/close/expiry/idempotência
operando no endereço anterior, ou obriga um Save para abrir apenas Hubs.
**Fechamento necessário:** contrato inteiro identificado por sessionId, incluindo
jobs e reenvios; teste de três Hubs e de substituição local sem mudança da sessão.
O formato exato das rotas é decisão posterior; a independência já é requisito.
O registro criado por `open` não guarda um instante de início próprio para busca
histórica; `finalizeCanonicalSession` apaga a sessão ativa e mantém um terminal
temporário de idempotência. A identificação posterior por horário e ordem de
abertura precisa sobreviver ao encerramento/expiração, sem manter leases ativos.

### B04 — Confirmação de Pokémon não é uma transação das duas pontas

**Evidência:** sync escreve sources, records, eventos e replay em sequência;
rollback da transição de sessão não desfaz esses writes. **Quebra possível:**
crash ou erro confirma parcialmente a transferência ou deixa replay sem refletir
o resultado. **Fechamento necessário:** definir unidade de commit e recuperação
durável e provar conservação com falha em cada fronteira. Apenas retirar owner
não corrige esta classe de falha. Bloqueia a promessa de transferência indivisível.

### B05 — Falta captura única e íntegra na primeira abertura

**Evidência:** o backup geral existente não implementa a associação de original
por perfil/sessão nem protege a primeira carga contra mutação concorrente.
**Quebra possível:** perfil entra em edição sem original válido, captura parcial
é aceita como pronta ou reabertura sobrescreve o backup com o estado alterado.
**Fechamento necessário:** mecanismo de primeira captura íntegra, persistente e
não sobrescrita; falhas impedem edição desprotegida, retries não criam outra
versão e saída do bloco não remove o original. A regra funcional está definida.

### B06 — Mapear o perfil aberto aos dados necessários para recuperação

**Decisão funcional concluída:** um original por perfil na primeira abertura em
cada sessão, independentemente dos gestos, saves e reaberturas posteriores.
**Pendência técnica:** o modelo legado distribui dados por catálogo, source,
records, arquivos, ledgers e perfil genérico de jogo. **Quebra possível:** copiar
só uma projeção incompleta, misturar revisões ou incluir recursos alheios ao
perfil efetivamente aberto. **Fechamento necessário:** acordar o mapeamento e o
formato recuperável do original completo. A unidade de confirmação dos movimentos
é tratada em B04/B16 e não redefine a unidade do backup. Criação/exclusão e dados
auxiliares precisam respeitar o mesmo contrato sem escolhas técnicas unilaterais.

### B07 — Backup sem retenção e restore verificável não oferece recuperação

**Evidência:** exportação e journals existentes têm objetivos e ciclos distintos;
não há protocolo unificado de restauração das operações Hub. **Quebra possível:**
esgotamento de disco, backup irrecuperável ou restauração unilateral duplicando
conteúdo. **Fechamento necessário:** política de retenção/capacidade, integridade,
recuperação do conjunto e tratamento de operações posteriores, com ensaio de
falha e restore. Não adicionar restauração automática à seleção de perfis.

### B08 — Flush obsoleto e divergência entre estado lógico e arquivo

**Evidência:** baseline escreve sobre a revisão atual do arquivo sem confrontar
source.saveRevision; write e markSaveFlushed são separados. **Quebra possível:**
rollback de estado mais novo ou repetição de publicação já feita após erro.
**Fechamento necessário:** regra de autoridade/revisão e recuperação de publicação
parcial; teste com arquivo mais novo e com falha após write antes do mark.

### B09 — Concorrência é protegida em camadas de alcance diferente

**Evidência:** filas JS são locais ao processo; source acquire usa leitura seguida
de escrita; lease global do Save usa Lua; proteção de sessão cobre outra entidade.
**Quebra possível:** dois processos adquirem um Hub ou escritor expirado grava
depois do sucessor. **Fechamento necessário:** aquisição/fencing atômicos por
recurso e por operação, ordem de locks e testes com processos concorrentes,
inclusive Hub→Hub. A existência de um lease não prova proteção na hora do write.

### B10 — Redis Cluster e scripts dependem da partição antiga

**Evidência:** hash tag de perfil aproxima chaves e é protegida por testes de slot.
**Quebra possível:** novo endereço leva scripts a chaves incompatíveis ou mantém
um perfil oculto somente para obter o mesmo slot. **Fechamento necessário:**
definir topologia suportada e atomicidade das chaves usadas conjuntamente e
validar nessa topologia. Não presumir que namespace global é a única solução.

### B11 — Ledgers e alterações de itens têm efeitos anteriores ao putPair

**Evidência:** ledger sob owner, flush preparatório, criação de ledger vazio,
depois putPair e atualizações/invalidações; reordenação tem outro caminho.
**Quebra possível:** backup tardio, quantidade perdida na migração ou estado de
Pokémon divergente apesar de itens recuperados. **Fechamento necessário:**
endereço independente, cobertura de todos os efeitos e replay de itens com
resultado estável; testar Save↔Hub, Hub↔Hub e Save↔Save com falhas intermediárias.

### B12 — Exclusão e catálogo podem divergir do conteúdo autoritativo

**Evidência:** exclusão do catálogo verifica grid do perfil; conteúdo projetado
vem do source; remoção de ledger ocorre separadamente. **Quebra possível:**
descarte não reconhecido, source órfão ou perfil reaparecendo com dados antigos.
É um risco estático, não incidente reproduzido. **Fechamento necessário:**
inventário autoritativo no delete, proteção contra edição concorrente, backup e
definição do destino dos records/eventos. Preservar a confirmação de descarte
já exigida pelo produto, sem criar nova UI nesta etapa.

### B13 — Rotas e motores legados podem contornar a remoção

**Evidência:** dispatches antigos permanecem no servidor e o grid service exige
bindOwner; filtros de Save pelo profileId sobrevivem em métodos antigos.
**Quebra possível:** cliente antigo escreve no namespace anterior mesmo com UI
nova correta. **Fechamento necessário:** mapa de consumidores, retirada ou
adaptação integral, e rejeição sem efeitos de payloads incompatíveis. Não manter
compatibilidade que recria a relação proibida.

### B14 — Player, expiração e snapshots de execução continuam escritores

**Evidência:** player publica arquivo antes da adoção; jobs de expiração fazem
flush; snapshots de execução têm sua própria validade; lease vencido deixa de
ser ativo. **Quebra possível:** player assume Save ainda dirty, job antigo publica
depois, ou runtime anterior recupera conteúdo retirado. **Fechamento necessário:**
regra conjunta de transferência de escrita e recuperação, revisão/fence válidos
no commit e invalidação coerente. Preservar requisitos centrais de launch/save.

### B15 — Procedência e identidade podem ser perdidas como efeito da limpeza

**Evidência:** records/eventos têm namespace de perfil e passaportes carregam
história; adoção pode gerar UUID novo. **Quebra possível:** remover informação
histórica legítima junto do ownership ou criar segunda identidade do mesmo
registro. **Fechamento necessário:** schema separando procedência de dependência,
preservação dos IDs e consulta do histórico depois da migração. Não deduplicar
com base apenas em espécie, contagem ou hash de representação.

### B16 — Troca local pode receber respostas antigas e estado otimista pendente

**Evidência:** filas distintas, snapshot em voo, seleção de pane e respostas
canônicas que descrevem workspace inteiro. **Quebra possível:** resposta de uma
fonte que saiu sobrescreve a atual, ou fechamento descarta movimento apresentado
como concluído. **Fechamento necessário:** contrato de ordem/revisão por sessão,
operação e binding; testes com atrasos/reordenação e terceiro container intacto.
Eliminar splash global sem corrigir essas dependências seria mudança cosmética.

### B17 — Corte de versões e importação podem reintroduzir o modelo antigo

**Evidência:** frontend/Electron distribuídos separadamente, sessões antigas,
importador de legado e backups com endereços anteriores. **Quebra possível:**
reabertura do app, startup ou restore recriam owner e fontes duplicadas.
**Fechamento necessário:** versão de protocolo/dados, barreira a escritores
incompatíveis, tratamento de sessões pendentes e migração repetível com ensaio
de reinício/restauração. A estratégia de corte ainda não foi escolhida.

### B18 — Evidência de teste atual não cobre o contrato exigido

**Evidência:** E2E com fixtures novas, Redis em memória e execução serial; testes
de owner validavam a restrição; testes de backup usam estados estáticos. A
tentativa local interrompida modifica parte desses testes e serviços.
**Quebra possível:** suite verde preserva acoplamento, não exercita crash real ou
confunde código parcialmente alterado com baseline. **Fechamento necessário:**
separar baseline/implementação futura, rastrear critérios abaixo e executar nos
níveis adequados. Resolver deliberadamente as alterações locais antes de usá-las
como implementação. Este levantamento não as reverte nem as aprova.
O auditor E2E filtra requisições por sufixos de rota e verifica unicidade dentro
dos snapshots observados. Ao mudar o protocolo, conferir que ele continua
capturando requisições reais; zero capturas não pode passar por prova de
integridade. Backups originais e perfis já fechados precisam de verificações
próprias, além dos três panes presentes no payload.

## 17. Matriz de verificação futura

Os cenários abaixo são requisitos de prova, não resultados de testes executados
nesta etapa. Cada operação deve observar UI, autoridade lógica e persistência;
quando aplicável, repetir a leitura após reinício independente do processo.

| ID | Cenário / injeção | Resultado a comprovar | Rastreio |
|---|---|---|---|
| V01 | Relato original: Hub A + Saves B/C, mover dois de B para A, selecionar Hub D e voltar. | A contém as mesmas duas identidades uma vez; B não contém; C mantém conteúdo/revisões; nenhum rollback. | R05–R10; B02/B08/B16 |
| V02 | V01 com gesto pendente, envio em voo, resposta atrasada e commit já concluído. | Um resultado consistente em cada fase; mesma sessão; resposta velha não substitui novo binding. | R22/R23; B04/B16 |
| V03 | Capturar requisições e estados de loading durante troca de Hub. | Sem close/open global, sem recarga/publicação de Saves intactos, splash restrito ao container. | R05/R06/R16 |
| V04 | Três Hubs, inclusive owners históricos diferentes, sem Save; permutar abertura. | Funciona pela sessão; nenhuma exigência de perfil Save ou igualdade entre owners. | R02–R04/R16 |
| V05 | Todas as direções Hub↔Hub, Hub↔Save, Save↔Save; um terceiro perfil aberto. | Conservação de instância/quantidade, participante explícito e terceiro intacto. | R07–R09/R21 |
| V06 | Abrir um perfil pela primeira vez na sessão, antes de manipulação ou inicialização que altere conteúdo. | Original completo, íntegro e associado à sessão antes de liberar edição, tanto para Hub quanto Save. | R18/R19; B05/B06/B11 |
| V07 | Falhar captura, validação ou persistência do primeiro backup; disco indisponível/cheio. | Perfil não entra em uso editável sem proteção; captura incompleta não é tratada como original pronto. | R18; B05/B07 |
| V08 | Escritor concorrente durante a primeira captura; repetir requisição de abertura. | Original consistente com a versão carregada e único por perfil/sessão; sem sobrescrita nem mistura de revisões. | R19/R20/R23; B05/B09 |
| V09 | Repetir comando após timeout/perda de resposta, inclusive itens. | Mesmo resultado e backup original; movimento aplicado uma vez. | R08/R20; B04/B11 |
| V10 | Crash entre cada write de source, record, evento, replay e metadado de sessão. | Recuperação conserva ambas as pontas e resultado idempotente; não há duas metades aceitas. | R08/R22; B04 |
| V11 | Source dirty com base antiga e arquivo físico mais novo. | Write obsoleto impedido; dado recente preservado; conflito não tratado como sucesso. | R10/R23; B08 |
| V12 | Crash após publicação do `.sav`, antes de mark/invalidação; repetir flush. | Reconhecer efeito anterior sem sobrescrever dado posterior; runtime incompatível não revive. | R10/R25; B08/B14 |
| V13 | Dois processos/sessões tentam a mesma fonte; expirar lease no meio. | Um escritor autorizado por recurso; escritor antigo impedido no commit; sem deadlock. | R11/R23; B09 |
| V14 | Player tenta abrir/gravar enquanto Hub tem pendência; job expira simultaneamente. | Exclusão e passagem de escrita coerentes, sem restaurar estado anterior; launch/save íntegros. | R11/R25; B14 |
| V15 | Retirar/remover Hub ocupado ou sendo editado. | Conteúdo autoritativo conferido, backup anterior, descarte conforme contrato, sem órfãos. | R12/R18/R24; B12 |
| V16 | Invocar diretamente rotas antigas e payloads anteriores. | Novo contrato completo ou rejeição sem writes; nenhum fallback proprietário. | R13/R24; B13/B17 |
| V17 | Migrar dados com owner, múltiplas partições, ledger, passaporte/história e estado dirty. | IDs/conteúdo preservados; conflito reportado sem escolha arbitrária; repetição não duplica. | M01–M05/R26; B01/B02/B15 |
| V18 | Reabrir em outra sessão e outro container; reiniciar backend. | Mesma identidade e estado atual persistente, sem readopção duplicada; nova sessão captura seu próprio original sem alterar o da anterior. | R03/R10/R17/R20 |
| V19 | Restaurar os originais de uma sessão em ambiente isolado, incluindo perfis fechados e dependências posteriores conhecidas. | Recuperação coerente do conjunto; procedimento impede restore unilateral inadvertido. | R19/R27; B07 |
| V20 | Nova versão com cliente antigo, startup/importação e backup legado. | Não reintroduzir owner/escritor antigo; sessão incompatível não altera dados. | M04/M05/R24; B17 |
| V21 | Limites de party, destino ocupado, incompatibilidade de título/item e reorder inválido. | Regras existentes permanecem; nenhuma mutação/transferência parcial ao rejeitar. | R14/R21/R28 |
| V22 | Suite em Redis real e múltiplos processos; topologia suportada; falha real de processo. | Propriedades não dependem da fila JS, mock de materializador ou persistência em memória. | R15; B09/B10/B18 |
| V23 | Abrir o Pokémon Hub sem selecionar perfil; acrescentar/remover blocos. | SessionId criada automaticamente e informada ao backend antes de qualquer perfil; mudanças de blocos não trocam a sessão. | R04/R16 |
| V24 | Abrir, manipular, salvar, fechar e reabrir o mesmo perfil várias vezes na sessão. | Estado atual acompanha as alterações e a persistência ao fechar; backup permanece idêntico à primeira captura. | R05/R18–R20/R22 |
| V25 | Executar a sequência H1/A/B → H2/A/B → H2/C/B → H1/C/B da seção 2.4. | Cinco originais preservados, no máximo três perfis ativos, estados atualizados ao reabrir e nenhuma restauração implícita. | R04/R05/R19/R20 |
| V26 | Localizar sessão por data, horário de Brasília e primeira/segunda abertura; fornecer dados ambíguos. | Seleção da sessão indicada e de seus originais; ambiguidade exige esclarecimento antes de restore, sem escolha por suposição. | R27 |
| V27 | Iniciar sessão às 7h30 e abrir um perfil novo às 8h. | Backup capturado às 8h antes da manipulação, associado à sessão das 7h30; tempos distintos e sem falsa captura retroativa. | R16/R18/R19 |
| V28 | Encerrar ou expirar sessão, reiniciar serviço e consultar seus originais por data/ordem. | Metadados de identificação e backups continuam disponíveis; nenhum lease é reativado para manter histórico. | R16/R19/R27; B03/B07 |
| V29 | Repetir a requisição de início ou remontar o componente durante sua abertura. | Uma abertura lógica não vira duas sessões históricas por retry; nova abertura deliberada tem outra identidade. | R16/R20; B03/B16 |
| V30 | Executar auditoria E2E após mudar rotas/contratos; incluir um perfil já fechado e os backups originais. | Auditor observa as requisições esperadas e valida dados persistidos fora dos panes ativos; não passa silenciosamente com zero observações. | R09/R15/R19; B18 |
| V31 | Salvar repetidamente após a primeira abertura e verificar novamente o backup e a persistência corrente. | Original imutável, estado corrente durável segundo a fronteira acordada e sincronização contínua sem esperar só o close. | R18–R22; B04/B05/B08 |

Para Pokémon, comparar identidade de instância, representação nativa e posição,
não apenas contagem ou espécie. Para itens, comparar identidade semântica e soma
das quantidades. Para a terceira caixa, comparar conteúdo e revisões; heartbeat
de sessão não é mutação do perfil. Para arquivos, conferir bytes e metadados
pertinentes, preservando regiões alheias ao movimento.

Testes unitários validam regras e falhas locais; integração valida stores,
leases e fronteiras de persistência; E2E valida seleção, requisições e estado
visível. Nenhuma camada substitui as demais. A reprodução do caso exato de
produção permanece pendente e deve ser registrada separadamente das fixtures.

## 18. Resultado do levantamento e ordem das decisões

A investigação encontrou uma explicação técnica para a existência do campo:
ele liga o perfil Hub independente ao namespace herdado do motor por perfil.
Não encontrou uma necessidade de negócio que obrigue esse vínculo. Remover a
relação é coerente com o modelo de caixas, mas deve incluir os endereços, as
sessões, os ledgers, os escritores e a migração que dependem dela. Apagar apenas
a propriedade pode tornar conteúdo inacessível e não resolve gravações parciais.

A sequência abaixo organiza as dependências para discussão, sem aprovar uma
solução. Toda decisão de arquitetura ou infraestrutura será fechada junto com
o usuário antes da implementação correspondente:

1. Identidade estável das fontes e contrato de sessão sem perfil proprietário
   (B01–B03), preservando a simetria das pontas já determinada pelo usuário.
2. Implementação do backup original por perfil/sessão já definido, confirmação
   durável e recuperação (B04–B08), sem confundir journal posterior com backup.
3. Exclusão/fencing, armazenamento e integração de todos os escritores, inclusive
   itens, exclusão e player (B09–B15).
4. Ordenação da UI, migração/corte e prova em ambientes apropriados (B16–B18).

Há 28 requisitos funcionais/de integridade, cinco requisitos de migração,
18 bloqueadores técnicos e 31 cenários de verificação registrados. O design
funcional consolidado na seção 2 foi definido pelo usuário; a arquitetura física
e os mecanismos pendentes continuam sujeitos a decisão conjunta. A documentação
não representa um fix concluído. Implementação, dados de produção e execução de
restauração continuam fora do escopo autorizado.

## 19. Releitura do checkout e requisitos de simplificação

Esta complementação confronta o design consolidado com o código presente no
checkout em 30/09/2026. Não executa o rework. A análise anterior usou o baseline
`ec84597`; agora também foram lidas as diferenças locais da tentativa interrompida,
os consumidores e a infraestrutura E2E. Uma mudança local não significa que a
respectiva solução foi aceita ou validada.

### 19.1 O que a tentativa local já mudou e o que ainda falta

| Trecho local inspecionado | Situação observada | Consequência para o rework |
|---|---|---|
| `pokemon-hub-ui.jsx` | Remove `switchPokemonHubSession`, mas cria um `profileId` aleatório quando não há sessão; `ensurePokemonHubSession` continua recebendo profileId e a sessão ainda nasce sob demanda de carga. | Não satisfaz sessão automática ao abrir o Hub nem contrato exclusivamente por sessionId. Retirar a dependência de ponta a ponta, em vez de legitimar um perfil fictício. |
| `pokemon-hub-source-persistence.mjs` e composição no servidor | A tentativa acrescenta tradução de algumas chaves v2 para um namespace compartilhado v3 e importação durante leitura. Mantém documentos com profileId e consulta owner histórico; a composição habilita `sharedSources`. | É uma proposta física anterior, não aprovada. Não adotá-la como infraestrutura obrigatória nem completar sua migração sem decisão conjunta. |
| Projeção, exclusão e serviço de itens | Removem parte das rejeições, mas ainda localizam ledgers por `ownerProfileId ?? hubProfileId`. | O fallback preserva a dependência de armazenamento. Não equivale à remoção total de ownership. |
| `pokemon-hub-save-flush.mjs` | Acrescenta rejeição de diferença entre revisão-base e arquivo quando a materialização mudaria bytes. | A intenção de impedir write obsoleto deve ser preservada no contrato; essa condição isolada não prova recuperação de write parcial nem valida o resto do rework. |
| Testes locais de lifecycle/coordenador/flush | Foram alterados para investigar parte da falha e aceitar Hubs de owners diferentes. | Reaproveitar casos de regressão após revisão; não tratar o estado local da suíte como certificado do modelo novo. |

Há nove arquivos rastreados de código/teste modificados e um módulo de código
novo não rastreado nessa tentativa, além desta spec. Esta etapa não modifica,
reverte nem incorpora essas alterações. Antes da implementação, seu aproveitamento
ou substituição deverá ser explicitado para não somar duas arquiteturas parciais.

### 19.2 Diferenças concretas entre o código atual e o contrato desejado

| Aspecto | Código atual inspecionado | Trabalho necessário |
|---|---|---|
| Início da sessão | `ensurePokemonHubSession(profileId)` é chamado durante uso/carga; servidor emite UUID sob profileId. | Iniciar e registrar a sessão automaticamente na abertura do Hub; definir registro/retry da identidade sem perfil obrigatório. |
| Recuperação por horário | `open` guarda expiresAt, mas não um registro histórico de início; fechamento apaga a sessão ativa, com terminal de replay temporário. | Conservar identificação do período de trabalho e associação aos originais após close/expiração; não confundir retenção histórica com duração do lease. |
| Primeira carga | `loadCanonicalPane` adquire a fonte, publica a anterior e troca a composição ativa. Não captura original por sessão/perfil. | Garantir o original antes de liberar a fonte para edição; na reentrada, verificar existência e preservar a cópia. |
| Leituras que escrevem | Layout/adoption e o wrapper local podem criar/importar dados ao ler. | Delimitar leitura, primeira captura e ativação para impedir que uma preparação altere o conteúdo antes de proteger seu original. |
| Autoridade da fonte | Baseline duplica por namespace; tentativa traduz parte das chaves. | Endereçar um conteúdo corrente por recurso; a sessão referencia esse recurso e mantém seu backup, sem produzir outra autoridade ativa. |
| Movimento de Pokémon | UI projeta movimento, agrupa envios; coordenador persiste estado lógico e marca dirty; endpoint responde 200 sem publicar automaticamente cada Save alterado nesse caminho. | Acordar a fronteira de durabilidade/materialização do salvamento contínuo e implementá-la com confirmação das duas pontas. Não declarar que o `.sav` já foi salvo a cada movimento. |
| Movimento de itens | Serviços específicos já recebem pontas explícitas, gravam bytes e usam putPair, mas Hub ainda tem endereço proprietário. | Reusar políticas de item e gravação com revisões, retirando owner e integrando o mesmo ciclo de perfil/sessão/backup. |
| Fechamento local | Existem pane-load, snapshot estrutural, detach e close com caminhos diferentes e callbacks. | Convergir o comportamento de persistir, sair do ativo e preservar backup; decidir quais entradas públicas continuam necessárias. |
| Integridade | Há revisões, membership, leases, replay e snapshots; a escrita composta de Pokémon não é indivisível no armazenamento atual. | Preservar verificações úteis e estabelecer um resultado recuperável completo; eliminar cópias de autoridade, não as garantias. |
| Restore | Exportação global e journals não fornecem o conjunto de originais e a identificação de sessão definidos na seção 2. | Tornar a recuperação por sessão verificável, sem criar tela de restore ou automação que o usuário não solicitou. |

### 19.3 Complexidade a retirar e mecanismos a preservar

| Destinação proposta | Elementos | Justificativa e limite |
|---|---|---|
| Retirar do modelo ativo | ownerProfileId, bindOwner, conflito entre owners, workspaceProfileId, perfil fictício da sessão e partição proprietária. | Não representam uma regra do produto. A identidade legítima do Save/jogo permanece. |
| Retirar do fluxo de seleção | Close/open global motivado por perfil, recarga dos outros Saves e splash global decorrente da seleção local. | O container troca seu binding; a sessão continua. |
| Candidatos à retirada após auditoria de consumidores | Rotas de inventário/transferência antiga, grid transfer restrito a Save/Hub, attach/detach/protocolo compacto redundantes e stores legados ligados a esses caminhos. | O frontend atual importa pane-load, snapshot e close canônicos; não foi encontrado nele consumo das antigas operações diretas. O backend ainda as expõe, portanto clientes externos não podem ser presumidos inexistentes. |
| Não consolidar automaticamente | Tradução v2/v3, importação lazy e fallback owner do fix interrompido. | Acrescentam caminhos de compatibilidade sem completar o contrato novo. Qualquer mecanismo de migração precisa de limite e saída definidos. |
| Reaproveitar com contratos ajustados | Workspace/panes, snapshot canônico, validação de identidade, flight de requisições, projeção de itens e adaptadores. | Já resolvem problemas necessários. Remover ownership não exige reescrever grids, cards, drag-and-drop ou codecs nativos. |
| Preservar e corrigir onde necessário | Revisões, idempotência, leases/fencing, journal de recuperação, guards do player e validação de formato/party/itens. | Não são complexidade descartável. Protegem o conteúdo; devem operar sobre o recurso e a sessão corretos. |
| Implementar porque falta ao contrato | Original por perfil/sessão, sua captura única antes da edição e identificação recuperável da sessão. | São responsabilidades necessárias ao modelo definido, não novos recursos de UI. |

O objetivo de simplificação é reduzir caminhos de autoridade e de lifecycle,
sem forçar Pokémon, itens e arquivos nativos a um algoritmo genérico único.
As regras específicas podem continuar nos módulos especializados. O que deve
ser comum é a identificação da sessão, a participação explícita dos perfis, a
garantia do original e o resultado íntegro da operação.

Critérios verificáveis de simplificação: uma seleção não troca sessão; nenhum
serviço precisa descobrir o owner para achar o conteúdo; reabrir não cria novo
original na mesma sessão; nenhum escritor ativo contorna o contrato; protocolos
retirados não continuam disponíveis como fallback silencioso. Reduzir linhas ou
número de arquivos, isoladamente, não demonstra esses resultados.

## 20. Contextualização da implementação e decisões conjuntas

Esta seção é um roteiro condicionado, não um plano executável com arquitetura
física já escolhida. A organização abaixo descreve responsabilidades e dados
necessários; não cria nomes de módulos, tabelas, rotas ou serviços novos como
decisão fechada. Lógica abaixo da apresentação permanece em `apps/packages`;
frontend React apresenta o estado, backend compõe dependências/HTTP e Electron
continua consumindo o frontend.

### 20.1 Como as responsabilidades se encaixam

- **Sessão:** registra o início do período de trabalho, controla até três bindings
  ativos, acompanha revisões e mantém a associação aos originais já capturados.
  A memória histórica necessária à recuperação sobrevive ao fim do estado ativo.
- **Perfil:** oferece sua identidade estável, seu conteúdo corrente e as capacidades
  de leitura/escrita do respectivo formato. Não recebe outro perfil como dono.
- **Backup:** verifica a existência do original naquela sessão, captura se ausente
  e devolve a garantia de proteção antes de editar. Reentrada apenas consulta;
  persistência corrente não chama "substituir original".
- **Movimentação:** recebe participantes explícitos, valida estado e compatibilidade,
  confirma o resultado e atualiza o controle ativo. O uso do backup é uma
  precondição de entrada do perfil; não é uma nova cópia para cada gesto.
- **Saída:** conclui os efeitos pendentes do perfil, garante seu estado persistido,
  retira o binding e libera o uso ativo. Preserva a associação histórica e o
  backup, mesmo que outro perfil ocupe o mesmo bloco.
- **Recuperação:** resolve o período indicado pelo usuário e seus originais;
  define com ele o conjunto a restaurar e os efeitos posteriores envolvidos.
  Não reutiliza o caminho normal de seleção para restaurar estados antigos.

O caminho funcional de uma abertura é: sessão registrada → perfil identificado →
original existente ou primeira captura concluída → versão corrente disponibilizada
no snapshot ativo → manipulação e persistência. A saída é: concluir persistência →
retirar do ativo → manter original localizável pela sessão. A coordenação física
entre essas etapas é assunto das decisões abaixo.

### 20.2 Decisões que o agente não pode tomar sozinho

| ID | Questão a decidir com o usuário | Alternativas e consequências a avaliar antes de implementar |
|---|---|---|
| D01 | Endereço e autoridade dos conteúdos independentes. | Reorganizar as estruturas existentes ou substituir sua organização de persistência. O menor diff pode conservar mais legado; uma substituição pode simplificar o runtime, mas amplia migração. Nenhum namespace compartilhado, banco ou store novo está aprovado. |
| D02 | Fronteira do salvamento contínuo e confirmação de uma transferência. | Materializar arquivos das pontas antes da confirmação, ou confirmar um estado durável recuperável com materialização coordenada posterior. Há custos diferentes de latência e recuperação. Preservar saves contínuos e persistência concluída ao sair é obrigatório; o significado exato de "salvo" precisa ser acordado. |
| D03 | Armazenamento, integridade e retenção dos originais e identificação histórica. | Avaliar armazenamento junto à persistência atual ou em artefatos próprios, sem presumir novo serviço. Escolher como manter originais completos, detectar captura incompleta, localizar sessão encerrada e controlar espaço. A regra um original por perfil/sessão já está fechada. |
| D04 | Coordenação entre escritores e topologia suportada. | Determinar as primitivas de exclusão/commit adequadas ao ambiente real e à passagem de escrita entre Hub, player e recuperação. Não escolher Redis Cluster, processo único ou infraestrutura distribuída por suposição. |
| D05 | Corte dos dados e clientes antigos. | Comparar corte controlado com migração prévia e compatibilidade transitória delimitada. O primeiro exige janela de transição; a segunda aumenta caminhos concorrentes e critérios de remoção. Não executar importação em leitura ou manter dois escritores sem decisão explícita. |
| D06 | Protocolo público de início, abertura, sincronização e encerramento. | Definir registro/retry da sessionId automática e as entradas canônicas que ficam. Preservar snapshots em frontend/backend; decidir como intenções de movimento e confirmações são representadas sem restaurar a duplicidade de protocolos. |

Não é necessário responder todas essas questões para entender o escopo. Porém,
o trabalho de implementação que depender de cada uma só pode começar depois da
decisão conjunta correspondente. Formato de restore e tratamento de alterações
posteriores também precisam ser fechados antes de executar qualquer restauração.

## 21. Sequência de implementação proposta para discussão

As etapas são marcos verificáveis, não commits automáticos nem autorização de
deploy. Não haverá worktree, build, commit ou migração de produção por decorrência
deste roteiro. As modificações locais interrompidas devem ser tratadas
explicitamente na preparação; não serão descartadas silenciosamente.

| Etapa | Escopo e arquivos principais existentes | Entrega e prova necessárias | Dependências |
|---|---|---|---|
| I01 — Fechar contratos e preparar regressões | Esta spec; `apps/tests/pokemon-hub/helpers.mjs`, `profile-lifecycle.spec.mjs`, `snapshot-audit.mjs`; testes de packages e backend pertinentes. | Decisões necessárias registradas, aproveitamento do diff local discriminado, regressões reproduzíveis para sessão automática, troca local e original imutável. Primeiro demonstrar a falha de contrato que cada teste pretende detectar. | D01–D06 conforme o trecho; nenhuma arquitetura implícita nas fixtures. |
| I02 — Independência da fonte e acesso aos dados | `pokemon-hub-profile-store.mjs`, `pokemon-hub-redis-keys.mjs`, `pokemon-hub-snapshot-coordinator.mjs`, `pokemon-hub-event-store.mjs`, adoção/materializador, itens e projeções do servidor. | Hub e Save localizados por identidade própria, records/histórico preservados e sem owner obrigatório. Abertura em outra sessão não cria autoridade paralela. Usar fixtures isoladas antes de dados legados reais. | D01/D04; R01–R03/R09/R12/R26. |
| I03 — Sessão automática e original por perfil | `pokemon-hub-session-service.mjs`, `hub-client.js`, `pokemon-hub-ui.jsx`, backend e capacidade de backup a definir em D03. | Sessão existe antes do primeiro perfil; primeira carga protege original; repetição e reabertura não sobrescrevem; consulta histórica sobrevive ao close/expiry. Testar falha de captura e duas primeiras cargas concorrentes. | I02, D03/D06; R16–R20/R27. |
| I04 — Transição íntegra e persistência contínua | Coordenador/sessão, `pokemon-hub-save-flush.mjs`, `save-store.mjs`, serviços de itens, leases, snapshots de execução e fluxo do player. | Transferências confirmam ambas as pontas uma vez; arquivo mais novo não é sobrescrito por snapshot antigo; falha entre writes é recuperada. Corrente evolui e original permanece igual. | D02/D04 e bases I02/I03; R07–R11/R14/R20–R26. |
| I05 — Lifecycle local de cada bloco | UI, workspace, session-view, snapshot-flight, client e handlers canônicos. | Fechar/trocar persiste o perfil de saída, retira do ativo e preserva seu backup. Os outros blocos e a sessão permanecem; abrir novamente lê o corrente. Garantir loading local e proteção contra respostas atrasadas. | I03/I04; R04–R06/R10/R22/R28. |
| I06 — Retirar rotas e dependências substituídas | Composição/rotas em `server.mjs`; serviços, stores e métodos legados identificados na seção 19; testes/helpers afetados. | Um contrato ativo por responsabilidade, sem acesso alternativo que contorne integridade. Remover consumidores e dependências órfãs comprovadas; chamadas incompatíveis rejeitadas sem escrita. | D06, I02–I05; R01/R02/R13/R24. |
| I07 — Ensaiar migração e recuperação | Chaves, dados legados, ledgers, importador, backup, player e clientes; fixtures representativas. | Inventário, ensaio repetível de migração e restauração em isolamento; conservação de IDs/quantidades/história; conflito explícito sem escolha arbitrária. Cutover real permanece separado e depende de instrução do usuário. | D05, mecanismos anteriores; M01–M05/R12/R14/R19/R25–R27. |
| I08 — Verificação integrada final | Suíte E2E existente ampliada, integração com persistência real e testes de formatos/contratos. | Cenários V01–V31 rastreados a evidência; modelo das cinco caixas aprovado após close/reopen/restart; nenhum vínculo proprietário ativo ou escritor antigo. Relatar limites de cada ambiente. | I01–I07; R15 e conjunto dos requisitos. |

Testar cada etapa não substitui a campanha final, e a campanha final não substitui
testes de falha nos pontos onde há persistência composta. As etapas podem exigir
ajustes coordenados entre arquivos; não devem deixar uma versão parcialmente
convertida acessível a dados reais durante o desenvolvimento.

A rastreabilidade dos 28 requisitos está distribuída na tabela; R17 também é
critério de I02/I03, R18 exige primeira captura antes de qualquer edição de I04,
e R23 atravessa I04/I05. Os 18 bloqueadores anteriores permanecem como condições
de encerramento das etapas correspondentes, não como recursos extras a construir.

## 22. E2E existente e verificação do rework

### 22.1 Cobertura que deve ser reaproveitada

Esta é uma leitura da suíte no checkout, não uma execução nova ou declaração de
que os testes estão passando. `apps/tests/pokemon-hub/package.json` oferece
scripts de teste, stress e falha; `run.mjs` sobe backend e Vite com dados
temporários; Playwright usa Chromium, um worker e zero retries na configuração
inspecionada. Existem requisições concorrentes e duas abas dentro dos cenários,
apesar de a suíte ser executada com um worker.

| Arquivos E2E | Cobertura observada | Adaptação para o contrato definido |
|---|---|---|
| `transfers.spec.mjs` | Save↔Hub, Save↔Save, Hub→Hub, identidade, party, slots ocupados, fechamento após drag e bytes nativos. | Preservar regras e ampliar observação do original e dos perfis já fechados. |
| `profile-lifecycle.spec.mjs` | Criação, exclusão, alternância de Hubs e regressão local do rollback. | Trocar fixtures que dependem do owner por preparação de recursos independentes; manter legado apenas como fixture explícita de migração. Cobrir cinco perfis na mesma sessão. |
| `snapshot-races.spec.mjs`, `snapshot-adversarial.spec.mjs` | Resposta atrasada, replay, revisão obsoleta, payload diferente com mesma chave, identidades inválidas e pedidos paralelos. | Preservar assertivas de conservação no novo contrato e observar todas as pontas persistidas. |
| `interaction-races.spec.mjs` | Cancelamento durante drag, fechar Hub com ACK retido e heartbeat em trânsito. | Confirmar persistência antes de saída ativa e nenhum efeito de resposta antiga na sessão seguinte. |
| `items.spec.mjs` | Quantidades, stacks, compatibilidade, Hub↔Save/Hub↔Hub, filas, rejeição, replay e resposta antiga de close. | Eliminar endereço proprietário de ledger; verificar conservação e original imutável junto com Pokémon. |
| `stress.spec.mjs` e `stress-campaign.mjs` | Drags repetidos/aleatórios, refresh, dois clientes, perda de ACK, reabertura e filas. | Acrescentar troca de perfis durante o trabalho e comparação corrente/original; manter seeds reproduzíveis e escopo delimitado. |
| `fault-recovery.spec.mjs` e `fault-runner.mjs` | Uma falha injetada na gravação de flush seguida de recuperação por expiração. | Acrescentar falha na primeira captura, falha após uma das escritas da transferência e recuperação de captura incompleta. |
| `backend-restart.spec.mjs` | Recriação do servidor após snapshot aceito, com preservação de sessão e Save na fixture. | Complementar com queda de processo e persistência real; verificar descoberta histórica e originais após reinício. |
| `snapshot-audit.mjs` | Inspeciona POSTs de snapshot/close, chaves, revisões, unicidade no payload, respostas, erros e duração. | Atualizar filtros conforme D06 e exigir observações esperadas. Não confundir unicidade nos panes com unicidade em todos os dados relevantes. |

### 22.2 Lacunas específicas que os testes atuais não encerram

O runner usa `createMemoryRedisPersistence`. Seu endpoint de restart fecha o
servidor HTTP e cria outro com o mesmo objeto de persistência em memória dentro
do mesmo processo. É uma prova útil de lifecycle, mas não exercita perda de
processo, Redis externo, recuperação de disco ou atomicidade entre serviços.
Essa diferença importa principalmente em I04/I07; não invalida os testes de UI.

O backup original por perfil/sessão não existe no fluxo atual, então a suíte
existente não pode provar sua imutabilidade, captura única, localização histórica
ou restauração coerente. Esses casos são V06–V08 e V23–V31, conforme seu escopo.
V10/V12/V13/V22 exigem também integração/falhas de persistência, além do navegador.

O auditor atual pode não observar rotas cujo formato tenha mudado. Sua verificação
de unicidade percorre os panes presentes em cada payload; backups, fontes já
fechadas e chaves legadas não são cobertos por essa checagem. As verificações de
conservação devem ler o estado persistido pertinente e comparar os originais
sem tratá-los como localizações ativas duplicadas.

### 22.3 Execução futura e evidência exigida

Comandos já previstos pelo repositório, a executar somente na etapa de código
adequada, a partir do checkout original:

- `node --test apps/packages/pokemon-hub-session-service.test.mjs apps/packages/pokemon-hub-snapshot-coordinator.test.mjs apps/packages/pokemon-hub-save-flush.test.mjs`: contratos de sessão/coordenador/flush, após adaptação dos testes.
- `npm --prefix apps/backend test`: regressões da composição e contratos do backend.
- `npm --prefix apps/tests/pokemon-hub test -- profile-lifecycle.spec.mjs transfers.spec.mjs`: ciclo de perfis e transferências.
- `npm --prefix apps/tests/pokemon-hub test`: campanha E2E completa após integrar as etapas.
- `npm --prefix apps/tests/pokemon-hub run fault` e `npm --prefix apps/tests/pokemon-hub run stress -- 5`: cenários existentes de falha e cinco rodadas reproduzíveis de stress, quando pertinentes à mudança.

Testes de backup e integração com persistência real precisarão de configuração
definida em D03/D04; não há comando pronto presumido para uma infraestrutura
ainda não escolhida. A prova deve registrar cenário, ambiente, falha injetada,
identidades/quantidades antes e depois e resultado após reabertura/recuperação.
Não declarar sucesso pela mera existência de testes ou pela atualização de
expectativas. Nesta etapa documental não foi executado build nem suíte de código.

## 23. Curva de implementação e risco de regressões

### 23.1 Avaliação de esforço e dependências

Avaliação qualitativa baseada nos caminhos lidos, sem estimativa fictícia de
horas ou probabilidade numérica de bugs. A clareza do modelo reduz a dificuldade
de domínio; a maior parte do esforço está em substituir contratos persistidos e
coordenar escritores existentes. **A implementação completa tem complexidade
média-alta; a migração e a recuperação de dados são as partes de maior dificuldade.**

| Frente | Curva estimada | Motivo |
|---|---|---|
| Modelo das caixas e ciclo funcional | Baixa | Está definido: sessão, corrente, original único e saída persistida. Não exige novas regras de gameplay. |
| UI e troca local | Média | Layout e interação existem; é preciso retirar dependências de perfil, iniciar sessão corretamente e manter ordem de respostas/filas. |
| Sessão e backup original | Média-alta | A verificação de primeira abertura é simples; torná-la durável sob retry/concorrência e manter descoberta após expiração exige trabalho coordenado. |
| Identidade/autoridade persistente | Alta | Chaves, documentos, records, eventos, ledgers e leitores dependem do namespace antigo. Uma remoção parcial pode ocultar ou duplicar dados. |
| Transferência e gravação contínua | Alta | Pokémon lógico, arquivo nativo e itens têm fronteiras de confirmação diferentes; é necessário fechar resultado/recuperação entre as pontas. |
| Retirada de legado | Média | Os caminhos estão localizados, mas os consumidores e a rejeição de clientes antigos precisam ser verificados. |
| Migração e restore | Alta | Exigem tratar dados divergentes e preservar IDs/história, sem escolher cópias por heurística ou restaurar apenas uma ponta. |
| Ampliação dos testes | Média | Há base E2E e fixtures reutilizáveis; novos originais e falhas reais de persistência ainda precisam de cobertura própria. |

A curva concentra dificuldade no início: decidir autoridade/contratos e provar
persistência antes de completar o lifecycle da UI. Depois dessas bases, a troca
local e a remoção de código proprietário se tornam mais diretas. Não é uma
reescrita completa de adaptadores, grids, sprites, cards ou player; ampliar para
essas áreas sem necessidade aumentaria risco sem atender melhor ao modelo.

### 23.2 Riscos concretos e como reduzir cada um

| Regressão possível | Risco inerente à mudança | Controle e prova |
|---|---|---|
| Conteúdo sumir ao retirar owner | Alto impacto; superfície diretamente afetada. | Inventário/migração, leitura por identidade própria e conservação de records/ledgers: I02/I07, V17/V18. |
| Transferência ficar pela metade ou repetir após falha | Alto impacto; já há fronteiras não atômicas. | Contrato de confirmação e recuperação, replay e falhas entre writes: I04, V09–V14. |
| Backup receber estado já modificado | Alto impacto para recuperação; recurso novo. | Primeira captura protegida e imutabilidade após reopen/save: I03, V06–V08/V24/V31. |
| Sessão/original desaparecer ao expirar | Alto impacto na capacidade de restaurar. | Separar fim de uso ativo de retenção histórica, sem ressuscitar lease: I03, V28. |
| Resposta antiga recolocar perfil ou snapshot anterior | Impacto médio-alto; UI e API mudam juntas. | Identidade/revisão/binding e testes de atraso/close imediato: I05, V02/V24/V29. |
| Player receber ou publicar Save incompatível | Alto impacto; escritor externo ao Hub. | Preservar lease/fence, revisão e validade de runtime: I04/I07, V11–V14. |
| Testes verdes deixarem de observar o fluxo novo | Risco de falsa confiança durante troca de protocolo. | Revisar filtros/helpers, exigir captura e ler persistência fora dos panes: I01/I08, V30. |
| Captura/publicação deixar a UI lenta | Impacto de uso, dependente das decisões físicas. | Medir primeira carga e movimentos com tamanhos representativos; preservar loading local e distinguir captura inicial de reabertura sem cópia. Não inventar metas de latência antes da medição/acordo. |

Os E2E existentes reduzem o risco dos fluxos interativos e serão reaproveitados.
Eles não tornam desnecessárias as decisões de persistência nem substituem provas
de queda entre writes. Com contratos fechados, implementação em etapas e a
cobertura complementar indicada, o rework é controlável; não há base para prometer
risco zero ou uma taxa de bugs. O risco residual deve ser reavaliado após as
evidências de cada etapa, sobretudo migração e restore.

O resultado desta etapa é o levantamento e a contextualização verificável da
implementação. O próximo passo de arquitetura é discutir D01/D02 — identidade e
autoridade do conteúdo e fronteira de confirmação — antes de escolher suas
estruturas de armazenamento e iniciar código dependente dessas escolhas.

## 24. Registro da execução por tópicos

O usuário autorizou iniciar a implementação e avançar entre tópicos sem pedir
confirmação a cada etapa. Trabalho no checkout original, na branch criada pelo
usuário: `rework/pokemon-hub-backup-containerzation`. Sem build, commit, deploy ou
uso de dados reais. Os relatos documentais das seções anteriores descrevem suas
respectivas etapas; este registro é o estado corrente da execução.

### Tópico inicial em andamento

- Base local preservada: a tentativa anterior continua discriminada na seção 19;
  não foi aceita automaticamente como arquitetura final.
- Registradas duas perguntas de decisão conjunta: preservação de Redis/arquivos
  com identidades independentes e momento da confirmação em relação à gravação
  das pontas. Sem resposta, não iniciar mudanças dependentes dessas escolhas.
- Adicionado `apps/tests/pokemon-hub/session-start.spec.mjs`: abertura do Hub deve
  registrar sessão com panes vazios antes da escolha de perfil; adicionar/remover
  blocos não cria outra sessão e nova abertura deliberada gera outra identidade.
  Execução RED: recebeu zero sessões quando esperava uma. A implementação desse
  contrato permanece pendente; o teste não está passando ainda.
- Baseline dos contratos de sessão/coordenador/flush: 72 testes passaram no
  checkout com a tentativa anterior. Isso não valida o rework completo.
- Investigado o fechamento obsoleto: `flush` avançava a fence do arquivo antes de
  recusar conflito de revisão. Teste com Save Store real e arquivo temporário
  demonstrou fence 4 alterada para 5 apesar da rejeição da publicação.
- Ajuste localizado: adiar a instalação da fence até depois da materialização e
  da validação de conflito, preservando a proteção antes do write válido. Não
  muda infraestrutura, namespace ou protocolo de confirmação.
- GREEN após o ajuste: 85 testes passaram nos arquivos de sessão, coordenador,
  flush e Save Store. O teste novo comprova que bytes, revisão e fence do Save
  mais novo permanecem iguais após a rejeição do fechamento obsoleto.
- Verificação ampliada dos packages: 695 testes, 693 passaram, dois ignorados,
  zero falhas. Backend: 115 testes, 114 passaram e uma falha em
  `acquires an open grid pane as a workspace snapshot source`, cuja fixture
  oferece apenas `bindOwner`, enquanto a tentativa anterior do servidor agora
  consulta `list`. A incompatibilidade pertence à conversão parcial já presente;
  deverá ser tratada ao consolidar o contrato, sem restaurar ownership para
  satisfazer a expectativa antiga. A suíte completa não está verde.

Logs desta rodada em `apps/tests/pokemon-hub/test-results/` (ignorados pelo Git):
`session-start-red.log`, `contracts-before.log`, `contracts-stale-close.log`,
`packages-current.log` e `backend-current.log`.
Nenhum tópico estrutural ou o rework completo está declarado concluído.

### Decisões recebidas e progresso estrutural

- D01/D02 aprovadas pelo usuário: manter Redis e arquivos atuais, reorganizando
  identidades; confirmar transferências apenas após gravar as pontas alteradas.
- A identidade corrente de fonte e registro deixou de receber owner; sessão é
  identificada exclusivamente por sessionId. As chaves v3 compartilham um hash
  tag para permitir commits atômicos entre fontes independentes no Redis atual.
  **Ainda não executar sobre dados existentes:** o inventário/migração dos
  namespaces anteriores continua obrigatório e pendente, sem importação implícita.
- Registro automático da sessão no mount do Hub, inclusive sem perfis; retries
  do mesmo ID preservam o estado. Sessão encerrada conserva início/fim em histórico.
  E2E `session-start.spec.mjs`: RED (zero sessões) → GREEN (1 teste).
- Contratos de sessão/coordenador/eventos/chaves: 68 testes passaram após retirada
  da identidade proprietária. Isso é uma verificação parcial, não conclusão.
- Backup original por sessão/fonte: pacote com publicação de arquivo completo
  sem sobrescrita e teste real de filesystem para reabertura, nova sessão, cinco
  fontes, concorrência e falha de captura: 2 testes passaram. Integração adicionada
  antes da vinculação ativa do pane; E2E do ciclo completo ainda pendente.
- Correção do teste HTTP antigo de aquisição: passou usando store real e verificando
  que a aquisição não altera o catálogo para atribuir proprietário (115 testes do
  backend passaram antes da reorganização estrutural subsequente).
- Pendências críticas: publicação síncrona das pontas com recuperação de falhas,
  atomicidade/fencing de fontes, remoção dos contratos HTTP antigos, catálogo e
  itens sem owner, migração explícita e validação integral. Não testar dados reais
  até concluir essas etapas.

### Validações e infraestrutura de desenvolvimento

- Configuração local verificada sem expor credenciais: `apps/backend/.env` usa
  `REDIS_NAMESPACE=emulator-hub:dev`, via túnel loopback `127.0.0.1:16379`.
  `emulator-hub:v1` é produção. O usuário confirmou explicitamente essa divisão.
  Ela também está documentada em `apps/backend/README.md`; o exemplo local agora
  aponta para `dev`.
- Teste real de Redis usa exclusivamente um prefixo aleatório sob
  `emulator-hub:dev:test:pokemon-hub:<uuid>`, removendo somente suas próprias chaves.
  Nenhuma migração/restauração de dados existentes foi executada.
- `pokemon-hub-live-redis.test.mjs`: passou no Redis real (Lua de leases, movimento,
  confirmação e fechamento). Primeira execução expôs custo de SCAN com lotes
  pequenos; histórico agora usa índice próprio e SCAN administrativo usa COUNT
  1000. Execução subsequente: 1 teste passou em aproximadamente sete segundos.
- Pacotes: 701 testes, 699 passaram, dois ignorados. Backend: 111 passaram na
  rodada anterior às últimas proteções adicionais. Esses números não substituem
  a rodada final depois de todas as alterações.
- E2E de ciclo de perfis: 6 passaram. O caso inicial foi ampliado para verificar
  backup dos quatro perfis, original do Hub vazio, bytes originais do Save e
  histórico da sessão encerrada; a execução individual ampliada passou.
- A bateria E2E completa ainda está em andamento. Foram identificados testes
  que registravam o observador de abertura só depois de abrir o Hub: precisam
  observar antes do mount, pois a sessão agora nasce automaticamente.
- Testes novos reproduziram e corrigiram aquisição concorrente da mesma fonte,
  perda de lease durante validação, confirmação antes de write nativo, repetição
  após falha de write e compensação incorreta ao falhar o release de pane trocado.
- Originais de Save incluem metadados/bytes e cópias dos estados cloud-recovery e
  user-state presentes na primeira abertura. Copiar não autoriza restaurar um
  runtime incompatível: qualquer restauração real será planejada e verificada.
- Endpoints antigos de mutação retornam 410. O motor legado de transferência
  Hub/Save com bindOwner foi removido; transferências usam a sessão canônica.
- Bloqueio de cutover: presença de fontes/sessões/leases legados ou owner no
  catálogo impede abertura da nova versão até migração explícita. O utilitário
  `apps/backend/migrate-pokemon-hub.mjs` inspeciona por padrão; aplicação requer
  writers parados, fingerprint da inspeção e arquivo novo de arquivo de segurança.
  Cópias conflitantes, saves dirty, leases pendentes, revisões físicas divergentes,
  Pokémon repetidos e ledgers diferentes são blockers, sem escolha automática.

### Revisão de integridade e correções de recuperação

A revisão independente encontrou cinco falhas importantes na implementação em
andamento. Todas foram tratadas, com regressões específicas; elas demonstram por
que retirar o campo isoladamente não eliminaria as janelas de perda de integridade.

1. **Liberação parcial durante expiração:** o cleaner gravava e liberava cada
   fonte separadamente. Agora a sessão reúne fontes vinculadas, fontes retiradas
   pendentes e reservas indexadas; grava todas as pontas antes de liberar qualquer
   uma. O cleaner de fontes avulsas não libera fontes de uma sessão ainda registrada.
2. **Aquisição física sem recuperação:** uma queda depois do lock do Save e antes
   do registro lógico podia deixar um lock órfão. A intenção `acquiring` e seus
   índices são gravados juntos antes do lock físico, inclusive na primeira adoção.
   Um lock físico tardio só pode ser reconciliado quando expirou, sua sessão não
   existe e a fonte está limpa. Sessão existente ou fonte dirty impedem essa ação.
3. **Release apagava sua própria identidade:** a fonte passa por `releasing` e
   conserva suas credenciais/índices até concluir o release físico. Uma falha deixa
   um registro recuperável; repetir conclui a liberação. Saves com lock de Hub
   expirado continuam bloqueados para Player e exclusão até sua finalização.
4. **Movimento com retirada de terceiro pane:** o recibo da sessão não participava
   do commit quando havia uma fonte saindo. Agora fontes, records, eventos e recibo
   `publishing` são confirmados na mesma transação Redis, incluindo `retiredSources`.
   Falha no release não responde com o snapshot anterior nem reverte só a sessão.
5. **Migração concluída antes do catálogo:** o marcador agora começa em `preparing`;
   só vira `complete` após copiar/verificar arquivos, publicar fontes e atualizar
   o catálogo. O backend recusa abertura durante preparação. Retomar usa o mesmo
   arquivo original e fingerprint, sem selecionar cópias conflitantes.

Proteções adicionais verificadas durante essa revisão:

- A recuperação por expiração reclama o estado `recovering` antes de executar
  callbacks. Uma publicação antiga não consegue ressuscitar uma sessão já reclamada.
- Operações de itens usam a mesma transição exclusiva da sessão, estendem reservas
  até o prazo da operação e verificam sua geração antes do commit de arquivo/par.
  Elas não podem contornar uma publicação Pokémon pendente, mesmo via HTTP direto.
- Registro inicial da sessão, histórico e índices são publicados atomicamente.
  Se o índice de expiração estiver atrasado em relação ao documento, ele é reparado;
  remover o membro nessa situação faria a sessão desaparecer do cleaner.
- Fechar o Hub enquanto a resposta de abertura ainda está em trânsito aguarda essa
  identidade para encerrá-la. Não deixa uma sessão vazia criada depois do fechamento.
- Transações Redis verificam os tipos dos índices antes da primeira escrita.
  Isso evita efeitos parciais por WRONGTYPE em um comando posterior do script.

### Contratos e locais da implementação consolidada

| Responsabilidade | Contrato atual | Implementação |
| --- | --- | --- |
| Identidade | `sessionId` identifica o ambiente; `hub:<id>` ou `save:<profileId>:<gameId>` identifica a fonte nativa. Save profile ID continua sendo identidade legítima do Save; não é owner do Hub. | `pokemon-hub-redis-keys.mjs`, `pokemon-hub-session-service.mjs` |
| Abertura | Frontend gera ID ao montar; POST `/api/pokemon-hub/sessions` registra ambiente vazio antes do primeiro perfil. Retry do ID não reinicializa a sessão. | `pokemon-hub-ui.jsx`, `hub-client.js`, backend |
| Primeiro uso | Aquisição/reserva → captura completa do original → vinculação ao pane. Falha de backup impede uso ativo. | `pokemon-hub-session-backups.mjs`, callback `captureOriginal` no backend |
| Backup | Arquivo imutável por sessão/fonte, publicado inteiro; inclui records e fonte lógica, metadados/bytes nativos, catálogo/ledger do Hub ou estados de runtime do Save quando presentes. Reabrir retorna o backup existente. | `pokemon-hub-session-backups.mjs`, `readPokemonHubSessionOriginal` no backend |
| Movimento | Conservar conjunto de Pokémon; conferir identidade, revisão, reservas e regras do adaptador; commit lógico atômico; publicar todas as pontas nativas alteradas; só então confirmar. | `pokemon-hub-snapshot-coordinator.mjs`, `redis-json-transaction.mjs`, `pokemon-hub-save-flush.mjs` |
| Troca/fechamento | Persistir saída, preservar backup, retirar apenas vínculo ativo; perfis de outros panes não são reabertos ou restaurados. | `loadCanonicalPane`, snapshot canônico e finalização da sessão |
| Itens | Hub/Save são pontas independentes. Ledger de Hub usa seu próprio ID. Persistência de pares mantém journal e pré-condições existentes; confirmação após writes. | `pokemon-hub-item-transfer-service.mjs`, `pokemon-item-reorder-service.mjs`, Save Store |
| Histórico | GET `/api/pokemon-hub/sessions` lista início/fim; GET `/api/pokemon-hub/sessions/:id/backups` lista os originais daquela sessão. | Session service, backup service e backend |
| Interface | Processamento fica no pane correspondente; overlay antigo de processamento do workspace removido. | `pokemon-hub-ui.jsx` |
| Contratos legados | Mutação baseada no perfil proprietário e protocolo antigo de grid transfer são recusados/removidos. `ownerProfileId` permanece apenas como entrada do migrador. | Backend, profile store, serviços e client |

### Cutover e restauração de dados existentes

Não foi executada migração nem restauração de dados reais. O rework não escolhe
qual cópia antiga é correta. A primeira verificação em ambiente com dados existentes
é a inspeção do namespace e do diretório de Saves correspondentes, com o migrador
em modo de leitura. Produção (`emulator-hub:v1`) não foi usada nos testes.

Aplicação exige todos os escritores antigos parados, plano sem blockers, fingerprint
da inspeção e caminho novo para o arquivo de segurança. Interrupção após iniciar
preparação exige retomar com o mesmo arquivo/fingerprint. Dados legados são mantidos
como evidência. Não existe fallback de leitura que ressuscite o namespace antigo.

Blockers de dados: cópias divergentes de fonte/record/evento, Pokémon repetido ou
record fora de sua fonte, Save dirty, lease/sessão antiga não encerrada, divergência
de revisão nativa, ledger conflitante ou conteúdo de Hub sem fonte correspondente.
Eles precisam ser resolvidos com o usuário antes do cutover; testes sintéticos não
estabelecem a validade de um conjunto real de Saves.

Para restauração futura, localizar sessão pelo início registrado em UTC, convertido
para Brasília, e pela ordem de abertura indicada pelo usuário. Se houver ambiguidade,
perguntar qual abertura. O conjunto a restaurar é o conjunto inteiro de originais
daquela sessão, inclusive perfis já retirados dos três panes. Restaurar apenas uma
ponta de uma transferência pode duplicar dados e não representa rollback da sessão.
A restauração concreta exige parar escritores e validar conjuntamente Redis,
arquivos nativos e invalidação de runtime; não foi introduzido restore automático.

### Evidência atual e risco residual

- Pacotes após as proteções adicionais: **716 testes, 714 passaram, dois ignorados**
  (`verified-packages.log`).
- Backend: **112 testes, 111 passaram, um ignorado** (`verified-backend.log`;
  Redis real é opt-in separado).
- Redis real isolado sob `dev`: passou com reserva física, aquisição concorrente,
  movimento com terceiro pane retirado, falha de release, repetição e fechamento.
  Rodada final: **um teste passou**, `verified-redis.log`.
- E2E de falha de write: passou exigindo rejeição da confirmação, recuperação dos
  bytes nativos, encerramento da sessão e conservação dos IDs após reabrir.
  Rodada final: **um passou**, `verified-fault.log`.
- E2E de abertura/fechamento imediato: dois passaram; recuperação após perda de
  resposta, F5 e disputa de duas abas: três passaram na rodada direcionada.
- Bateria E2E completa: **79 passaram e um falhou**, `verified-e2e.log`.
  O caso F5 pós-confirmação ainda confundia bytes duráveis com encerramento da
  sessão abandonada. O teste agora espera também `closedAt` antes de readquirir
  a fonte. Repetição direcionada: **um passou**, `verified-e2e-recheck.log`.
  São 80 cenários com evidência aprovada em conjunto; não é uma única rodada
  completa com 80 verdes. Nenhum código de aplicação mudou entre essas rodadas.
- Cinco rodadas adicionais de stress: **dez testes passaram**, `verified-stress.log`.
  Sementes: 3235539853, 1652810054, 2219540255, 640742608 e 1241019049.
  Cada rodada executou 100 movimentos e 30 transferências entre dois Saves e um
  Hub: **650 operações adicionais**, com comparação do modelo, conservação de
  IDs e conferência da persistência. Nenhuma rodada dessa campanha falhou.
- O executor Playwright agora isola traces/screenshots por execução. A pasta única
  anterior causou ENOENT quando duas baterias rodaram simultaneamente; essa falha
  pertence ao executor, não é evidência de integridade dos Saves.

A curva de implementação é **alta**, pela mudança simultânea de identidade,
protocolo, persistência e recuperação. O núcleo funcional está integrado; o maior
risco residual concentra-se na migração de dados históricos e em falhas reais de
infraestrutura. Testes em Redis e filesystem real exercitam os contratos, mas não
substituem ensaio do cutover com uma cópia identificada dos dados e verificação do
ambiente implantado. O código de progressão Emerald da spec 085 não foi alterado.

Limites das decisões implementadas: a aprovação de Redis/arquivos existentes
resolve o armazenamento de D01 e a parte física de D03; os originais ficam retidos,
sem coleta automática ou política destrutiva de espaço. D04 preserva Redis/Lua e
as exclusões de arquivo existentes, sem selecionar outra topologia ou banco.
O protocolo D06 mantém snapshots canônicos, com sessionId e rotas independentes
do owner. Para D05 há ferramenta e ensaio isolado de corte offline, mas escolher
a janela, resolver conflitos reais, autorizar a aplicação e decidir restaurações
continuam sendo decisões conjuntas com o usuário. Não se presume autorização de
deploy, migração ou descarte de histórico.

### Últimas regressões antes da validação sequencial

- Duas adoções simultâneas da mesma fonte nativa publicavam dois conjuntos de IDs.
  Adoção agora publica fonte, records e eventos em uma transação condicional;
  somente uma primeira leitura pode criar a autoridade, sem records órfãos da
  concorrente. Fonte dirty não pode ser substituída por uma cópia nativa antiga.
- Reservas físicas estendidas até o prazo da operação eram encurtadas novamente
  por `assertHub`. Assert, renovação e reaquisição preservam o maior vencimento;
  o teste demonstra que o prazo protegido não volta de 2000 para 1010.
- Movimento em dois Saves durante resposta atrasada de troca do terceiro pane
  podia ser perdido ao aplicar o snapshot capturado antes do carregamento.
  Intenções passam pela fila de operações do pane/sessão, validam participantes
  ainda ativos e são aplicadas após o carregamento. O gesto é conservado e o close
  aguarda sua conclusão. O E2E verifica destino, origem e bytes nativos.
- A regressão original passou a abrir cinco perfis na sessão, incluindo substituir
  e reabrir um Save, e exige os cinco originais no backup depois do fechamento.
  O cenário ampliado passou individualmente. O helper de seleção navega pelo
  nome efetivamente ativo: o seletor virtualizado preserva a opção anterior e
  não implementa Home; presumir o índice inicial selecionava outra ROM/perfil.
- Campanhas simultâneas também disputavam recursos e cache de desenvolvimento
  do Vite. As rodadas interrompidas/afetadas não contam como aprovação final.
  O fechamento da validação usa processos sequenciais, sem alterar fontes durante
  a execução. Logs com prefixo `verified-` são a evidência final dessa rodada.

### Encerramento da implementação — 2026-09-30

Os tópicos I01–I08 estão implementados e a validação automatizada descrita acima
foi concluída. Os registros anteriores de andamento desta seção são históricos;
a evidência atual está em “Evidência atual e risco residual”. Os logs `verified-`
ficam em `apps/tests/pokemon-hub/test-results/`, ignorados pelo Git, e preservam
os caminhos dos artefatos de cada execução. `git diff --check` não apontou erros.

Não houve build, commit, deploy, migração nem restauração de dados reais nesta
etapa. O próximo passo é o ensaio com dados reais solicitado pelo usuário, com
inspeção e resolução conjunta dos blockers do conjunto escolhido antes de
qualquer aplicação da migração. A ferramenta de migração mantém `ownerProfileId`
somente para interpretar e remover a estrutura legada; o runtime não o utiliza.

O risco de regressão não é zero: o rework tem complexidade alta e a validação
automatizada não reproduz todas as falhas físicas de infraestrutura. Permanecem
como limites explícitos o corte do ambiente existente, conflitos históricos e
restaurações reais. Essas decisões não foram tomadas automaticamente.

## 25. Ensaio de migração com cópia real — autorizado em 2026-09-30

O usuário autorizou copiar integralmente o namespace de produção `emulator-hub:v1`
para `emulator-hub:dev`, incluindo os Saves e demais dados do backend, manter uma
base local restaurável e executar/analisar a migração em desenvolvimento. Dev pode
ser substituído e restaurado quantas vezes o ensaio exigir. Isso não autoriza
migrar, restaurar ou interromper produção. Novas escolhas de arquitetura continuam
sujeitas à decisão conjunta.

Etapas desta execução:

1. Identificar configuração e escritores, preservar o dev anterior e capturar
   Redis v1 + diretório completo de dados do backend em backup local ignorado pelo
   Git; verificar estabilidade da origem, hashes e conjunto de arquivos.
2. Restaurar essa base exclusivamente em dev, conferir equivalência e inspecionar
   o plano do migrador existente. Preservar originais para repetição.
3. Executar migração em dev; coletar blockers e analisar qualquer divergência sem
   escolher silenciosamente entre cópias históricas conflitantes.
4. Verificar conservação de Pokémon, itens, Saves, metadados e históricos; ensaiar
   restauração da base e repetir a migração quando o conjunto permitir.
5. Registrar comandos, caminhos, contagens, hashes, resultados e limites nesta
   mesma spec. Produção permanece somente como origem de leitura.

### Base capturada e resolução verificável no dev

- O usuário fechou os players após a primeira captura detectar alterações em
  oito snapshots; aquela tentativa não foi aceita como base consistente.
- Base validada: `test-data/pokemon-hub-migration/2026-09-30T17-15-16-967Z`.
  Redis capturado às 17:15:23 UTC e verificado às 17:15:59 UTC: 11.015 chaves.
  Diretório completo: 164 arquivos, 136.599.138 bytes. Dev anterior preservado
  (8.774 chaves e diretório local integral). Originais de produção foram apenas lidos.
- O clone em dev foi conferido por fingerprint de Redis e hashes de todos os
  arquivos. A base local permite repetição sem reler produção.
- Inspeção: 34 cópias de fontes Save divergentes, cinco sessões antigas expiradas
  e sete conflitos de revisão resultantes da seleção inicial de cópias obsoletas.
  Cada Save conhecido tem exatamente uma cópia que coincide simultaneamente com
  a revisão nativa, posições e hashes de todos os registros atuais. Nenhuma
  preferência por owner, maior revisão lógica entre partitions ou data foi usada.
- Preparação exclusiva de dev: arquivar as 34 cópias comprovadamente obsoletas e
  as cinco sessões expiradas; conservar todos os records e eventos. A preparação
  recusa dados dirty, reservas ativas, ausência de correspondência ou ambiguidade.
  Cópias removidas do conjunto ativo permanecem em chaves `migration-archive` e no
  backup original integral. Os arquivos nativos não são reescritos.
- Auditoria anterior: 116 Pokémon em Saves e 494 em cinco Hubs não vazios, sem
  identidade nativa repetida no conjunto atual. Há sete Hubs no catálogo, dois
  vazios; o catálogo `grid.entries` vazio não representa o conteúdo das fontes.
  Um Save já não inicializado é preservado byte a byte, sem tentar validá-lo como
  um jogo iniciado e sem produzir conteúdo de Hub para ele.
- As leituras independentes do migrador passaram a usar lotes limitados de 100;
  fingerprint, pré-condições e verificação antes de gravação foram preservados.
  Os quatro testes do migrador passaram após essa alteração.

### Resultado da migração e das três repetições

As três rodadas partiram da mesma base integral, restaurada em dev antes de cada
migração. A terceira executou diretamente `Replay-Development.ps1`, incluindo os
reforços da revisão dos scripts. O estado atual de dev é o resultado migrado da
terceira rodada, auditado às 17:36:47 UTC (14:36:47 de Brasília), em 2026-09-30.

| Verificação | Resultado em cada rodada |
| --- | --- |
| Fontes independentes migradas | 15: dez Saves e cinco Hubs com conteúdo |
| Perfis Hub no catálogo | Sete, incluindo dois vazios; sem ownerProfileId |
| Pokémon ativos | 610: 116 em Saves e 494 em Hubs |
| IDs de instância / identidades nativas distintas | 610 / 610 |
| Checksums do núcleo Pokémon válidos | 610 |
| Arquivos iguais à base, byte a byte | 164 |
| Chaves canônicas publicadas | 8.708 |
| Records / eventos preservados na migração | 3.861 / 4.832 |
| Chaves originais Redis intactas no mesmo endereço | 10.975 |
| Documentos originais preservados no arquivo Redis de migração | 39 |
| Catálogo original transformado | Uma chave; cópia original no backup |
| Chaves totais no dev ao término | 19.724 |

O auditor confere cada documento publicado contra o plano, cada posição ocupada
contra o estado original, IDs, placement, hashes dos bytes e checksum nativo.
Confere também todos os arquivos e o DUMP das chaves originais. Assim, a conservação
de itens nativos, Saves, snapshots, metadados e backups é sustentada pela igualdade
integral dos arquivos, além da inspeção dos Pokémon. Não havia ledger de itens Hub
para copiar nesta base; o ensaio real não amplia a cobertura desse caso vazio.
Records históricos não são contados como novos Pokémon ativos.

Fingerprints iguais nas três rodadas:

- Plano de migração: `5614e938dfce942a994e3a52948a927e168cd4d11aa103add273d4ff0ef4f3d8`.
- Conjunto de Pokémon ativos: `228b686b5569791947593fb257c647e5507ca634cb9d3942af1ba9297820d85c`.
- Redis original: `d5ef719eaec4ab07813c2e1cf93eac8b9b42e48b530bd31883e58bab8aefa82d`.
- Arquivo TAR original: `860b1268db156bddcc528908febff4d5cd054714a68b1b7f4cc71e0726e62174`.

Evidências dentro da pasta da base: `verification-round1.json`,
`verification-round2.json`, `verification-round3.json`, `replay-final.log`,
`post-migration-redis-round*.json.gz`, `migration-original-round*.json` e os planos
`development-reconciliation-*.json`. A terceira aplicação guardou seu plano em
`migration-original-20260930-143523.json`; `migration-original-round3.json` é uma
cópia desse mesmo documento usada pelo auditor.

### Repetir o ensaio local

Fechar o backend e clientes de desenvolvimento antes de executar, na raiz do
checkout original:

```powershell
& .\test-data\pokemon-hub-migration\2026-09-30T17-15-16-967Z\Replay-Development.ps1 -WritersStopped
```

O script configura o namespace `emulator-hub:dev`, restaura Redis e todo o diretório
local `apps/backend/data`, reconcilia somente cópias comprovadas contra os Saves
nativos, inspeciona blockers e aplica o plano pelo fingerprint. Não recaptura
produção. A opção `-WritersStopped` é a declaração do operador de que fechou os
escritores; não encerra processos automaticamente. Originais, dev anterior e
diretórios substituídos permanecem na pasta da base, ignorada pelo Git. Não há
limpeza automática desses arquivos.

Responsabilidades dos comandos e packages:

- `restore-development-baseline.mjs` / `development-data-rehearsal.mjs` /
  `redis-namespace-archive.mjs`: validar a base, restaurar arquivos e chaves apenas
  em dev e conferir equivalência. O dump binário conserva os tipos Redis; TTLs
  temporários são recriados com a duração restante capturada. Timestamps de
  documentos permanecem originais.
- `reconcile-development-pokemon-hub.mjs` /
  `pokemon-hub-development-reconciliation.mjs`: comparar revisão, posições e bytes
  nativos; arquivar cópias obsoletas e sessões expiradas com precondições de valor
  em transação Redis. Recusar fonte dirty, reserva ativa e correspondência ausente
  ou ambígua.
- `migrate-pokemon-hub.mjs` / `pokemon-hub-source-migration.mjs`: publicar as
  identidades independentes, preservando histórico, e remover owner do catálogo.

### Revisão, testes e limites desta etapa

A revisão final dos scripts encontrou dois pontos, corrigidos com regressões que
falharam antes da correção e passaram depois: a escolha da fonte deve recalcular
o hash dos bytes reais, sem confiar no campo sha256; a restauração deve validar a
estrutura e checksum do arquivo Redis antes de substituir arquivos locais.
O estado de restauração agora fica em `restore-state-*.json`, com fase e caminho
do diretório substituído. Na terceira rodada, terminou em `verified`.

Validação final após essas correções: 722 testes de packages, 720 aprovados e dois
ignorados; 112 testes de backend, 111 aprovados e um ignorado; nenhuma falha.
Logs: `apps/tests/pokemon-hub/test-results/migration-final-packages.log` e
`migration-final-backend.log`. A execução real do replay e a auditoria da terceira
rodada também terminaram com código zero. `git diff --check` sem erros.

Limites explícitos:

- A troca de arquivos e a restauração de milhares de chaves Redis não formam uma
  transação entre sistemas. Uma interrupção pode deixar dev parcialmente restaurado;
  manter escritores fechados, consultar o estado salvo e repetir a restauração da
  base. A cópia original e o diretório substituído permanecem disponíveis.
- O Save Emerald do perfil `a75d299b-6a3c-4b14-89ed-22bda22373b4` já estava não
  inicializado. Foi preservado byte a byte, sem criar uma fonte canônica fictícia.
- Os 34 conflitos históricos desta base foram resolvidos por correspondência
  única aos bytes nativos. Isso não autoriza escolher automaticamente uma cópia em
  outra base com ambiguidade; nesses casos o ensaio bloqueia para análise conjunta.
- Este resultado verifica migração e conservação dos dados reais copiados. A sessão
  interativa com esses dados fica disponível para os testes do usuário. As campanhas
  E2E da implementação estão registradas na seção 24; não foram reapresentadas como
  testes executados sobre esta cópia real.
- Produção foi somente lida. Não houve build, commit, deploy, alteração de progressão
  Emerald da spec 085 nem mudança de arquitetura/infraestrutura nesta etapa. Um
  eventual corte em produção continua dependendo de solicitação específica.
