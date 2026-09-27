# Spec 042 — Controlador de macros de entrada

Status: contrato implementado nesta branch; Hold zero atualizado para sobreposição de botões. A seção "Levantamento da implementação atual" preserva o diagnóstico anterior ao redesenho.

## Objetivo

O usuário cria uma lista linear de eventos para os emuladores abertos: Botão, Delay e Repeat. O player executa um item por vez, na ordem da lista. Hold com duração zero mantém seu botão pressionado enquanto os itens seguintes são executados, permitindo que vários botões da macro fiquem pressionados juntos. A macro é opcional e não altera as verificações de ROM, perfil, lease ou save.

## Eventos e padrões

| Item | Configuração editável | Padrão | Comportamento |
| --- | --- | --- | --- |
| Botão — Press | Botão, quantidade de pressões e delay posterior | A, 1 pressão, 800 ms posteriores | Para cada pressão, envia down e up. Entre uma pressão e a seguinte da mesma ação, espera 800 ms fixos após o up. Quantidade zero pulsa o mesmo botão indefinidamente, sem voltar ao início da lista. Em quantidade positiva, depois do último up espera o delay posterior antes do próximo item. |
| Botão — Hold | Botão, tempo segurado e delay posterior | A, 2000 ms segurado, 800 ms posteriores | Com duração positiva, envia down, mantém pelo tempo configurado e envia up antes do delay posterior. Com duração zero, envia down e mantém o botão pressionado até a conclusão ou cancelamento da macro; o delay posterior ainda precede o próximo item. |
| Delay | Tempo em milissegundos | 1200 ms | Não envia botão. Apenas espera o tempo configurado e passa ao próximo item. |
| Repeat | Quantidade de passagens; 0 significa infinito | 1 passagem | Controla o cursor da lista. Volta à primeira linha até completar sua própria contagem; depois zera seu contador e segue abaixo dele. Não envia botão e não acrescenta delay. |

O pulso de uma pressão de Press dura 60 ms por padrão interno do executor, sem controle adicional na interface. Os 800 ms entre pressões de um mesmo Press são fixos e não editáveis. São distintos do delay posterior do botão, que é editável e começa depois do último up de Press finito ou Hold positivo, ou depois do down de Hold zero. Press com count 0 não termina por conta própria; seu delay posterior não se aplica e o editor oculta esse campo enquanto count for zero. Por exemplo, Press A com count 3 e delay posterior de 1200 ms faz down/up, espera 800 ms, down/up, espera 800 ms, down/up, espera 1200 ms e só então inicia o item seguinte.

O Delay é um item separado. Assim, Press A, Repeat 10, Delay 1200 permite dez passagens por A e espera 1200 ms somente depois da décima. Para isso, o delay posterior do botão A deve estar configurado como 0; caso contrário, ele será aplicado em cada passagem pelo botão, como em qualquer outra volta ao início.

## Semântica de Repeat

A execução mantém um cursor na lista e um contador independente para cada Repeat, começando em zero. Ao chegar a um Repeat com valor positivo N, ele conta a passagem atual. Se ainda não chegou a N, volta à primeira linha. Quando chega a N, zera seu próprio contador e continua no item abaixo dele. Repeat 1 apenas permite seguir: a primeira passagem já ocorreu.

Quando um Repeat posterior volta à primeira linha, percorre todos os itens anteriores em ordem, inclusive os Repeat anteriores. Como eles zeraram seus próprios contadores quando terminaram, executam sua quantidade inteira novamente. Exemplo curto: Press A, Repeat 2, Press B, Repeat 2 produz A, A, B, A, A, B. No exemplo Press A, Press A, Repeat 10, Press B, Press B, Repeat 5, cada nova passagem provocada pelo segundo Repeat executa novamente o primeiro Repeat 10 desde seu contador zero.

Repeat 0 sempre volta à primeira linha e só termina quando a execução é parada ou cancelada. O usuário pode adicionar itens abaixo dele; eles permanecem salvos e editáveis, mas não serão alcançados naquela execução enquanto esse Repeat 0 estiver ativo. Isso não é erro de validação nem aviso bloqueante. A posição do Repeat não é restringida por regras sobre utilidade do fluxo; mesmo uma lista que só repete sem produzir inputs deve continuar cancelável e não pode travar a interface.

## Modelo de dados e pacote compartilhado

