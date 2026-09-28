# Spec 083 — General Quality of Life Changes

Esta é a spec canônica desta conversa para os ajustes pontuais de qualidade de vida. Novas decisões sobre os mesmos ajustes devem ampliar este arquivo.

## Play/Pause global do player

Adicionar um botão Play/Pause fixo antes do mute na pilha de controles do player. Cada clique consulta o estado do primeiro emulador renderizado. Se ele estiver executando, pausa todos; se estiver pausado, inicia todos. O botão não guarda estado, não troca ícone, nome ou estilo ativo.

### Contrato

- O frontend React solicita por `postMessage` o estado `paused` do primeiro iframe renderizado. A resposta deve corresponder à origem, janela e ID da solicitação antes de ser usada.
- Se o primeiro emulador ainda não estiver pronto, não houver iframe ou a resposta expirar, o clique não altera nenhum emulador.
- Com uma resposta válida, o frontend envia uma ação explícita e idêntica a todos os iframes atualmente renderizados. Cada iframe chama `EJS_emulator.pause()` ou `EJS_emulator.play()`; um player sem emulador pronto ignora a ação.
- A ação de play respeita o bloqueio de interação existente, que protege modais e fluxos de recuperação. O controle fica indisponível durante a caça shiny, como os controles de reset.
- Não alterar save, snapshot, lease, perfis nem os controles nativos ocultos do EmulatorJS. Não persistir o estado do botão.

### Verificação

Testar consulta do primeiro iframe, rejeição de resposta inválida ou ausente, propagação para todos os iframes, decisão a partir de `paused` e integridade dos controles existentes. Rodar lint e testes pertinentes sem executar build, que depende de pedido explícito do usuário.

## Ações enquanto um emulador está pausado

- Save state, load state, soft reset e hard reset não executam no iframe pausado, venham dos botões ou dos atalhos L2/R2. Instâncias em execução ainda podem receber ações globais.
- Um atalho L2/R2 não inicia uma ação global se o player selecionado está pausado. A decisão vem de uma consulta ao player, sem guardar um segundo estado de pausa no frontend.
- Macros salvos não iniciam em um player pausado; ao pausá-lo, uma execução ativa é interrompida. Comandos da caça shiny não executam nesse player enquanto estiver pausado.
- Ao iniciar caça shiny global, incluir apenas players em execução. Se nenhum estiver em execução, a caça não começa. Um player que pause durante a caça rejeita comandos subsequentes para que o coordenador encerre a tentativa em vez de manipulá-lo pausado.
- A consulta de estado deve identificar o iframe, sua origem e o ID da solicitação. Se o estado não puder ser confirmado, não executar o atalho ou incluir o player na caça.

## Controles visuais do frame do emulador

- Usar componentes Ant Design nos controles do cabeçalho e nos controles exibidos sobre o frame. Preservar ações, rótulos acessíveis e tema escuro verde.
- Os Selects Ant Design da velocidade do Fast Forward, de L2 e de R2 não exibem seta. L2 e R2 ganham cerca de 20 px cada no cabeçalho desktop.
- Save State, Load State, Soft Reset e Hard Reset ocupam um único grupo, sem divisor entre eles.
- Informações do perfil fica entre Play/Pause e Mute.
- O botão de configurar caça shiny usa um ícone distinto do reset.
- O botão de fechar o frame tem botão e ícone vermelhos. O ícone de adicionar instância usa um verde mais claro.
- O Play/Pause usa o desenho combinado de play e pause já usado antes, dentro do botão Ant Design. O manipulador de odds usa o ícone de jogo da velha do Ant Design; macros usa um raio do Ant Design.
- Nas opções dos seletores L2/R2, a ação `toggle-last-macro` aparece como “Último macro”, preservando o comportamento de iniciar/parar.

## Overlay individual por emulador

- Ao passar o ponteiro sobre uma célula de emulador, exibir sobre ela um painel translúcido no tema escuro verde. A célula vizinha permanece independente.
- Centralizar um botão grande de Play/Pause na célula. Cada clique consulta o estado real desse iframe e alterna somente esse emulador.
- Abaixo do Play/Pause, centralizar quatro ações: Reset (hard reset), Load State, Save State e Informações do perfil. Todas usam componentes Ant Design.
- Reset, Load State e Save State miram apenas a sessão da célula e respeitam as regras existentes para emuladores pausados. Informações abre o modal de renomear existente para aquela sessão.
- O overlay fica atrás dos modais de perfil e restauração já exibidos na célula. Nenhuma ação muda a seleção global ou outro emulador como efeito colateral.
- O fundo do overlay usa o verde escuro do tema com 60% de opacidade. Os botões mostram somente ícones, sem borda ou fundo, inclusive no hover, e todos usam o mesmo verde.
- Play/Pause usa apenas um triângulo de play. Seu tamanho acompanha a largura e a altura da célula até um teto de 96 px; os demais ícones acompanham a mesma escala a aproximadamente 66%, até 63 px.
- A ordem inferior é Reset, Save State, Load State e Informações. Load State mostra o estado desabilitado quando aquela instância não possui um estado salvo, igual ao controle do cabeçalho.

## Informações de perfis com vários emuladores

- O botão Informações do cabeçalho mantém o modal atual quando só há um emulador. Com dois ou mais, abre um modal único sobre o frame inteiro.
- O modal lista todas as sessões abertas em duas colunas: jogo e save. Na coluna save, o número do perfil é somente leitura, seguido de um traço e do nome editável já visível em cada linha.
- Um único botão Salvar envia as alterações de todas as sessões em paralelo pelo contrato existente de atualização de perfil. Atualizações confirmadas sincronizam catálogo e sessões; se alguma falhar, o modal continua aberto e identifica os perfis não salvos para nova tentativa.
- Enquanto o modal estiver aberto, bloquear interação com todos os emuladores, como nos demais diálogos globais. O botão Informações de cada overlay continua abrindo apenas o modal daquele perfil.

## Identificação dos perfis ao fechar vários emuladores

- No modal de escolha das instâncias a fechar, exibir antes do nome de cada perfil o mesmo número mostrado no seletor de perfis da sua ROM.
- Calcular o número pela lista de perfis daquela ROM com `formatGameProfileLabel`, sem usar a posição da instância ou a ordem visual do modal.
