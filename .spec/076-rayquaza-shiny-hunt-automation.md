# Spec 076 — Caça automática de shiny em encontros estáticos

Status: primeira implementação em código; ensaio ponta a ponta com os saves posicionados diante dos encontros ainda pendente. Rayquaza motivou o caso, mas a leitura do encontro aceita outras espécies estáticas das ROMs Gen III registradas.

## O que o usuário quer

Com os personagens já salvos diante dos Pokémon estáticos, clicar em **Caça shiny** no cabeçalho do player. A rotina controla **todos os players abertos**, de 1 a 9, com um único agendador no Hub. Ela reseta os jogos, atravessa o boot/menu com A, usa o último A para iniciar o encontro, lê o Pokémon adversário de cada instância e repete até encontrar o primeiro shiny. Ao encontrá-lo, para sem atacar nem resetar de novo e informa em qual player ele apareceu.

O novo botão fica imediatamente ao lado de **Informações do perfil**. Ele inicia/para a caça e mostra o número de **resets globais confirmados nesta execução**, começando em 0 a cada início. Um reset dos nove players conta como 1, não 9. O número fica visível após parada ou resultado, até iniciar outra caça ou fechar o player. Não criar página, painel ou controles de timing.

O **Odds Manipulator é obrigatório durante a caça**: o início o liga se necessário e confirma o relógio em todos os players antes do primeiro reset. Também ativa o Fast Forward e ajusta sua velocidade para **5×** quando necessário. Não deve ser possível desligar ou alterar essas condições enquanto a rotina roda. O contador mostrado no botão é transitório e independente do oddsResetCount persistido por perfil; cada reset continua avançando um minuto virtual por perfil, conforme a spec 055.

## Fluxo da primeira versão

1. Congelar a lista de todos os sessionId abertos. Cada player precisa estar pronto, com ROM Gen III suportada e verificada, perfil/lease válidos e save já posicionado pelo usuário diante do encontro. Não adicionar um seletor de Pokémon. Se algum player não for compatível, explicar o motivo e não iniciar parcialmente.
2. Aplicar **soft reset imediatamente após o preparo** pelo caminho global existente, incluindo a configuração do Odds Manipulator. Aguardar confirmação de que o reset foi **executado** em todos os cores; postMessage enviado não é confirmação. Só depois incrementar o contador visível uma vez e iniciar o relógio do ciclo.
3. No roteiro inicial relatado pelo usuário, enviar cinco pulsos de A a todos: o primeiro pelo menos **2.000 ms reais após a última confirmação de soft reset** e os próximos com início aproximadamente a cada 1 segundo. Cada pulso tem down/up explícitos. O quinto A é a interação com o Pokémon no mapa. A implementação usa provisoriamente 40 ms de pressão e 1.000 ms de espera após o último A; esses dois valores ainda exigem ensaio no jogo real. Um atraso do navegador nunca gera pulsos em rajada.
4. Após o quinto A, não enviar mais entrada. O player lê localmente o encontro atual e devolve apenas pending, shiny, normal ou error. Reler somente players pending, de forma limitada. Um shiny válido em qualquer player encerra a caça imediatamente, solicita o salvamento do state de **todos os players abertos** pelo fluxo existente, aguarda o resultado desse salvamento e para sem emitir outro reset. Falha em salvar um state é reportada e não reativa a caça. O próximo reset só pode começar quando **todos os participantes** tiverem retornado normal válido para o mesmo ciclo.
5. Parada manual, falha, timeout, perda de player ou mudança na composição cancelam timers e o próximo reset e soltam A. Um reset aplicado só em parte dos players não autoriza A nem outro reset; o contador da caça permanece no último valor global confirmado.

O roteiro de cinco A é o primeiro caso suportado, não uma regra para todo encontro estático. A arquitetura deve permitir registrar outro roteiro validado sem criar outra rotina de caça; players com roteiros incompatíveis não podem participar da mesma execução global. Ruby/Sapphire/Emerald e Rayquaza são o primeiro conjunto para validar. O Emerald do usuário já tem RNG corrigido; a caça não altera RNG, ROM, RTC, save ou snapshot.

## Segurança da entrada e da leitura

Antes de cada A, o iframe precisa impedir localmente que o botão chegue a uma fase capaz de selecionar Fight/ataque. Se não houver sinal de fase confiável para uma ROM, essa ROM não entra na caça. Entrada física A/R2, resets e save/load manuais e mudanças de velocidade/controles não podem concorrer com o ciclo; bloquear a ação ou parar a caça antes de aplicá-la. Ao devolver o controle, um R2 que ainda esteja segurado não pode disparar reset: exigir soltura e nova pressão.