O contrato versionado pertence a apps/packages/. O frontend edita os itens, o player executa a lista e o backend persiste e valida o documento. A antiga descrição “frontend-only” deixa de valer.

Macro versão 2:

- schemaVersion: 2; id; name; items; createdAt; updatedAt.
- ButtonItem: id; kind = button; input = up, down, left, right, a, b, l ou r; action = press ou hold; delayAfterMs.
- ButtonItem com action = press: count, inteiro não negativo; zero significa pressões ilimitadas no mesmo item até Parar ou cancelar a execução. O executor usa 60 ms de down por pressão e 800 ms fixos entre uma pressão e a próxima da mesma ação.
- ButtonItem com action = hold: holdMs, inteiro não negativo; zero significa manter pressionado até a conclusão ou cancelamento da macro. O campo count não existe nesse caso.
- DelayItem: id; kind = delay; durationMs, inteiro não negativo.
- RepeatItem: id; kind = repeat; count, inteiro não negativo; 0 significa infinito.

Campos que não pertencem à variante do item não são usados nem persistidos. Trocar Press por Hold cria holdMs = 2000 e remove count; trocar Hold por Press cria count = 1 e remove holdMs. O delay posterior do mesmo botão permanece configurado na troca. Adicionar Botão cria Press A com count 1 e delayAfterMs 800. Adicionar Delay cria durationMs 1200. Adicionar Repeat cria count 1.

A validação aceita apenas objetos no formato esperado, nome não vazio de até 50 caracteres, lista não vazia de até 100 itens, IDs de itens não vazios e únicos, entradas suportadas e números inteiros seguros e finitos. Um documento persistido exige id da macro não vazio; no POST de criação, o id da macro pode faltar e é gerado pelo store antes da validação do documento persistido. Press, Hold, Delay, delayAfterMs e Repeat aceitam zero. Durações configuráveis de Hold e Delay e delayAfterMs vão até 600000 ms. Contagens não dependem de um limite de expansão da lista; o executor é progressivo. Payload inválido retorna erro estruturado, sem TypeError. Press 0 e Repeat 0 com itens abaixo continuam válidos.

Os helpers de criar, editar, remover e reordenar itens retornam novos objetos. Reordenação preserva os itens e a ordem escolhida pelo usuário. Não reaproveitar milissegundos como contagem ou vice-versa.

## Execução e tempo

O runner do player executa a lista progressivamente com cursor, contadores e, no máximo, o timer do evento corrente. Ele não constrói uma timeline completa nem agenda previamente todas as pressões: Press 0, Repeat 0 e Repeat encadeados podem produzir uma execução ilimitada ou muito longa. Mesmo um ciclo sem esperas ou botões deve ceder controle ao navegador para que Parar continue funcionando. Press e Hold positivo têm down/up explícitos. Hold zero envia down e segue após o delay posterior sem enviar up; o botão continua pressionado durante Delay, Press, Hold e Repeat seguintes, inclusive entre voltas. Vários Hold zero de botões diferentes se acumulam. Repetir Hold zero de um botão já mantido não duplica o down. Press ou Hold positivo do mesmo botão já mantido não solta o Hold zero e não produz uma nova borda de down/up; apenas cumpre seus tempos. Todos os botões mantidos pela macro são soltos na conclusão, parada ou falha. Hold positivo é solto antes do delay posterior quando não há Hold zero do mesmo botão ativo. Em Press, o intervalo fixo de 800 ms ocorre só entre pressões; o delay posterior começa depois da última em Press finito. Press 0 repete apenas o próprio botão, mantém Holds anteriores ativos, não revisita os delays de preparação e não alcança itens posteriores enquanto estiver ativo. Delay começa após o item anterior, inclusive seu delay posterior.

Se um timer do navegador atrasar, os próximos tempos contam a partir da conclusão real do evento atual. Não emitir ações atrasadas em rajada. O intervalo fixo entre pressões garante que o core observe a soltura quando o botão não está mantido por Hold zero. As ações temporárias seguem uma por vez; botões mantidos por Hold zero podem se sobrepor às ações seguintes.

Parar, nova execução, perda da lease, fechamento ou recarga do player, reset manual e início da caça shiny cancelam a macro, impedem eventos futuros e soltam as entradas pertencentes à macro. Fechar apenas o modal não cancela nem pausa a execução. A soltura da macro não pode desligar o mesmo botão mantido por controle físico. IDs de execução impedem que timers e respostas antigas mudem a execução nova. Ao terminar uma macro finita, o player limpa o estado e avisa o hub; Press 0 e Repeat 0 continuam ativos até cancelamento.

