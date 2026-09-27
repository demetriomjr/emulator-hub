# Spec 076 — Caça automática de shiny em encontros Gen III

Status: os três blocos, os novos roteiros, o modo **todos shiny** e o modal estão implementados no frontend e em `apps/packages/`. O teste prático confirmou o reset inicial e revelou interrupções ao mudar de aba e esperas entre players; esta revisão torna os ciclos independentes após o reset inicial. Falta o novo ensaio manual no navegador. Rayquaza motivou o caso, mas a espécie alvo vem da leitura do adversário, sem regra exclusiva para Rayquaza.

## Objetivo e escopo

O usuário posiciona cada personagem para o método de encontro escolhido, abre de 1 a 9 players e abre a configuração de **Caça shiny** pelo botão ao lado de **Informações do perfil**. No modal, escolhe os três blocos e clica em **Iniciar**. Um agendador no Hub conduz todos os players abertos. A configuração descreve **como preparar uma nova tentativa**, **como iniciar o encontro** e **quando encerrar**. O roteiro atual é soft reset, quatro A para atravessar boot/menu e um A para interagir com o Pokémon parado. O novo tipo **sair do encounter** foge após um resultado não shiny e tenta iniciar outro encontro pelo método escolhido.

O botão do header **abre o modal** e mostra a **soma das tentativas iniciadas por todos os players nesta execução**, começando em 0 a cada início. Ele não inicia nem para a caça. O primeiro reset confirmado em todos soma uma tentativa por player. Depois, cada reset ou sequência de fuga concluída soma uma tentativa apenas para o respectivo player. O número continua visível e atualizando no header mesmo com o modal fechado; após parada ou resultado, permanece até iniciar outra caça ou fechar o player. Não criar página nem controles de timing.

Ao iniciar, congelar os `sessionId` de todos os players abertos. Cada player precisa estar pronto, com ROM Gen III suportada e verificada, perfil/lease válidos e save posicionado pelo usuário para o método escolhido: diante do Pokémon para **Interação com A**, ou num local onde o movimento escolhido possa iniciar o encontro. Se algum player não for compatível, explicar o motivo e não iniciar parcialmente. Não adicionar seletor de Pokémon.

## Configuração em três blocos

| Bloco | Opção definida agora | Responsabilidade |
| --- | --- | --- |
| **1. Tipo de reset** | **Soft reset** ou **Sair do encounter**. | Preparar a próxima tentativa pelo reset do jogo ou pela fuga da batalha atual. |
| **2. Iniciar encounter** | **Interação com A**, **Andar para a direita**, **Andar para a esquerda**, **Andar para cima** ou **Encounter comum**. | Executar a entrada escolhida e comprovar um novo encontro. No roteiro atual, o A de interação era o quinto A total; ele não pertence ao bloco de reset. |
| **3. Condição de parada** | **Apenas um shiny** ou **Todos shiny**. | Definir se o primeiro shiny encerra a execução inteira ou se cada player sai da caça quando encontra o seu próprio shiny. |

Esses blocos são o contrato da automação e devem permitir outros roteiros validados no futuro, sem criar uma rotina de caça por espécie. Esta revisão acrescenta **sair do encounter** ao bloco 1 e quatro métodos de movimento ao bloco 2; não cria controles de timing. Players com roteiros incompatíveis não participam da mesma execução global.

No modal, escolher uma opção em cada um dos três blocos antes de iniciar. **Tipo de reset** e **Condição de parada** usam dois grupos de botões de rádio, lado a lado quando houver largura. **Iniciar encounter** também usa um grupo de botões de rádio; suas cinco opções quebram linha dentro da largura atual do modal. Os padrões são **Soft reset**, **Interação com A** e **Apenas um shiny**. As escolhas não mudam no meio da execução.

## Modal, botão do header e estado