Um resultado normal ou shiny exige um encontro **criado neste ciclo**, estrutura íntegra, espécie decodificada e fórmula shiny correta sobre PID/OTID Gen III. A leitura deve distinguir explicitamente a party do jogador da party adversária; um shiny já presente no save do jogador jamais satisfaz a condição de parada. A espécie adversária é decodificada do encontro, sem codificar Rayquaza como alvo obrigatório. Pending significa que o encontro ainda não está comprovado e nunca conta como normal. Dados residuais de outra batalha, state inválido ou leitura antecipada não podem autorizar reset. A leitura ocorre dentro do iframe; o Hub recebe apenas resultado resumido e identidade da sessão, nunca os states completos.

O formato do getState() foi conferido no EmulatorJS 4.2.3 e a posição da party adversária foi conferida em um snapshot real de Emerald. O adaptador lê a party adversária em RAM e usa o registro inimigo como barreira antes de cada A: se ele já estiver preenchido neste ciclo, não envia outro A. Ainda faltam ensaios com encontros reais em Ruby/Sapphire e com todos os players abertos a 5× para confirmar endereços, tempo de pulso e espera nas três ROMs. Essa validação pertence ao desenvolvimento, sem criar configuração para o usuário.

## Encaixe no sistema atual

| Parte | Estado atual | Mudança necessária |
| --- | --- | --- |
| apps/frontend/src/main.jsx | Até nove iframes, cabeçalho global, polling de gamepad a cada 16 ms, dispatchReset e Odds Manipulator. | Botão ao lado de Informações, contador da execução, agendador único, bloqueio de controles conflitantes e barreira de respostas de todos os players. |
| apps/frontend/src/player.js | Recebe reset/gamepad; usa restart(), softResetEmulator() e getState(); valida origem e janela. | Confirmar aplicação de reset e de A down/up; proteger A; ler e resumir o encontro local. |
| apps/packages/ | Já contém player-frame-request, origin-topology, gamepad-input e regra shiny Gen III para saves. | Contratos de mensagens, máquina de estados, arbitragem de input, registro de compatibilidade por ROM/runtime e decodificador de encontro reutilizáveis. |

O dispatchReset atual incrementa oddsResetCount e envia reset sem confirmação de execução no core. A caça precisa de um caminho com resposta aplicada, preservando a sincronização existente do relógio e sem confundir o contador persistido com o contador do botão. Mensagens da caça devem usar huntId, cycleId, sessionId e requestId e validar origin/source; respostas antigas ou duplicadas são ignoradas.

A caça é opcional: ROM sem suporte continua abrindo e salvando normalmente. Falha da automação não enfraquece validação de ROM, perfil, lease ou save.

## Verificações para considerar pronto

- Com 1 a 9 players, todos os abertos entram no mesmo ciclo. O contador começa em 0 e sobe uma vez por reset confirmado por todos; nova execução volta a 0. Odds Manipulator fica ligado e mantém um minuto virtual por reset aceito de cada perfil.
- Ao iniciar, Odds Manipulator e Fast Forward 5× ficam ativos e o primeiro soft reset é solicitado imediatamente após essa preparação.
- No roteiro inicial, nenhum A sai antes de 2.000 ms após o último soft reset confirmado; há cinco down/up espaçados em cerca de um segundo, sem sexto A nem ataque.
- Todos normais válidos permitem outro soft reset. Shiny no **adversário** de qualquer posição interrompe antes do próximo reset, salva o state de todos os players, identifica o player e preserva o encontro. Shiny na party do jogador não interrompe a caça.
- Pending, state inválido, reset parcial, timeout, atraso excessivo, player removido ou R2 segurado não geram reset ou A perigoso. A sempre termina solto.
- Ensaio prático pendente: players reais no navegador, inclusive a carga de até nove a 5× e a animação mais lenta do Emerald; medir pulso, espera e custo de getState() antes de considerar esses parâmetros definitivos.

## Decisões já tomadas e limites

Todos os players abertos participam. O contador do botão é **da execução atual**. O Odds Manipulator permanece ligado durante a caça. A primeira implementação cobre encontros estáticos Gen III com roteiro validado, começando pelo cenário de cinco A; novas sequências e outras gerações podem ser adicionadas depois. Não há scripts independentes por iframe, seleção automática de perfis, captura, batalha ou scanner visual de sprite.