A mesma macro é enviada aos player frames abertos, preservando o alcance atual desta branch. O hub congela o conjunto de sessões no Start. Todos confirmam preparo sem emitir inputs; só depois o hub autoriza o início. Se algum player recusar ou falhar, o hub cancela os demais e apresenta o erro. Mensagens de preparo, início, parada, aceite, conclusão e falha carregam runId e sessionId e validam origin/source. O hub não mostra “rodando” apenas porque enviou postMessage.

## Interface

O botão Macros permanece no header do player e abre um modal no tema verde escuro. Ele tem estado visual inativo/ativo, como os controles existentes de Fast Forward e Odds Manipulator: a partir do envio dos comandos de início, sua cor/realce indica atividade mesmo com o modal fechado e permanece assim até a parada confirmada. Clicar no botão Macros apenas abre o modal; não inicia, para nem alterna a execução. Seu nome acessível e título indicam o estado ativo; aria-expanded descreve o modal aberto. Não apresentá-lo semanticamente como botão de alternância, pois seu clique não controla a execução.

1. Sem macro em execução, abrir o modal mostra primeiro a lista de macros salvas e Criar novo. Selecionar uma macro abre seu editor preenchido; Criar novo abre o mesmo editor vazio. Se o modal foi fechado durante uma execução, reabri-lo mostra o editor da macro salva e em curso, com Parar disponível.
2. O editor mostra nome e a pilha de itens já editáveis. Não há botão genérico Adicionar nem selector para escolher o tipo de novo item. Abaixo da pilha há um wrapper com três botões quadrados, apenas com ícones: controller para adicionar Botão, relógio para adicionar Delay e refresh para adicionar Repeat. Um clique acrescenta diretamente o item correspondente ao fim da pilha com seus valores padrão. O botão controller reutiliza o SVG do controle “Configurar controles” no header do emulador, em apps/frontend/src/main.jsx, em vez de criar outro desenho. Os três botões têm nome acessível e título ao passar o mouse, embora não exibam texto.
3. Cada linha da pilha mostra seus campos editáveis, um controle de arraste para mudar a posição e um botão com ícone de excluir. Arrastar e soltar move a linha para a posição indicada, sem alterar os demais valores. A mesma reordenação funciona por teclado. Excluir remove imediatamente o item do rascunho. A linha Botão permite escolher o input e Press ou Hold e mostra count ou holdMs, respectivamente, além do delay posterior quando aplicável. Os campos Press e Hold aceitam zero e explicam suas diferentes semânticas; com Press 0, o delay posterior fica oculto porque o item não termina. A linha Delay mostra somente milissegundos. A linha Repeat mostra somente a contagem, incluindo 0. Campos têm rótulos e unidades visíveis.
4. Salvar valida e persiste, mantendo o editor aberto. Iniciar valida o conteúdo visível, salva a macro nova ou suas alterações por POST, executa um snapshot imutável do documento retornado pelo backend e fecha o modal após a confirmação de início dos players. Falha no POST impede o início e mantém o editor aberto com o rascunho e o erro; falha no início mantém o editor aberto com a versão já salva e o erro. Depois que os players confirmam o início, o botão muda de texto e cor de Iniciar para Parar. Parar solicita cancelamento; após confirmação, volta ao estado Iniciar. Esses estados vêm da execução confirmada, não apenas do clique. Enquanto salva, prepara ou encerra, o botão não aceita cliques repetidos.
5. Fechar ou X apenas ocultam o modal. A macro continua rodando e o botão Macros do header continua realçado. O rascunho da execução em curso permanece disponível ao reabrir; mudanças feitas no editor depois do Start não alteram o snapshot em execução até um novo Start. Conclusão finita, parada e falha atualizam tanto o botão do editor quanto o indicador do header. Erros de valor aparecem junto ao item. Itens após Press 0 ou Repeat 0 continuam editáveis e não impedem salvar ou iniciar.

Não criar página de detalhes, elementos decorativos ou controles extras.

## Persistência e compatibilidade