- Clicar no botão **Caça shiny** do header abre o modal, com a configuração em três blocos. O clique no header **nunca** chama iniciar/parar. O número de tentativas continua no próprio botão do header, como hoje.
- O botão de ação **dentro do modal** mostra **Iniciar** quando não há caça em andamento. Clicar nele inicia uma única execução com as opções escolhidas e zera o contador da execução. Enquanto a execução está ativa, o mesmo botão mostra **Parar**; clicar nele solicita a parada da caça. Não iniciar duas execuções em paralelo.
- O aspecto **ligado/desligado** do botão no header reflete exclusivamente se a caça está em andamento, inclusive durante preparo, busca, leitura, fuga e salvamento. Ele não reflete se o modal está aberto. Após parada manual, resultado final ou erro, o aspecto volta a desligado e o botão do modal volta a **Iniciar**.
- Fechar o modal pelo controle **Fechar** fecha somente a interface: não pausa, não para, não recria a execução, não zera o contador nem muda as opções usadas pelo controlador. Clicar no header novamente reabre o mesmo modal com estado, seleção e resultado atuais. A contagem continua atualizando no header enquanto o modal está fechado.
- Durante a caça, os três blocos ficam sem edição; ao parar ou terminar, podem ser alterados antes de um novo início. O estado de execução pertence ao controlador/Hub, separado do estado de visibilidade do modal. Abrir/fechar o modal não envia mensagens de reset, input ou cancelamento aos iframes e não bloqueia os inputs sintéticos da caça.
- O botão do header comunica a abertura do modal (`aria-haspopup="dialog"` e `aria-expanded`) e descreve se a caça está em andamento; **modal aberto** e **caça ligada** são estados distintos. Não apresentá-lo semanticamente como um botão que alterna a caça, pois seu clique apenas abre o modal. Fechar o player continua encerrando a caça, conforme o fluxo existente.
- Clicar em controles da página ou mudar de aba não cancela a caça. A checagem de revisão do frontend não recarrega a página enquanto ela está ativa. Se timers da aba forem atrasados, o próximo A respeita a distância mínima de 1.000 ms do A anterior, sem rajada para compensar o atraso.

Nos dois tipos de reset, a caça liga o **Odds Manipulator** caso esteja desligado, confirma o relógio em todos os players, ativa o Fast Forward e ajusta para **5×** caso necessário. Essas condições ficam protegidas contra alteração durante a execução.

### 1. Tipo de reset: soft reset no encontro com reset

Depois do preparo, solicitar o primeiro soft reset imediatamente, independentemente do tipo de reset selecionado. Cada tentativa posterior neste modo reinicia **somente os players ainda ativos**.

O primeiro reset deve ser confirmado como **executado** em todos os cores ativos; enviar postMessage não basta. Somente então o contador visível avança uma vez **por player**. Após a última confirmação inicial, esperar pelo menos **2.000 ms reais** para o primeiro A de navegação em cada player. Nas tentativas seguintes do modo soft reset, cada player espera 2.000 ms após a confirmação do seu próprio reset; os demais não o seguram. Os outros três A de navegação começam com pelo menos **1.000 ms** desde o início do A anterior no mesmo player. Cada A tem down/up explícitos. A implementação atual usa 40 ms de pressão provisórios; atrasos do navegador não podem gerar pulsos em rajada.

O `oddsResetCount` persistido pertence a cada perfil e continua avançando apenas quando aquele player recebe o seu reset, conforme a spec 055. O contador do botão é global e transitório: soma as tentativas de cada player. Quando um player encontra shiny no modo **todos shiny**, seu `oddsResetCount` e sua parcela do contador param de avançar; os outros continuam.

### 1. Tipo de reset: sair do encounter

Este tipo se aplica quando fugir da batalha permite outro encontro no mesmo local, seja com o Pokémon estático ainda interagível, seja com um encontro comum por movimento. A primeira tentativa faz **soft reset em todos os players**, espera 2.000 ms e envia os **quatro A de navegação** da sequência original; somente então executa o bloco **Iniciar encounter**. Depois de confirmar adversário **não shiny** no ciclo atual, tenta sair da batalha em cada player ativo. Se a instância continuar em batalha, faz **soft reset obrigatório só nela** antes da próxima tentativa. Um shiny nunca recebe a sequência de fuga.

Roteiro pedido pelo usuário, com os intervalos medidos em tempo real:

1. Após a leitura válida de um adversário não shiny, esperar **1.300 ms** e pressionar **B quatro vezes**. Cada B fica pressionado por **200 ms**, é solto e tem **200 ms** de intervalo antes da próxima ação.
2. Pressionar **Baixo** por **200 ms**, soltar e esperar **200 ms**. Pressionar **Direita** por **200 ms**, soltar e esperar **200 ms**. Baixo e Direita nunca ficam pressionados juntos.
3. Pressionar **A** por **400 ms**, soltar e esperar **400 ms**. Pressionar **A** novamente por **400 ms** e soltar.
4. Esperar **800 ms** após soltar o último A e ler o state daquela instância. Se voltou ao mapa, executar novamente o bloco **Iniciar encounter**. Se ainda está em batalha, fazer soft reset naquele player, esperar 2.000 ms, enviar os quatro A de navegação e então iniciar o encounter.