As rotas GET/POST/DELETE de /api/macros e os stores JSON/Redis continuam. POST valida por meio do pacote compartilhado; payload inválido retorna 400; DELETE de id ausente retorna 404. Na criação, o store gera id e timestamps ausentes; ao atualizar pelo mesmo id, preserva createdAt existente e define updatedAt no servidor. A resposta POST contém o documento salvo, que substitui o rascunho base do editor. Iniciar faz esse POST antes de preparar os players e usa sua resposta como snapshot da execução.

Macros da versão anterior não podem desaparecer nem fazer a lista inteira falhar. Press antigo sem duração vira Button Press count 1; Hold finito vira Button Hold; Repeat antigo de botão vira Button Press com o count anterior. O valor antigo de delay é preservado numericamente como delayAfterMs: a aplicação passa a esperar após a soltura do botão finito, como definido nesta versão. O ritmo antigo de Repeat era de 120 ms entre inícios de pressão, diferente dos 800 ms fixos da versão nova. Por isso toda macro migrada informa no editor que sua temporização mudou, antes de Iniciar ou Salvar. Press/Hold antigo com duration 0 exige revisão explícita pelo usuário; ele pode escolher Hold zero na versão nova para manter o botão pressionado. A leitura não grava a migração até o usuário salvar.

## Levantamento da implementação atual

| Arquivo | O que existe nesta branch | Mudança exigida por esta spec |
| --- | --- | --- |
| apps/packages/input-macro-simulator.mjs | Macro com steps; press, hold e repeat são ações do mesmo botão; delay desloca o início do próximo passo a partir do início do atual; buildMacroTimeline cria todos os eventos antecipadamente; validação aceita alguns números fracionários e pode lançar para tipos inválidos. | Substituir por items versionados e variantes Button/Delay/Repeat; separar valores padrão; validar sem exceção para payload inválido; criar executor progressivo ou núcleo de transição de estado que possa testar cursor, contadores e tempos sem expandir a sequência. |
| apps/packages/input-macro-simulator-ui.jsx | Editor lazy com botão genérico Add step, Select de input/ação, InputNumber, remoção e drag nativo na linha inteira; Save é callback; não há Start/Stop no editor. | Três botões de ícone no rodapé; variantes de linha e campos corretos; arraste iniciado pelo handle, com teclado e touch; callbacks de Salvar e Iniciar/Parar e estado vindo do hub. |
| apps/frontend/src/main.jsx | Mantém modal, lista, draft e runningMacroId; abrir ou fechar apaga o draft; fechar envia stop; lista executa por nome; editor só salva; run/stop fazem broadcast por postMessage e alteram runningMacroId sem resposta; botão do header não mostra atividade. | Manter draft e snapshot em execução separados; seleção da lista abre editor; fechamento só oculta; coordenar preparo/início/parada/confirmações de todos os players; receber término assíncrono; iluminar botão do header enquanto confirmado ativo; reabrir editor ativo com Parar. |
| apps/frontend/src/player.js | Recebe macro-run com steps e macro-stop; agenda todos os setTimeout da timeline; não responde aceite ou término; usa simulateInput diretamente; não checa runtimeReady nem cancela macro em reset/close normal. | Usar executor progressivo; aceitar itens versionados e runId; responder preparo/início/parada e término; usar entrada sintética com propriedade por fonte; cancelar em reset, lock, fechamento, caça e lease perdida. |
| apps/packages/gamepad-input.mjs | Combina entrada física com um Set sintético; já tem setSyntheticPressed usado pela caça shiny. | Permitir que macro e outras fontes sintéticas possuam o mesmo botão sem uma fonte soltar a outra; preservar a entrada física. Macro não chama simulateInput diretamente. |
| apps/packages/player-frame-request.mjs | Requisição com requestId e sessionId, verificação de origin e event.source e timeout. | Reutilizar nas fases de preparo, início e parada; término espontâneo usa listener autenticado no hub. |
| apps/packages/input-macro-store.mjs e apps/backend/server.mjs | Stores JSON e Redis validam todas as entradas como versão antiga; GET/POST/DELETE já existem. Um registro incompatível pode fazer a leitura da coleção inteira falhar. | Leitura mista de versões 1 e 2, migração de visualização sem gravar, save sempre em versão 2, erros 400 para payload inválido e preservação dos demais registros. |
| apps/packages/hub-client.js | listMacros, saveMacro e deleteMacro já usam as rotas existentes. | Manter os caminhos HTTP e retornar formatos e erros definidos para as duas versões; não criar rota de execução no backend. |
| apps/frontend/src/styles.css | Modal macro de 760 px, linhas sem quebra e estilos antigos do botão de adicionar; header já tem is-active e o SVG do controller. | Aplicar os estilos existentes de atividade ao header, criar estados Iniciar/Parar e wrapper de três botões quadrados, ajustar linhas e arraste para largura estreita sem esconder campos. |