O intervalo final é **800 milissegundos**, confirmado pelo usuário. Os intervalos distinguem duração da pressão e pausa entre comandos. O controlador executa os botões sem consultar fase ou cursor entre eles; depois da última espera, lê o estado de batalha antes de qualquer novo encontro. Cada player inicia sua próxima tentativa ao confirmar mapa ou concluir seu soft reset, sem esperar os demais.

**Como reconhecer o encontro:** a party adversária já decodificada comprova o resultado shiny/normal. A leitura do encontro exige `gMain.inBattle` nas três ROMs para não confundir registros residuais no mapa com um encontro novo. Após a fuga, Ruby/Sapphire distinguem batalha e mapa pelo mesmo sinal; Emerald usa a leitura de fase existente. Batalha persistente ou transição ainda não confirmada como mapa acionam o reset daquele player. A leitura pós-fuga é repetida até três vezes, com 500 ms entre tentativas, antes desse reset. State inválido persistente interrompe a caça em vez de autorizar nova tentativa. O ensaio com states reais no runtime cabe ao usuário.

Neste tipo, o primeiro soft reset avança o `oddsResetCount` de cada player uma vez. Uma fuga confirmada não o altera; um soft reset de recuperação avança o `oddsResetCount` apenas daquele player. O contador visível começa em 0, soma o número de players após o reset inicial confirmado por todos e sobe uma vez por player quando a fuga é confirmada ou o reset de recuperação é concluído. O Odds Manipulator continua ligado durante a caça.

### 2. Iniciar encounter: opções

**Interação com A:** enviar **um pulso de A** quando o personagem estiver diante do Pokémon. Após o reset inicial, isso ocorre aproximadamente **1.000 ms** após o quarto A de navegação e é o quinto A total da tentativa. Nas rodadas posteriores de **sair do encounter**, ocorre depois da sequência de fuga e dos 800 ms. O pulso usa provisoriamente 40 ms de pressão. Depois de A, aguardar provisoriamente 1.000 ms antes da primeira leitura; se ainda estiver `pending`, reler de forma limitada.

**Andar para a direita**, **Andar para a esquerda** e **Andar para cima:** cada opção pressiona a direção escolhida por **1.200 ms reais**, solta o botão e verifica se um encontro começou. É uma ação única por tentativa; se não houver encontro após a leitura limitada da transição, interromper e informar que o método não iniciou encontro, sem classificar como Pokémon normal nem repetir o movimento automaticamente. Não enviar A nessas três opções.

**Encounter comum:** buscar um encontro selvagem em grupos de **quatro movimentos**: Esquerda, Direita, Esquerda, Direita. Cada direção fica pressionada por **400 ms reais** e depois é solta; esperar **50 ms** antes de pressionar a direção seguinte, inclusive entre grupos. Ler o state após o quarto movimento de cada grupo. Antes de cada novo botão, o iframe ainda verifica se um encontro começou e bloqueia o movimento com `enemy-already-created` quando necessário; o controlador relê o adversário sem pressionar outro botão e trata o resultado normal ou shiny. Se a leitura estiver `pending`, aguarda a confirmação com o limite de leituras já definido. Se não começou, repetir outro grupo de quatro movimentos dentro da **mesma tentativa**, sem novo reset. Não impor um limite arbitrário de grupos: parada manual, erro de state ou perda de player continuam interrompendo a busca. Nenhum A é enviado nessa opção.

Cada direção tem down/up explícitos, sem manter duas direções pressionadas ao mesmo tempo. Depois de cada grupo de quatro movimentos do **encounter comum**, cada player com batalha confirmada deixa de receber movimentos enquanto os outros ainda procuram. A leitura do adversário dessa instância ocorre **imediatamente**, sem esperar que os demais encontrem batalha; um shiny confirmado interrompe a busca no modo **apenas um shiny** ou é salvo e retirado no modo **todos shiny**. O estado de batalha, além da party adversária fresca, deve comprovar que houve um **novo** encounter; um registro residual de batalha anterior não encerra a busca. Só depois dessa confirmação avaliar shiny/normal. Em **todos shiny**, players concluídos não participam dos movimentos nem das novas leituras.

### 3. Condição de parada

**Apenas um shiny:** se qualquer player ativo confirmar shiny no adversário, interromper os laços dos outros players, liberar suas entradas sintéticas, solicitar o salvamento do state de **todos os players participantes abertos**, aguardar os resultados e encerrar a execução. Os outros players podem estar em fases e números de tentativa diferentes.

**Todos shiny:** o conjunto de participantes é congelado ao iniciar; o conjunto de **ativos** começa igual a ele e diminui. Quando um player confirmar shiny, interromper imediatamente os comandos **daquele player**, salvar o state **somente dele**, aguardar a confirmação e marcá-lo como concluído. Nenhum player concluído recebe outro soft reset, A, leitura de encontro ou incremento de `oddsResetCount`. Cada player que retornou normal válido inicia sua próxima tentativa sem esperar os que ainda estão em `pending` ou procurando encounter. Encerrar quando **todos os participantes** estiverem concluídos.

Se um state de shiny falhar ao salvar, tentar novamente até três vezes, mantendo a instância congelada; somente falha persistente encerra a execução com erro, sem outro reset. Erro ou timeout de leitura é repetido até três vezes, com 500 ms entre tentativas, sem transformar `pending` em normal. Shinies já confirmados e salvos em outros players permanecem preservados.

### Recuperação durante a execução

- Se o adversário surgir entre uma leitura e o próximo botão de navegação ou movimento, o iframe rejeita o botão; o controlador lê novamente o encontro daquela instância e segue com o resultado encontrado. Nenhum botão posterior da mesma sequência é enviado à batalha.
- Se a validação anterior a um botão encontrar state temporariamente ilegível, ou um botão anterior ainda estiver marcado como pressionado, o iframe libera o botão preso; o controlador relê o encontro e só repete a ação rejeitada quando a leitura confirma `pending`. A repetição é limitada a três tentativas.
- Se uma resposta de botão não chegar, o controlador envia um comando específico para soltar o botão, aguarda a confirmação e relê o encontro antes de decidir. Se após as leituras limitadas ainda não houver encontro, um movimento de direção pode continuar; um A com down incerto não é repetido às cegas. Caso a situação continue indeterminada, a instância para sem resetar um possível shiny.
- Se a confirmação de soft reset se perder, consultar o `cycleId` confirmado pelo iframe por até dez leituras espaçadas em 500 ms. Não enviar outro reset para compensar uma resposta perdida; registrar o incremento do Odds Manipulator somente após confirmar o reset. Após o reset, a captura da linha de base da party inimiga também tenta novamente até três vezes se o state ainda não estiver disponível.
- A configuração do relógio do Odds Manipulator é idempotente e tenta novamente até três vezes, com 500 ms de pausa, antes de declarar o player indisponível. Essa recuperação acontece antes do reset e não altera a contagem por si só.
- O lote de resets iniciais espera a conclusão ou falha de todos os players antes de encerrar; isso evita que um reset atrasado continue depois de liberar a caça por falha de outro player. No modo **apenas um shiny**, todos os salvamentos também terminam ou falham antes de liberar os players.
- Após fuga confirmada no mapa, o começo do ciclo compara o state atual à linha de base anterior antes de substituí-la. Se um novo encontro já começou nessa janela, preserva a linha de base anterior e lê o adversário.
- O salvamento do shiny admite três tentativas com 500 ms entre elas. O iframe reaproveita um salvamento em andamento ou já concluído do mesmo `cycleId`, para que uma resposta atrasada não provoque duas capturas. Uma falha persistente mantém os players parados e gera um erro real; a caça nunca classifica falha de leitura como encontro normal.

O modo escolhido vale para a execução iniciada. Uma instância concluída permanece visível, com o encontro preservado; ela não participa mais do agendador. Fechar/adicionar um player durante a caça, inclusive um já concluído, encerra a execução por mudança na composição congelada. **Parar** no modal cancela timers e libera todos os botões sintéticos, sem reiniciar qualquer player; se já houver salvamento de shiny em andamento, aguardar seu resultado antes de concluir a parada.

## Mapa das opções