O backend atual usa por padrão o store Redis com a chave input-macros; o store de arquivo JSON também precisa manter o mesmo contrato para testes e instalações que o usam. O controle de entrada atual é GBA: up=4, down=5, left=6, right=7, a=8, b=0, l=10, r=11. Os oito IDs estão no perfil de controle padrão. O mapeamento lógico deve ficar em apps/packages/ e ser reutilizado pelo player, sem criar desvios por título de ROM.

## Contrato entre hub e player

A execução pertence à sessão do hub e não é persistida no backend. Um recarregamento da página cria outra sessão e não retoma macros. Só pode haver uma macro ativa por conjunto de players abertos. Ao clicar Iniciar, o hub captura os sessionId participantes, salva o rascunho e usa os items retornados pelo backend como snapshot imutável da execução; mudanças posteriores no editor ou na lista de players não entram nessa execução. runId é novo a cada tentativa, mesmo que a mesma macro seja iniciada outra vez. macroId serve para o editor e armazenamento, não para identificar uma execução.

Depois do salvamento, o hub usa requestPlayerFrame em paralelo para cada iframe participante. As mensagens são:

| Direção | Tipo | Campos e efeito |
| --- | --- | --- |
| Hub → player | emulator-hub:macro-prepare | requestId, sessionId, runId, macro versionada. Valida dados e condições locais e guarda o snapshot sem emitir input. |
| Player → hub | emulator-hub:macro-prepared | requestId, sessionId, runId, ok e erro opcional. |
| Hub → player | emulator-hub:macro-start | requestId, sessionId e runId. Só aceita a preparação correspondente e inicia o executor. |
| Player → hub | emulator-hub:macro-started | requestId, sessionId, runId, ok e erro opcional. |
| Hub → player | emulator-hub:macro-stop | requestId, sessionId e runId. Cancela a preparação ou execução correspondente; é idempotente. |
| Player → hub | emulator-hub:macro-stopped | requestId, sessionId, runId e ok. Confirma que os inputs da macro foram soltos. |
| Player → hub | emulator-hub:macro-ended | sessionId, runId, outcome = completed, stopped ou failed; erro opcional. Evento terminal assíncrono. |

O player responde a prepare somente se runtimeReady, gameManager e o adaptador de input estiverem disponíveis, com lease válida, sem fechamento, lock de interação ou caça shiny ativa. Uma preparação não iniciada expira localmente após 10 segundos. O hub só envia start após todos os participantes confirmarem prepare. As três requisições usam timeoutMs de 5000 no helper existente. Falha ou timeout em qualquer fase solicita stop aos participantes já preparados ou iniciados e apresenta o erro no editor. A confirmação de start de todos coloca o hub em running; a de stop de todos ou a conclusão de todos o tira de running. Se um player terminar uma macro curta antes de chegar a confirmação de start de outro, o hub conserva esse término e não volta incorretamente para running.

O hub valida origem, janela do iframe, sessionId e runId dos eventos espontâneos, além de ignorar resposta de requisição antiga. Cada resposta do player ecoa requestId e sessionId. Perda, substituição ou recarga de um participante cancela o mesmo runId nos sobreviventes; um iframe aberto depois não recebe a macro em curso. Preparação e parada não podem alterar ROM, perfil, lease ou save. Falha da macro informa o usuário e não interrompe o fluxo principal do jogo.

Os encaixes de ciclo de vida são concretos: dispatchReset no hub e os handlers de reset no player param a macro antes de resetar; closeSessions/closeEmulator param antes do flush final do save; o começo da caça shiny espera a parada da macro antes de enviar input da caça; interaction-lock que bloqueia um participante encerra o run de todos; o listener de lease-lost, o onLoad de iframe participante e a mudança em activeSessions reconciliam o estado do hub. Carregar state manualmente também para a macro antes da restauração; salvar state sem carregar não precisa pará-la. Não adicionar um lock de macro ao fechamento do modal, pois esse fechamento serve para observar o jogo.