```text
CONFIGURAÇÃO DA CAÇA SHINY
│
├─ 1. TIPO DE RESET
│  ├─ Soft reset [padrão; já implementado]
│  │  Reseta os players ativos e envia 4 A para atravessar boot/menu.
│  │
│  └─ Sair do encounter
│     Faz o reset inicial e os 4 A de navegação em todos os players.
│     Após um encontro não shiny, foge da batalha e volta ao mapa.
│     Espera 1.300 ms → B × 4 (200 ms, pausa 200 ms) →
│     Baixo 200 ms → pausa 200 ms → Direita 200 ms → pausa 200 ms →
│     A 400 ms → pausa 400 ms → A 400 ms → pausa 800 ms → lê state.
│     Mapa: novo encounter. Ainda em batalha: soft reset só neste player.
│
├─ 2. INICIAR ENCOUNTER
│  ├─ Interação com A [padrão; já implementado]
│  │  Envia 1 A para interagir com o Pokémon à frente.
│  ├─ Andar para a direita
│  │  Segura Direita por 1.200 ms, solta e verifica o encounter.
│  ├─ Andar para a esquerda
│  │  Segura Esquerda por 1.200 ms, solta e verifica o encounter.
│  ├─ Andar para cima
│  │  Segura Cima por 1.200 ms, solta e verifica o encounter.
│  └─ Encounter comum [primeiro a testar]
│     Esquerda 400 ms → 50 ms → Direita 400 ms → 50 ms →
│     Esquerda 400 ms → 50 ms → Direita 400 ms → lê o state;
│     sem encounter, espera 50 ms e repete o grupo.
│
└─ 3. CONDIÇÃO DE PARADA
   ├─ Apenas um shiny [padrão]
   │  Ao achar o primeiro shiny, salva o state de todos e encerra.
   │
   └─ Todos shiny
      Salva o state só de cada instância que achou shiny e a retira da caça.
      As outras continuam até cada uma encontrar seu shiny.

AÇÃO DO MODAL: Iniciar quando desligado; Parar quando iniciado.
BOTÃO DO HEADER: abre/reabre o modal, indica ligado/desligado e mostra a contagem.
```

Em ambos os tipos de reset, a leitura verifica o Pokémon adversário de cada player ativo. Um encontro `pending` continua sendo lido **naquela instância**; um resultado normal válido permite preparar sua próxima tentativa sem aguardar o resultado dos outros players. Falha persistente após as recuperações limitadas, reset inicial não confirmado, perda de player ou parada manual interrompem a execução. No modo de fuga, após os comandos e intervalos definidos, o controlador lê o state: só confirma a fuga se a instância voltou ao mapa; caso contrário, faz soft reset nela.

## Identidade, leitura e segurança

Cada execução registra `huntId`, os `sessionId` participantes e, por **encontro tentado**, um `cycleId`, independentemente de ter havido soft reset. Cada requisição usa `requestId`; respostas antigas, duplicadas, de outra origem ou de outra janela são ignoradas. No modo **todos shiny**, cada participante tem estado individual `ativo`, `salvando` ou `concluído`, associado à tentativa em que o shiny foi confirmado. Essa identidade é usada para excluir o player concluído de todas as operações seguintes; estar com iframe aberto não significa continuar ativo.

Um resultado normal ou shiny exige encontro **criado neste ciclo**, fase de batalha confirmada, estrutura íntegra, espécie decodificada e fórmula shiny correta sobre PID/OTID Gen III. Antes de executar o método de **Iniciar encounter**, capturar a linha de base da party adversária; isso é indispensável no modo **sair do encounter**, pois o registro do inimigo pode continuar na memória após a fuga. Para **Encounter comum**, os grupos de quatro movimentos repetidos pertencem ao mesmo ciclo e usam a mesma linha de base até a batalha começar. O leitor distingue explicitamente a party do jogador da party adversária; um shiny já presente no save do jogador jamais satisfaz a condição de parada. A espécie adversária é decodificada do encontro, sem Rayquaza fixo no código. Dados residuais de outra batalha, state inválido ou leitura antecipada não autorizam nova tentativa. A leitura ocorre dentro do iframe; o Hub recebe apenas resultado resumido e identidade da sessão, nunca states completos.

O formato de `getState()` foi conferido no EmulatorJS 4.2.3 e a posição da party adversária em snapshot real de Emerald. O adaptador lê a party adversária em RAM e usa o registro inimigo como barreira antes de cada A: se ele já estiver preenchido neste ciclo, não envia outro A. Ainda faltam ensaios com Ruby/Sapphire e com todos os players abertos a 5× para confirmar endereços, tempo de pulso e espera nas três ROMs.

Entrada física A/R2/direções, resets e save/load manuais e mudanças de velocidade/controles não podem concorrer com o ciclo; bloquear a ação ou parar a caça antes de aplicá-la. Ao devolver o controle, um R2 ainda segurado não pode disparar reset: exigir soltura e nova pressão. Um reset aplicado só em parte dos ativos não autoriza input nem novo reset; o contador visível permanece no último valor global confirmado. Todos os botões da automação terminam soltos.

## Encaixe no sistema atual

| Parte | Estado atual | Mudança necessária para esta revisão |
| --- | --- | --- |
| `apps/frontend/src/main.jsx` | Botão do header abre o modal; `huntStatus` guarda execução, tentativas e players concluídos. | Validar no navegador a abertura e a contagem em tela cheia e com o modal fechado. |
| `apps/frontend/src/styles.css` | Modal dos três blocos e estado visual do botão implementados. | Conferir aparência no navegador normal e em tela cheia. |
| `apps/frontend/src/player.js` e `apps/packages/shiny-hunt-player.mjs` | Aceitam A e direções com down/up, novo ciclo sem reset e bloqueio de input após conclusão. | Validar a sequência em states reais, em especial ROM com patch. |
| `apps/packages/shiny-hunt-controller.mjs` e contratos em `apps/packages/` | Recebem os três blocos, conduzem busca/fuga e mantêm players ativos/concluídos. | Conferir a temporização e a fuga numa execução local com emulador. |
| `apps/packages/pokemon-gen3-encounter.mjs` | Lê party adversária e sinal de batalha nas três ROMs; a party residual fora de batalha permanece `pending`. | Conferir a leitura do encontro com states reais no ensaio manual. |

Toda regra de fluxo, estado e leitura reutilizável fica em `apps/packages/`; o frontend apresenta o modal e conecta os players. O modal pode ser renderizado junto ao player no modo normal e em tela cheia, seguindo o padrão de overlays já existente. A caça é opcional: ROM sem suporte continua abrindo e salvando normalmente. Falha da automação não enfraquece validação de ROM, perfil, lease ou save.

O estado mínimo da execução precisa identificar: configuração escolhida no início, participantes congelados, fase e `cycleId` de cada player, players ainda ativos, players concluídos, soma das tentativas e eventual resultado/erro. A visibilidade do modal fica separada desses dados; fechar/reabrir não recria o controlador nem muda a execução. O estado **ligado** do header deve vir da execução ativa, incluindo fases de movimento e fuga, sem depender de uma lista incompleta de nomes de fase.

## Levantamento para implementação — somente frontend

Não há endpoint, persistência ou regra nova em `apps/backend`. A interface fica em `apps/frontend`; o agendamento, as regras de parada, os botões sintéticos e a leitura de state reutilizável ficam em módulos de `apps/packages/` importados pelo frontend. O Electron consumirá o frontend compilado pelo fluxo já existente.

### Contrato da execução

A configuração que o modal entrega ao controlador é uma combinação de três valores: `resetMode = soft-reset | exit-encounter`, `startMode = interact-a | walk-right | walk-left | walk-up | common` e `stopMode = first-shiny | all-shiny`. O Hub mantém `huntModalOpen` e `huntConfig` fora do componente que desenha o modal, para não perder as escolhas ao fechá-lo; copia a configuração para a execução ao clicar **Iniciar**. O controlador publica `running`, fase, `attemptCount`, participantes, ativos, concluídos e resultado/erro. `attemptCount` soma as tentativas por player, aparece no header e continua separado do `oddsResetCount` persistido por perfil. O frontend não deve inferir `running` por uma lista fixa de nomes de fases: fases como `walking` e `exiting` precisam manter o header ligado.

Cada instância tem sua própria etapa e seu próprio `cycleId`: preparada, procurando encontro, encontro pendente, normal, salvando shiny, concluída, fugindo ou pronta para a próxima tentativa. O `cycleId` aumenta por tentativa mesmo em **Sair do encounter**, sem depender de soft reset ou do progresso de outro player. Mensagens para o iframe continuam identificadas por `huntId`, `cycleId`, `sessionId` e `requestId`; a entrada passa a indicar o botão `A`, `B`, `UP`, `DOWN`, `LEFT` ou `RIGHT` e down/up correspondente. No core GBA atual, os IDs sintéticos são A=8, B=0, Cima=4, Baixo=5, Esquerda=6 e Direita=7. O iframe valida identidade, ordem e botões da sequência, ignora resposta antiga e libera qualquer botão mantido quando há parada/erro. O comando de novo ciclo deve capturar a linha de base do inimigo também quando não houve reset.

O controlador confirma **o reset inicial de todos** antes de navegar; depois cria um laço assíncrono por player. Cada laço conduz seu reset ou fuga, quatro A de navegação quando houve reset, início do encontro, leituras e eventual salvamento. No **Encounter comum**, quem não entrou em batalha continua alternando esquerda/direita; quem entrou para de andar, é inspecionado e avança sem esperar os demais. No modo **Apenas um shiny**, o primeiro shiny confirmado interrompe as outras buscas, libera entradas e salva os states de todos. No modo **Todos shiny**, cada shiny é salvo só na própria instância, que sai do conjunto ativo; os outros continuam em seus próprios ritmos. Uma falha de leitura não pode virar `normal`.