## Estado de execução e interação

O hub distingue idle, preparing, starting, running, stopping e failed; completed é um resultado terminal antes de voltar a idle. Starting começa depois de todos confirmarem prepare e dura até todas as respostas de start. O botão do editor mostra Iniciar em idle, Parar em running, e texto transitório enquanto prepara, inicia ou para. O header tem classe is-active a partir de starting, enquanto a execução está confirmada como running ou ainda não há confirmação de que parou; seu título/nome acessível informa o estado. Clicar nele só abre o modal. Fechar/X altera apenas macroModalOpen. O hub retém runId, macro snapshot e documento salvo no editor enquanto a execução existir. Ao reabrir o modal durante o run, apresenta esse editor com Parar. Depois do término, pode voltar à lista na próxima abertura sem perder as macros persistidas. Se Parar não receber confirmação, mantém indicação de execução possivelmente ativa, mostra “parada não confirmada” e permite tentar Parar novamente; não declara a macro parada apenas por timeout.

A lista salva não inicia macros diretamente: selecionar abre o editor. Salvar usa POST /api/macros e permanece no editor com o documento retornado pelo backend; uma falha mantém o rascunho e mostra o erro. Iniciar também usa POST /api/macros antes de preparar os players e fecha o modal apenas depois da confirmação do início. Enquanto o POST está pendente, os campos do rascunho e Salvar/Iniciar ficam desabilitados para que a resposta não sobrescreva uma edição posterior. Não é permitido iniciar sem player aberto ou enquanto a caça shiny está ativa; nessas condições não se faz POST. Um novo Start após parada salva o conteúdo atual do editor e usa outro runId.

O modal atual usa profile-overlay com aria-modal e impede interação com o jogo enquanto aberto; ocultá-lo permite observar a macro, sem cancelá-la. A linha de item não deve ser draggable inteira, pois isso disputa gestos com Select e InputNumber. O handle é a área de arraste; o projeto já tem @dnd-kit/react e @dnd-kit/dom para interações com ponteiro e touch. O handle também aceita foco e reordenação por teclado, com indicação da nova posição. O editor mantém os campos e os três botões de inserção visíveis em telas estreitas; o SVG de controller é o mesmo usado em Configurar controles no header, inclusive quando esse botão do header fica oculto no layout móvel.

Para preservar o controle físico, o player envia os inputs da macro por um adaptador compartilhado com createEmulatorGamepadInput, com propriedade separada por fonte: físico, caça shiny e macro. O estado enviado ao core é a união das fontes; soltar a fonte macro não solta um botão que continue pressionado por outra. O mesmo vale ao cancelar durante Hold, Delay ou Repeat. A macro não usa diretamente gameManager.simulateInput fora desse adaptador. A entrada nativa de teclado do EmulatorJS exige que o player não inicie uma macro enquanto alguma tecla correspondente aos botões dela estiver pressionada. Durante a execução, bloqueia keydown e o respectivo keyup apenas das teclas correspondentes aos botões da macro; outras teclas seguem disponíveis. O keyup de uma pressão bloqueada continua bloqueado mesmo se a macro parar antes da soltura física, para não liberar o input sintético de outra fonte.

## Migração de dados existentes

O store precisa aceitar na mesma coleção registros válidos da versão antiga, identificados pela ausência de schemaVersion e pela lista steps, e registros da versão 2 com items. GET mantém cada registro acessível no seu formato armazenado; listMacros no frontend usa a função pura do pacote para apresentar v1 como rascunho editável v2, com aviso de migração. Salvar uma macro nova não regrava nem descarta as outras. Uma macro antiga só vira versão 2 no POST após revisão do usuário e clique em Salvar ou Iniciar. Preservar id e createdAt; updatedAt é atualizado pelo store ao salvar. DELETE continua funcionando para ambas as versões.

| Step antigo | Conversão para rascunho v2 |
| --- | --- |
| press sem duration | Button Press, count 1, pulso interno de 60 ms. |
| hold com duration positiva | Button Hold, holdMs = duration. |
| repeat com duration positiva | Button Press, count = duration; intervalo interno passa a ser 800 ms fixos. |
| press ou hold com duration 0 | Manter a linha visível como legada e inválida para execução; usuário precisa substituí-la explicitamente por Press ou Hold, inclusive Hold zero se quiser manter o botão pressionado. |