### Relógio e intervalos

Todos os tempos abaixo são **milissegundos reais** contados com relógio monotônico no frontend, independentes do Fast Forward 5×. Cada pulso tem down/up explícitos e as esperas são canceláveis ao clicar **Parar**. Se a aba atrasar um timer, o laço continua ao voltar: não interrompe por atraso e não compensa com botões em rajada; os próximos A continuam espaçados por pelo menos 1.000 ms no mesmo player.

| Trecho | Intervalo a agendar | Ponto de partida |
| --- | --- | --- |
| Soft reset → primeiro A de navegação | 2.000 ms | Última confirmação do reset inicial de todos; nas rodadas seguintes, confirmação de reset do próprio player. |
| Três A seguintes de navegação | Pelo menos 1.000 ms entre os inícios no mesmo player | Quatro A de navegação no total, sem rajada após atraso da aba. |
| Iniciar por A após soft reset | +1.000 ms após o quarto A | Quinto A total da tentativa. |
| Pulso de A para navegação e interação | 40 ms pressionado, depois solto | Valor atual dos A fora da fuga. |
| Andar direita/esquerda/cima | 1.200 ms pressionado, depois solto | Método de início escolhido. |
| Encounter comum | Esquerda/Direita alternados, 400 ms pressionado por movimento, 50 ms entre eles; ler state após quatro movimentos | Repetir somente na instância sem batalha. |
| Primeira leitura após A de interação | 1.000 ms após soltar A | Espera atual antes de verificar o adversário. |
| Encontro iniciado, adversário ainda `pending` | Reler a cada 500 ms, até 20 leituras | Vale também para início por movimento; nunca tratar `pending` como normal. |
| Fuga: quatro B | 1.300 ms após a leitura válida do adversário normal; cada B pressionado 200 ms e solto por 200 ms antes da próxima ação | Substituem o A inicial. |
| Fuga: Baixo → Direita | Cada direção pressionada 200 ms e solta por 200 ms antes da próxima ação | Pulsos separados, nessa ordem. |
| Fuga: dois A | Cada A pressionado 400 ms; esperar 400 ms entre eles | Prosseguir após Baixo e Direita. |
| Verificação após fuga | 800 ms após soltar o segundo A | Ler state: mapa libera novo encontro; batalha/transição sem mapa exige reset só nesse player. |

Na busca comum, a leitura programada de presença de batalha ocorre após o quarto movimento; o iframe mantém a proteção antes de cada botão. Grupos sem encontro não consomem o limite de 20 leituras de um encontro já iniciado. Os 1.300, 200, 400 e 800 ms da fuga são o roteiro de tempo informado pelo usuário. Os timeouts atuais de requisição ao iframe precisam continuar distintos dos holds: configuração de relógio 2 s, comando comum 5 s, input 2 s, leitura 10 s e salvamento 30 s. Cada hold ocorre **entre** as confirmações down e up, sem deixar uma requisição pendente durante a espera.

### Etapas e primeiro teste local

1. Separar no controlador os quatro A de navegação e o método de início, preservando o roteiro atual com cinco A quando a interação escolhida usa A. Aplicar o reset inicial e a navegação a todos os players em ambos os tipos de reset. Adicionar configuração e estado `running`/participantes/ativos/concluídos. Cobrir os modos de parada em testes de pacote, inclusive dois shinies na mesma rodada e shiny enquanto outro player ainda procura encontro.
2. Generalizar a entrada sintética do iframe para A e direções; adicionar início de ciclo sem reset, detecção de encontro e linha de base nova. Cobrir botão preso, resposta atrasada, party do jogador shiny e registro inimigo residual. Conferir os sinais em states reais no ensaio manual.
3. Implementar as cinco opções de iniciar encontro e a fuga temporizada. Testar o agendamento com relógio controlado, inclusive 50/200/400/800/1.200 ms, repetição esquerda/direita, leitura pós-fuga, reset de recuperação e paradas.
4. Montar o modal no player com os três blocos e um único botão **Iniciar/Parar**; transformar o botão do header em abridor do modal, mantendo a contagem e o estado visual. Testar fechar/reabrir durante execução, tela cheia, resultado automático e configuração travada durante a caça.
5. Primeiro ensaio no navegador local: uma instância com save em área de encontro comum, selecionar **Sair do encounter + Encounter comum + Apenas um shiny**, iniciar no modal, fechá-lo e observar a contagem no header. Confirmar os grupos de quatro movimentos Esquerda/Direita, a leitura do adversário, a fuga após um não shiny e a repetição; reabrir o modal e parar por **Parar**. O caminho de shiny é validado antes com state controlado em teste, sem depender de encontrar um shiny por acaso. Depois repetir com múltiplas instâncias e **Todos shiny**.

## Verificações para considerar a expansão pronta

- Com a caça desligada, clicar no botão do header apenas abre o modal; **Iniciar** no modal começa a execução, zera o contador e liga o aspecto do botão do header. Fechar o modal e reabri-lo pelo header não interrompe a caça nem muda o contador ou as opções; o botão interno aparece como **Parar**.
- Durante a caça, clicar no botão do header não para nem reinicia. **Parar** dentro do modal encerra a execução e desliga o aspecto do header; o botão interno volta a **Iniciar**. Resultado final e erro também deixam o header desligado, inclusive quando o modal está fechado. Nova execução recomeça em 0.
- Configuração não muda durante a execução; fechar/reabrir o modal preserva a seleção em uso. O modal funciona no player normal e em tela cheia sem bloquear mensagens sintéticas de caça aos iframes.
- Com 1 a 9 players, todos os abertos entram na execução. Odds Manipulator e Fast Forward 5× são preparados antes da primeira tentativa; **em ambos os tipos**, o primeiro reset vem logo depois. O contador visível começa em 0 e soma uma tentativa por player cujo reset inicial foi confirmado. Depois, cada player incrementa sua própria parcela quando confirma novo reset ou quando a leitura comprova que a fuga terminou no mapa.
- Com **Soft reset + Interação com A**, há quatro A de navegação: o primeiro pelo menos 2.000 ms após o último reset confirmado, os demais espaçados em cerca de 1.000 ms. Um quinto A, separado como interação, inicia o encontro. Não há sexto A nem ataque.
- Cada opção **Andar para a direita/esquerda/cima** segura somente a direção escolhida por 1.200 ms, solta e verifica o encontro. Se não ocorrer, não repete automaticamente nem classifica o resultado como normal.
- **Encounter comum** alterna Esquerda/Direita quatro vezes, com cada direção pressionada por 400 ms e pausa de 50 ms entre movimentos. Lê o state após o quarto movimento e repete grupos de quatro somente nos players ainda sem encontro. Se o encontro aparecer antes do próximo botão, esse botão é bloqueado e o controlador lê o Pokémon que já apareceu: normal continua a caça, shiny é salvo. Não conta cada grupo como nova tentativa nem envia movimento a quem já entrou em batalha.
- Em **sair do encounter**, a primeira tentativa faz soft reset de todos, quatro A de navegação e depois usa o método de iniciar escolhido. Após um resultado normal válido, espera 1.300 ms e envia B quatro vezes, Baixo, Direita e dois A, com os tempos de pressão e pausa acima. Só após os 800 ms finais lê o state. Se ainda houver batalha, reseta somente aquela instância antes de outro encontro; `oddsResetCount` avança nesse reset, não nas fugas confirmadas.
- No modo **apenas um shiny**, um shiny adversário em qualquer player interrompe antes do próximo reset e salva o state de todos os participantes.
- No modo **todos shiny**, cada shiny adversário gera exatamente um salvamento no próprio player; ele sai dos ativos e deixa de receber reset, A, leitura e incremento de `oddsResetCount`. Outros players seguem até cada um ter seu shiny. Dois shinies na mesma rodada são ambos preservados.
- Shiny na party do jogador não interrompe a caça. `pending`, state inválido, reset parcial, timeout, erro de salvamento, player removido ou R2 segurado não geram novo reset ou A perigoso.
- Ensaio prático pendente: players reais no navegador, inclusive até nove a 5× e animações lentas; medir pulso, espera e custo de `getState()` antes de considerar esses parâmetros definitivos.

## Limites desta etapa

A caça cobre encontros Gen III por interação com Pokémon parado, deslocamento único ou busca de encontro comum. O método de fuga usa a sequência temporizada de inputs nas ROMs Ruby, Sapphire e Emerald configuradas. Outros tipos de reset, outras formas de iniciar encounter e outras gerações ficam para especificações posteriores. Não há seleção automática de perfis, captura, batalha ou scanner visual de sprite.