Para as três conversões válidas, o antigo delay numérico vira delayAfterMs com o mesmo valor. Isso muda sua posição temporal: antes ele era contado a partir do início do step; agora começa depois do último up. O conversor retorna rascunho mais avisos; um step infinito antigo permanece como linha temporária de revisão no editor e nunca é enviado automaticamente como item v2, pois a posição do delay mudou. Após revisão explícita, o usuário pode escolher Hold zero para manter o botão pressionado. O editor mostra uma mensagem curta de que o timing legado foi convertido, sem alterar silenciosamente o registro salvo. Payload novo malformado ou conversão incompleta devolve erro de validação específico; nunca deve resultar em resposta 200 com macro nula. Um registro legado que exige revisão não impede listar, editar ou excluir os outros.

## Verificações específicas da base atual

- Substituir os testes de texto por regex de input-macro-simulator-ui.test.mjs por verificações comportamentais dos três botões de inserção, edição dos campos, remoção, drag handle, teclado e estado Iniciar/Parar. A suíte usa node:test; não tratar uma busca no código-fonte como prova da interação.
- Atualizar input-macro-simulator.test.mjs para as três variantes, defaults 1/2000/800/1200/1, cursor e contadores de Repeat, Hold zero com sobreposição e soltura terminal, cancelamento, números fracionários/NaN e atraso de timer sem rajada.
- Atualizar input-macro-store.test.mjs e o teste de rota em apps/backend/test/server.test.mjs com leitura mista v1/v2, migração sob demanda, upsert v2, preservação de outros registros, 400 para corpo inválido e 404 no DELETE.
- Testar requestId, runId, origem, source, sessionId, timeout, término antes do último started, iframe recarregado, perda de lease, reset, caça shiny, close de player e stop com botão físico segurado.
- Conferir manualmente no navegador desktop e no layout móvel: modal fechado durante Repeat 0, realce no header, reabertura com Parar, editor legível, arraste por handle e scroll da pilha. Não usar build como prova de comportamento.

## Aceite

- Press A count 3 e delay posterior 1200 envia três pares down/up de 60 ms, com duas esperas internas fixas de 800 ms, e só depois espera 1200 ms antes do próximo item.
- Hold B de 2000 ms e delay posterior 800 mantém B pressionado por 2000 ms, solta e espera 800 ms antes do próximo item.
- Hold A de 0 ms, Hold B de 0 ms e Press L mantêm A e B pressionados durante L; Repeat mantém A e B entre as voltas; conclusão e Parar soltam todos os botões da macro.
- Hold B 0 com delay posterior 300, Hold Left 0 com delay posterior 200 e Press A count 0 pressionam B e Left uma vez e depois pulsam A indefinidamente; os dois delays de preparação não se repetem; Parar solta A, B e Left.
- Iniciar com macro nova ou editada persiste o documento antes do preparo dos players, executa exatamente o documento retornado pelo backend e fecha o modal após confirmação de início. Falha ao salvar não envia preparo; falha ao iniciar mantém o modal aberto com o documento já salvo e o erro.
- Delay 1200 não envia input e posterga o item seguinte por 1200 ms.
- A, Repeat 2, B, Repeat 2 produz A-A-B-A-A-B. Ao revisitar o primeiro Repeat, seu contador começa novamente em zero.
- Repeat 0 continua voltando ao início até cancelar; Press 0 continua pulsando somente seu botão até cancelar. Itens posteriores podem ser salvos, mas não são alcançados nessa execução.
- Conclusão finita, Parar, falha, reset, caça shiny e perda de lease liberam a contribuição da macro e corrigem o estado visual. Fechar o modal durante uma execução mantém a macro ativa; o header continua realçado, e reabrir o modal mostra Parar no editor da macro em curso.
- Testes comportamentais exercitam os três botões de ícone que acrescentam o tipo correto com valores padrão, o ícone de exclusão por linha, reordenação por drag and drop e teclado, seleção de macro salva, edição, salvamento, início, estados Iniciar/Parar, fechamento e reabertura durante a execução. Testes de pacote cobrem contadores encadeados, zero infinito, tempos, validação, migração legada, atraso de timers e cancelamento. Testes de integração cobrem backend e confirmação de player sem início parcial.

## Limite desta revisão

O código atual, incluindo buildMacroTimeline, editor e runner do player, ainda não implementa este contrato.
