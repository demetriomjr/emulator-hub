# Spec 089 — Observabilidade do frontend e RNG por reset

Status: implementado, validado em fixture real de navegador/core/Nginx e publicado em produção em 2026-10-04 após autorização do usuário. Receptor público e bundle novo verificados. Seeds de caças reais nessa nova versão ainda não foram observadas; captura da seed é condicional à janela observada.

## Objetivo e limites

Atualização de escopo em 2026-10-04: usuário pediu singleton Redis `debugging-environment`, rota GET/PATCH `/api/debug/environment`, campo booleano `rngDebugLogging`. Publicar desligado. A configuração é lida somente ao carregar cada documento; mudanças exigem refresh. Não criar UI, polling, propagação por heartbeat ou mudança ao relógio, caça, saves e leases. PATCH usa autorização de operador existente; GET expõe somente o booleano. Ausência/falha de configuração mantém diagnóstico desligado. Desligado não armar o observador nem serializar estados para diagnóstico, e não enviar/registrar diagnósticos no console; a inspeção de Pokémon necessária à caça continua funcionando.

Entrega do gate de diagnóstico: 1130 testes passaram, zero falhas, três skips da suíte existente. Teste na imagem final com Nginx/core real (`hub-launch.mjs --image --debug-switch`) confirmou default false sem eventos/hook de RNG; PATCH true não altera documento aberto; após refresh o reset real voltou a gerar evento no stdout; PATCH false com novo refresh interrompeu os eventos e o jogo continuou avançando. Artefatos privados: `test-data/frontend-observability/hub-1791117188118-19548`. Frontend entregue `sha256:03143280f12c81add6ab83b1e8df87656ee0b6bb891cab4f4777aaa6e5d04a4b`; backend `sha256:b9e606f7c70287a44098c228f6d8bf7e0b6103d12ce322f8bb04af4375ca48c9`. GET e PATCH públicos verificados com 200 e flag false; browser no endereço de produção fez um GET de configuração e zero POSTs de diagnóstico durante 5,5 s. Backup backend retornou 201 antes do deploy. Sem commit solicitado.

Observar no dashboard os eventos produzidos pelo frontend, especialmente o RNG do Emerald durante a automação Shiny Hunt em modo reset. O navegador lê o core; o container do frontend recebe os eventos e escreve em stdout. Esse transporte não usa o backend, Redis ou armazenamento de saves.

Esta é a única spec desta conversa. Não altera IPS, chance de shiny, relógio, ROM, perfis, leases, saves, navegação ou UI. Não autoriza build, commit, push ou deploy.

## Evidência da investigação em 2026-10-03

- Checkout original: `D:\PROJETOS\emulator-hub`, branch `master`, HEAD `bfd0722255e632b0abe19ffd4fa2f936d4a39d83`. Antes desta spec, apenas `.spec/087-local-signed-ci-cd.md` e `.spec/088-browser-background-runtime.md` estavam untracked; foram preservados.
- Consulta somente leitura à VPS: checkout `/home/deploy/emulator-hub`, HEAD `3290b9acccf80a65496e2ba375b47cec0e78a992`. O checkout remoto e o local não representam o mesmo commit.
- `emulator-hub-frontend-1` executa `nginx -g 'daemon off;'`. Não há processo Node no frontend. Nginx observado: `1.29.8`; o módulo `nginx-module-njs=1.29.8.0.9.6-r1` e `ngx_http_js_module.so` já estão presentes, mas o `nginx.conf` consultado não os carrega.
- Os arquivos de log do Nginx apontam para `/dev/stdout` e `/dev/stderr`. Docker usa `json-file`, sem opções de rotação específicas no container consultado. A política global do daemon não foi consultada.
- `deploy/nginx.conf` e a configuração ativa encaminham `/api/` para `backend:3001`. Não existe rota local para eventos de navegador.
- `apps/packages/client-diagnostics.mjs` envia para `/api/debug/client-events`, condicionado a `VITE_DEBUG=1`. O Dockerfile não declara esse argumento; o estado efetivo dessa flag em todas as páginas de produção não foi demonstrado.
- `apps/packages/snapshot-telemetry.mjs` também envia para esse endpoint, sem o mesmo gate. O backend normaliza os eventos e os escreve nos logs dele. Assim, existe telemetria parcial, mas com destino inadequado para este pedido.
- `apps/packages/shiny-hunt-player.mjs` já consome `getState()` e identifica a caça e o ciclo. O controller conta um Pokémon verificado por tentativa, independentemente do número de resets.
- A caça atual usa soft reset de quatro botões por 120 ms. A resolução dessa função confirma o envio e a liberação dos botões; não prova que o core chegou ao reseed ou ao primeiro frame pós-reset.
- O Emerald reconhecido usa `gRngValue` em `0x03005D80`, traduzido para `0x1ED90` no state mGBA esperado. `pokemon-gen3-encounter.mjs` já valida ROM, patch, runtime e cabeçalho do state para ler Pokémon.
- O IPS encontrado dentro do backend em produção tem SHA-256 `e12480bad322c9bbb20ebba943ab5d1987001657e0f69d74f5cd94d6ba20a6b3`, igual ao manifesto local. Isso prova a presença do arquivo naquele container, não sua aplicação em todas as sessões abertas.
- A página de produção referencia EmulatorJS `4.2.3`. O `GameManager.js` dessa versão expõe `getFrameNum()` e `getState()`, que serializa e copia o state inteiro. O código do EmulatorJS atribui `Module.postMainLoop` no fluxo de netplay: esse é um candidato a observar, não uma API pública de captura por frame já validada nesta investigação.
- O probe Python existente pausa o core, verifica igualdade entre frame pedido e observado e compara RNG após uma fronteira detectada. Esse controle experimental não está integrado à caça real e não deve ser importado como se fosse uma observação passiva.

## Decisão proposta para o destino dos logs

Manter Nginx e habilitar seu módulo JavaScript para uma rota exata `POST /_frontend/events`. Usar handler local `js_content`, validação por lista de campos e `access_log` específico em `/dev/stdout`. Nenhum `proxy_pass`, subrequest ou chamada externa faz parte desse handler.

O corpo validado deve ser normalizado e serializado pelo servidor, nunca copiado diretamente para o log. Uma variável escrita pelo handler contém o JSON normalizado; o formato específico de access log usa somente essa variável. Ausência de dupla codificação e proteção contra quebra de linha precisam de teste no Nginx real. Eventos rejeitados não devem registrar corpos arbitrários.

Opções avaliadas:

| Opção | Consequência |
| --- | --- |
| Nginx + módulo JS já presente | Recomendada: destino no container atual, sem outro processo ou container. Exige carregar módulo e validar handler/configuração. |
| Receptor Node junto do Nginx | Possível, mas acrescenta runtime e supervisão de dois processos. Desnecessário enquanto o módulo disponível atende ao contrato. |
| Access log contendo corpo bruto de POST | Não usar: não fornece normalização, controle dos campos ou evidência suficiente de aceitação do evento. |

Cada player envia para a URL relativa na própria origem. As origens isoladas continuam apontando para o mesmo frontend; não se cria um receptor por player. A rota deve funcionar no Hub e nas nove origens e ter equivalente no middleware do Vite para desenvolvimento, sem proxy ao backend.

O primeiro contrato aceita um evento por POST e responde `204` após validação. Limites propostos: corpo de 16 KiB, campos de identidade de até 128 caracteres, mensagens de até 512 e stack de até 2.048. Campos desconhecidos são descartados. Corpo inválido, conteúdo incompatível e método indevido produzem `400`, `415` e `405`; excesso de tamanho produz `413`. Usar limite de requisições compatível com nove players e testar sua configuração; saturação deve produzir `429` apenas nesta rota.

Não habilitar CORS amplo. A coleta usa JSON same-origin e verifica Origin quando fornecido. Sem segredos no bundle, sem tokens de lease/cookies/corpo de ROM/save nos eventos. A rota é um receptor de telemetria de clientes, não uma fonte autenticada de verdade sobre a memória.

## Coleta de eventos do frontend

O transporte pertence a `apps/packages/`, com integração em `apps/frontend`. Ele deve ter fila limitada de 64 eventos por página, uma requisição por vez e timeout de 2 segundos. Não aguardar a entrega de rede na sequência de inputs ou no loop do core. Falha de envio descarta o evento e incrementa um contador local de perdas, sem retry infinito, recursão de logs ou interrupção da caça.

Migrar os produtores existentes de diagnósticos e snapshot do navegador para o destino do frontend. Manter eventos produzidos pelo próprio backend nos logs do backend. Não interceptar indiscriminadamente todo `console.*`: emitir eventos estruturados nas operações relevantes e nos handlers de erro. A coleta básica de erros e o resumo de RNG durante a caça devem funcionar em produção sem depender de `VITE_DEBUG`.

`receivedAt` é timestamp real gerado pelo servidor. `virtualTimestamp` é um campo separado. O Odds Manipulator substitui `Date.now()` no player, portanto esse valor não deve virar o timestamp real do log. Duração da coleta usa `performance.now()`.

## Captura do RNG por reset

### Identificação e registro

Emitir um resumo `hunt.rng-reset` para cada reset da caça, com `eventId`, `huntId`, `cycleId`, `sessionId`, `profileId`, `gameId`, `romSha256`, `patchSha256` efetivamente aplicado, `runtimeId`, modo de threads e estado de fast-forward, `resetType`, `oddsResetCount` e `virtualTimestamp`.

O conteúdo inclui:

- frame e RNG antes do comando;
- frame do comando e, separadamente, frame de liberação dos botões;
- amostras iniciais `{ frame, rngValue }`, com valores uint32/hex normalizados;
- fronteira de reset/reseed, apenas quando demonstrada pelo método validado;
- frame e RNG de comparação posterior;
- status `observed`, `unavailable`, `missed-window` ou `unsupported`, método usado, razão e duração;
- quantidade de frames saltados, e offset relativo somente se a fronteira estiver comprovada.

Os IDs são correlação, nunca credenciais. Leitura e extração ficam no navegador: nenhum state completo sai pelo canal de observabilidade ou é salvo por causa dessa coleta. O registro de resultados de encounters pode reutilizar o PID já decodificado e vinculá-lo ao mesmo ciclo para mostrar repetição; somente identidade do Pokémon e resultado necessários a esse diagnóstico.

### Precisão necessária

Armar a observação antes do reset. A coleta não pode começar somente depois dos 120 ms de pressão dos botões. `cycleId`/`requestId` impedem que amostras de uma tentativa anterior sejam atribuídas à próxima. Parada, fechamento, cancelamento ou troca de caça desarmam a observação.

O primeiro ou segundo frame após o comando pode anteceder o reseed. `gRngValue` é estado corrente do RNG; chamar esse valor de seed inicial exige conhecer a inicialização e os avanços ocorridos até a leitura. Um valor diferente entre dois momentos, um valor não zero ou uma mudança no wrapper de `Date.now()` não comprovam o funcionamento do IPS.

O primeiro passo técnico de implementação é qualificar o hook do runtime em uso, preservando qualquer callback existente. Deve demonstrar a cadência observada, os saltos e a segurança de `getState()` dentro desse hook, inclusive com threads/fast-forward. Não usar endereços de HEAPU8 ou ponteiros inferidos para fugir da serialização sem uma API e layout comprovados.

Coleta passiva padrão: observar no máximo 120 frames emulados e timeout de 2 segundos reais por reset; conservar uma janela circular limitada de 16 amostras. O timeout depende de o navegador executar seu callback: sob contenção pode terminar depois do prazo nominal. Manter a observação até o fim do orçamento para invalidar um zero transitório que anteceda o reseed RTC. Medir o custo de serialização por `sampleCount`, `readDurationMs` e `maxReadDurationMs`. Esse orçamento é limite de coleta, não garantia de capturar todos os frames.

Se o loop entrega vários frames de uma vez, registrar os frames realmente observados e `missed-window`. Não prometer frame 1/2 por `setTimeout`, `requestAnimationFrame` ou contador absoluto do manager. Se a precisão exata requer instrumentar o core, registrar essa necessidade e estender esta mesma spec antes dessa mudança. Não pausar, carregar state, reiniciar de novo ou reduzir fast-forward automaticamente para fabricar precisão.

Layouts de diagnóstico são metadata em um registro separado: aplicar somente ao par de ROM/runtime validado, começando pelo Emerald e o IPS conhecido. `validated: false` no catálogo experimental de ROM fix não autoriza tratá-lo como receita comprovada. O diagnóstico não altera disponibilidade de ROM nem requisitos de lançamento.

### Interpretação da evidência

O LCG conhecido é `next(x) = (0x41C64E6D * x + 0x6073) mod 2^32`. A regressão de controle deve mostrar se ele avança uma vez por frame na janela escolhida. Não assumir essa relação em fases que fazem chamadas extras de RNG.

Validar um cenário de minuto RTC fixo com repetição após reset e outro com avanço de um minuto, comparando o mesmo ponto relativo pós-inicialização. A seed esperada deve vir da conversão de calendário/minutos realmente usada pelo jogo/core; não assumir que é igual a `oddsResetCount` nem que uma leitura tardia é a seed.

A primeira integração cobre cada soft reset em modo reset de Shiny Hunt, além de reset de recuperação individual quando ele realmente ocorrer no modo fuga. Fugas sem reset não produzem evidência de reseed. Reutilizar a mesma instrumentação para hard reset manual, respeitando seu caminho próprio e sem acrescentar um modo de caça não solicitado.

## Fronteiras dos componentes

- `apps/packages/`: contrato e normalização de eventos, transporte do navegador, layouts RNG e máquina de observação por reset; sem dependência do backend.
- `apps/frontend/src/player.js`: conecta o sampler ao core e os eventos às operações do player.
- `apps/packages/shiny-hunt-player.mjs`: propaga identidade do ciclo e arma/desarma a observação ao redor do reset existente.
- `apps/frontend`: adapter HTTP do Nginx, configuração do Vite e empacotamento dos módulos necessários; lógica reutilizável continua em packages.
- `deploy/`: carregamento do módulo e rota/log Nginx. Preservar paths estáticos, headers de isolamento, proxy de APIs reais e portas.
- Backend: não recebe nem persiste os novos logs de frontend; persistência e fencing de save continuam usando seus contratos atuais.

## Critérios de aceitação e evidência ainda necessária

1. POST válido produz JSON normalizado em stdout de um frontend descartável; JSON inválido, quebra de linha e excesso de tamanho não geram logs arbitrários. Demonstrar funcionamento com a versão exata do módulo presente e `nginx -t`.
2. Nginx recebe eventos sem upstream. Validar contra backend mock que nenhum request de observabilidade chega a ele; não usar o backend de produção como alvo de teste.
3. Hub e nove origens enviam para o frontend. Coleta não depende de flag debug de build, não cria loop de erros e informa perdas na próxima entrega possível.
4. Fixtures de state comprovam assinatura, bounds, endian e leitura uint32 de `0x03005D80`; layout/runtime desconhecido produz `unsupported` sem impedir a caça.
5. Testes de ciclo cobrem observação armada antes do reset, resposta tardia, cancelamento, fronteira não detectada e frames saltados. Falha do diagnóstico nunca vira falha de reset, save ou hunt.
6. No runtime descartável correspondente ao de produção, comparar ROM original e o IPS verificado, minuto fixo/avançado, soft/hard reset, threads e fast-forward. Registrar frames reais e custo com nove instâncias. Resultados registrados na seção de validação.
7. Após implementação e um deploy separadamente solicitado, correlacionar logs de resets reais e PIDs com a sessão de produção e identidade do release. Presença do IPS no container e testes Python não substituem essa evidência.
8. Verificar retenção/rotação do Docker antes de coleta contínua. Não mudar globalmente o daemon ou o dashboard para isso.

## Referências

- Código local: `deploy/frontend.Dockerfile`, `deploy/nginx.conf`, `apps/packages/client-diagnostics.mjs`, `apps/packages/snapshot-telemetry.mjs`, `apps/packages/player-reset.mjs`, `apps/packages/shiny-hunt-player.mjs`, `apps/packages/pokemon-gen3-encounter.mjs`, `test-data/test_emerald_live_reset_rtc.py`.
- [NGINX JavaScript module: js_content e js_var](https://nginx.org/en/docs/http/ngx_http_js_module.html).
- [NGINX JS requestText e variables](https://nginx.org/en/docs/njs/reference.html). Usar APIs existentes na versão instalada, não exemplos que dependam de versões futuras.
- [NGINX access_log e log_format](https://nginx.org/en/docs/http/ngx_http_log_module.html).
- [EmulatorJS 4.2.3 GameManager servido pelo CDN](https://cdn.emulatorjs.org/4.2.3/data/src/GameManager.js).
- [EmulatorJS 4.2.3 runtime servido pelo CDN](https://cdn.emulatorjs.org/4.2.3/data/src/emulator.js).

## Requisitos aprovados e plano de implementação

O usuário solicitou levantamento de requisitos, implementação e cobertura end-to-end completa, com prova prática de logs contendo seed e RNG. Executar no checkout original; preservar as specs 087/088; não executar build, commit ou deploy de produção.

Seed e estado corrente são campos distintos. Só preencher `seed` quando uma amostra da reinicialização, seguida de avanços consecutivos do LCG, sustentar essa inferência. Sem essa prova, `seed` permanece null e o evento informa a limitação. Um valor observado posteriormente nunca será promovido silenciosamente a seed.

### Plano inline

- [x] T1: teste vermelho do contrato/HTTP local; implementar normalização, limite de corpo e adapter Nginx/Vite. Provar JSON no stdout e zero tráfego para o backend.
- [x] T2: teste vermelho do transporte limitado; migrar diagnósticos de navegador e snapshots, habilitar coleta básica em produção, evitar recursão e testar perdas/timeouts.
- [x] T3: teste vermelho da captura de RNG; implementar observador de runtime, cancelamento e detecção conservadora; integrar soft/hard reset e identidade da caça.
- [x] T4: suíte E2E de navegador real e Nginx descartável, com ROM/IPS reais em fixture privada, resets repetidos, relógio fixo/avançado, fast-forward, nove players e falhas do receptor. Preservar artefatos com eventos e resultados.
- [x] T5: executar regressões relevantes, lint sem build e revisão final; registrar comandos, resultados e limites reais nesta spec.

Os contratos reutilizáveis serão `normalizeFrontendEvent`, `handleFrontendEventRequest`, `createFrontendEventTransport` e `createRngResetObserver`. A integração do runtime deverá usar os mesmos módulos nos testes e no player real, evitando um coletor exclusivo de fixture.

Review focus: amostra capturada antes de reseed; salto de frames em fast-forward; cancelamento recebendo resposta tardia; rede indisponível afetando inputs; payload arbitrário atingindo stdout. Cada condição recebe teste de comportamento próprio.

## Implementação e validação concluídas

Contrato/transportes em `apps/packages/frontend-events.mjs` e `frontend-event-transport.mjs`; diagnóstico em `rng-reset-observer.mjs`; adapters em `apps/frontend/server/`; configuração Nginx/bootstrap em `deploy/`. Reutilizados pelo player real e pela fixture E2E. Diagnósticos básicos estão sempre habilitados; overlay FPS e medição verbose continuam condicionados a `VITE_DEBUG=1`. Não há novas telas ou controles.

O módulo NJS padrão rejeitou os imports nomeados do contrato durante o primeiro teste real. Configurado `js_engine qjs`, suportado pelo módulo instalado; `nginx -t` e POST reais passaram. Não acrescentado runtime Node ao container.

Método qualificado: hook de `Module.postMainLoop` preservando o callback anterior, com polling de frames como fallback. Seed inferida exige descontinuidade de um frame para uint16 seguida por três frames consecutivos do LCG. Uma descontinuidade posterior invalida a prova anterior, incluindo quando a nova fronteira ficou entre frames saltados. Isso corrige um falso seed `0` visto na primeira fixture concorrente. Amostras da prova são retidas junto da janela posterior, no máximo 16.

### E2E real

Comando: `python apps/tests/frontend-observability/run.py --rom "test-data/Pokemon Emerald.gba" --image emulator-hub-frontend --ssh-target deploy@91.108.124.242 --ssh-identity "C:\Users\dm3o\.ssh\hostinger_vps"`.

Resultado final: **24 verificações, 19 eventos de reset conferidos no stdout, aprovado**. Artefatos privados/ignorados: `test-data/frontend-observability/20261003-203824-b65cfc/results.json`, `container.stdout.log`, `container.stderr.log`. A comparação adicional entre todos os eventos do navegador e stdout confirmou entrega única e igualdade de seed, RNG, status, amostras e ciclo; está incorporada também ao runner para execuções futuras.

O teste usou Chromium 153 e EmulatorJS 4.2.3 reais, ROM original verificada e o mesmo IPS encontrado na produção. Nginx executou em container descartável na VPS, usando a imagem existente e mounts da implementação; rede, portas e arquivos temporários exclusivos. O backend de produção não foi alvo: upstream de teste com marcador `BACKEND_TRAP`, ausente dos logs. Container/arquivos temporários foram removidos no `finally`; aplicação e sessões de produção não foram reiniciadas.

| Cenário | Evidência |
| --- | --- |
| Soft reset, minuto 1 repetido | Seed `48012` nas duas tentativas, com prova LCG e stdout correspondente. |
| Soft reset, minuto 2 | Seed `48015`; diferente do minuto anterior e igual à conversão independente do RTC. |
| Hard reset, minuto 3 | Seed `48014`, igualmente conferida contra o calendário. |
| Soft reset a 5×, minuto 4 | RNG real registrado; 58 frames saltados, seed `null`, `missed-window`. Seed esperada `48049` não foi apresentada como se tivesse sido observada. |
| ROM original sem IPS | Quatro tentativas preservadas: três janelas perdidas e uma prova de seed `0`. Não se descartaram limitações para esconder a variabilidade. |
| Nove origens/cores simultâneos | Nove logs independentes, todos com RNG; oito seeds observadas e iguais às esperadas, uma `null` por janela perdida. Nenhum zero transitório rotulado como seed RTC final. |
| Threads reais | SharedArrayBuffer e isolamento conferidos; RNG entregue, seed `null`, 28 frames saltados. Captura exata não garantida nessa modalidade. |
| Receptor offline / cancelamento | Reset e frames continuam; cancelamento desarma hook/timer e não publica evento antigo. |
| Erro real de navegador / snapshot | Ambos alcançaram o stdout do frontend. |
| HTTP e payload | 204 válido; 400 JSON inválido; 415 conteúdo; 403 origem; 413 tamanho; 405 método; 429 burst. Campos secretos/state removidos e quebra de linha não forjou outro registro. |

Custo observado no host de teste: no cenário simples, ~151–207 ms acumulados de leituras por reset, 119–120 amostras. Com nove cores, ~179–293 ms por player, 22–27 amostras; pior leitura individual ~38 ms. Isso demonstra custo material e contenção nesse host, não qualifica FPS de gameplay em produção. Os campos de custo permitem avaliar a própria sessão após deploy. A coleta não pausa o core, reduz velocidade ou carrega state para obter uma prova.

A seed esperada do E2E é calculada separadamente: calendário local do navegador; ano RTC pela conversão unsigned do mGBA; contagem de dias/leap year do jogo; horas/minutos BCD utilizados por `RtcGetMinuteCount`; XOR das metades de 16 bits. Datas do contador virtual próximas do epoch não equivalem ao calendário 2000. Fontes: [main.c do jogo](https://github.com/pret/pokeemerald/blob/master/src/main.c), [rtc.c do jogo](https://github.com/pret/pokeemerald/blob/master/src/rtc.c), [GPIO/RTC do mGBA](https://github.com/mgba-emu/mgba/blob/master/src/gba/cart/gpio.c). Nenhum expected seed é injetado na captura do produto.

### Regressões e revisão

- Seleção final: **242/242 testes Node aprovados**, comando `node --test --test-concurrency=2` com os arquivos listados em `test-data/frontend-observability/20261003-203824-b65cfc/unit-test-selection.json`; saída em `unit-tests.log`. Inclui contrato/HTTP, fila/timeouts, layout/RNG/transitórios, controlador/player, PID por ciclo, exceções do logger, saves/fechamento, threads/velocidade e integração de frontend.
- Lint dos arquivos JS alterados e novos: ESLint com `apps/frontend/eslint.config.js`; aprovado. `git diff --check`: aprovado.
- A ampliação inicial para todos os testes de frontend encontrou falhas nos harnesses de fechamento/FPS e no matcher pagehide; atualizados para preservar as verificações e incluir o novo cancelamento. Encontrou também **um erro preexistente**, `global-profile-editor.test.mjs` espera `{ cache: 'no-store' }`, enquanto o cliente envia também `signal: undefined`. Reproduzido com arquivos extraídos do HEAD original `bfd0722255e632b0abe19ffd4fa2f936d4a39d83`, sem mudanças da tarefa: `test-data/frontend-observability/baseline-11814f/baseline-tests.log`. Esse teste não faz parte da seleção final; a suíte completa não é declarada aprovada.
- Revisão independente encontrou duas lacunas, corrigidas: exceções síncronas do console/reporter e ausência de cálculo independente da seed esperada no E2E. Revisor conferiu as correções e não apontou novos problemas importantes.

Na etapa de implementação acima não foram executados build da aplicação, commit, push, CI ou deploy. A entrega posteriormente autorizada está descrita abaixo.

## Deploy autorizado em 2026-10-04

O usuário solicitou deploy em produção após informar uma caça noturna com sete Emerald, dois Ruby/Sapphire e cerca de 40 mil encounters, cujo shiny apareceu em RS. Isso motivou publicar a observabilidade; não foi tratado como prova de defeito no IPS.

- VPS verificada: frontend/backend saudáveis, HEAD remoto anterior `3290b9acccf80a65496e2ba375b47cec0e78a992`, nenhuma mudança tracked e zero leases ativos. Nova consulta imediatamente antes da troca também encontrou zero leases ativos.
- Backup autenticado de estado: `backend-state-20261004T092710Z-af26aac86fb7.json.gz`, SHA-256 `af26aac86fb75f9bfecf00108d60595a01d5050c83acc2010021595f1acf5462`, 19.864 registros Redis e 24 saves.
- Backup de código/volume e imagem anterior preservados em `/home/deploy/emulator-hub/backups/rng-observability-20261004T092710Z/` e tag `emulator-hub-frontend:pre-rng-observability-20261004T092710Z`. Arquivo `backend-volume.tgz`: SHA-256 `27610d6a99744779485142dada6fb7a5868803cff6b0491f1395a9ea07a864dd`. Código anterior: `source-before.tar.gz`, SHA-256 `d1f18f709fc4939df79ac68a894b71c109421e42f758b90d707da2063214ec0f`.
- Checkout original da VPS avançado por fast-forward para o commit já existente `bfd0722255e632b0abe19ffd4fa2f936d4a39d83`. Esse commit também entrega a contagem de tentativas após inspeção do Pokémon. A implementação de observabilidade continua sem commit; não houve commit ou push nesta tarefa.
- Overlay de 31 arquivos, com conferência de hashes na VPS antes do build. Manifesto congelado `source-manifest.json`: SHA-256 `537f6b735f6bea584cd52ce31c55ee4ec1fdec1838747efb36dc3547941aeb5f`; arquivo `source-overlay.tgz`: SHA-256 `135fba6d6f53f443030ccb79d05469dd32e90053b7ec6c500ed53f2252a3738f`. O manifesto registra o snapshot de build; esta spec recebe evidência adicional após esse snapshot.
- `.dockerignore` passou a excluir `backups` e `test-data`, impedindo o envio de backups privados/fixtures ao contexto do build.
- Testes frescos de regressão mais Compose/Caddy: **248/248 aprovados**, saída local `test-data/frontend-observability/deploy-unit-tests.log`.
- Build na VPS: `docker compose --env-file deploy/.env -f docker-compose.yml build frontend`, aprovado, incluindo lint e build de 5.580 módulos. Log em `backups/rng-observability-20261004T092710Z/frontend-build.log`. Aviso de chunks grandes continua presente; não houve erro de build.
- Imagem nova: `sha256:d3b70c41375e23fdb56f8dff23cdf6b6a09fb1ab244d2bf3595e1c606794d425`. Preflight descartável com `nginx -t` aprovado antes da troca.
- Ativação: `docker compose --env-file deploy/.env -f docker-compose.yml up -d --no-deps frontend`. Container novo `49a1bd01efd085c24ef41bfda5522077c8b9910d69fc0e0e4e6824b3292b4a3e`, iniciado às `2026-10-04T09:33:03.553378878Z` (06:33:03 em São Paulo). Frontend com zero restarts. Backend original `2b4900ff5d9fa5ce85a79ebd29f752818d579c57c61a97359241efd8219e7ad8`, ainda saudável, sem reinício e com mesmo horário de início.
- Smoke externo com TLS normal: Hub e portas 8444–8452 retornam player 200, header de isolamento e API 200. POST `/_frontend/events` com Origin correto retorna 204 em todas as dez origens. Bundle servido contém a implementação nova do observador.
- Dez eventos **sintéticos identificados como `deployment.frontend-collector-smoke`**, sem seed/RNG inventados, conferidos no stdout de `emulator-hub-frontend-1`. Nenhum desses eventos consta no backend. `nginx -t` aprovado no container ativo.
- Política global de Docker consultada: `json-file`, `max-size: 10m`, `max-file: 3`. Não alterada. A janela visível depende dessa retenção; não foi criada persistência separada de telemetria.

Evidência local: `test-data/frontend-observability/deploy-20261004/production-verification.json` e `production-frontend-events.log`; cópias mantidas junto dos backups na VPS. As páginas precisam carregar o novo bundle antes de emitir RNG. Nenhum jogo/save de usuário foi aberto ou modificado pelo smoke. Não se afirma que o RNG de uma caça real já tenha sido observado nessa produção atualizada.

## Revisão da evidência e plano de cache de ROM/IPS — 2026-10-04

**Solicitação atual:** planejar armazenamento local de ROM/IPS, compartilhado entre as nove instâncias, e esclarecer se isso resolve o RNG observado em produção. Esta seção é um plano; nenhuma mudança de cache, novo build ou novo deploy foi executado.

**Correção da conclusão anterior:** a fixture E2E usa os módulos reais de coleta e reset e o core real, mas configura URLs de arquivos nomeados, em vez de executar `main.jsx → player.js → Blob da ROM + Blob do IPS`. Ela qualificou os cenários de core/coleta descritos acima; não qualificou a entrega do IPS pelo lançamento real da aplicação. O item T4 anterior não satisfaz sozinho a aceitação de ponta a ponta desse lançamento. Importar módulos do produto não substitui exercitar sua composição e suas entradas reais.

O arquivo fornecido pelo usuário, `C:/Users/dm3o/AppData/Local/Temp/emulator-hub-frontend-1-2026-10-04T09-44-03.log`, contém 80 eventos de reset Emerald com `patchApplied: true`, `seed: null` e `missed-window`. As 1.280 amostras desses eventos seguem a sequência inicial do LCG a partir de zero, com relação consistente entre frames e passos, apesar de diferentes relógios virtuais. Isso é evidência forte de ausência de reseed RTC nesse caminho; não é observação direta da seed inicial. O campo atual `patchApplied` resulta da presença de `launchDescriptor.patchSha256` após download verificado, sem conferir a ROM usada pelo core.

### Base de código e decisões

- `apps/frontend/src/player.js`, `start()`: ROM e IPS são buscados em cada abertura com `cache: 'no-store'`, validados por SHA-256 e convertidos em dois Blob URLs independentes. Abrir nove Emerald provoca nove requisições da ROM e, quando registrado, nove do IPS. Resets dentro do mesmo core não repetem esse download.
- `apps/frontend/src/main.jsx`: nove players usam origens distintas; `findTrustedPlayerFrame` já delimita mensagens por janela e origem. `player-origin-storage-bridge.mjs` demonstra comunicação com o Hub, mas seu armazenamento é de recuperação de saves e não deve receber ROMs.
- `apps/packages/game-patches.mjs`: registro por hash de ROM e validação estrutural do IPS já existem, mas esse módulo depende de Node/Buffer e não aplica IPS no navegador. `rom-fix-applier.mjs` aplica receitas de bytes, não IPS; não conectar a proposta anterior de fix dinâmico a esta tarefa.
- `assets/ips/manifest.json`: identidade dos dois arquivos já está disponível no descriptor. A versão da ROM é seu SHA-256; a versão do IPS é seu SHA-256. Não criar versionamento por nome ou repetir download para descobrir a versão.
- No EmulatorJS 4.2.3, `downloadGameFile` grava dados não comprimidos usando o nome extraído da URL; dois Blob URLs perdem os nomes/extensões associados. Essa diferença frente à fixture é verificável. Sua responsabilidade causal pelo não reseed ainda exige reprodução pelo produto e inspeção da ROM efetiva.

**Alternativas avaliadas:** cache HTTP/Service Worker por player mantém a separação por origem e amplia a configuração; IndexedDB por player também mantém nove caches; IndexedDB na origem do Hub, com entrega aos players, atende ao compartilhamento usando a comunicação já presente. Recomenda-se a terceira. Além disso, aplicar IPS previamente evita depender da descoberta de um segundo arquivo pelo runtime. Cache sozinho apenas repetiria os mesmos bytes e a mesma configuração problemática.

### Contrato proposto

**Objetivo:** um download de cada conteúdo ausente, reutilização após recarregar o Hub e entrega explícita de uma ROM pronta ao EmulatorJS, preservando perfil, lease e save.

**Arquitetura:** o Hub possui um IndexedDB separado, `emulator-hub-game-assets`, versão 1, store `assets`, com chave `sha256`. Ele guarda somente ROM original e IPS verificados. Uma fila de promessas por hash agrupa os nove pedidos simultâneos. A ROM preparada é produzida uma vez por combinação `(romSha256, patchSha256 ou null, ips-v1)` e compartilhada em memória durante a vida do Hub; não é necessário persistir uma terceira ROM nem alterar o backend para registrar um digest derivado.

**Tecnologias:** React existente, módulos JavaScript em `apps/packages/`, IndexedDB, Web Crypto e postMessage; nenhuma nova dependência de runtime, servidor, Service Worker ou interface.

**Execução futura:** implementar inline com `superpowers:executing-plans`, tarefa por tarefa, após a revisão deste plano. Permanecer no checkout original e nesta spec. Commit e deploy dependem de solicitação correspondente; não fazem parte do planejamento atual.

Requisitos transversais:

1. O descriptor de lançamento continua vindo do endpoint existente, com lease válido, a cada abertura. Transferir essa leitura ao Hub pelo bridge evita uma segunda consulta ao backend; persistir assets não persistirá permissões, descriptors, saves ou snapshots.
2. O bridge tem duas operações: `get-launch` consulta o endpoint para a sessão ativa e retorna descriptor com um token efêmero; `prepare-rom` usa esse token e o descriptor guardado no Hub. O player não escolhe URL nem solicita conteúdos de outra sessão. Validar `source`, `origin`, frame, sessão, perfil, game e geração; responder somente à origem conferida.
3. O cache armazena `{ sha256, bytes, byteLength }`. Verificar bytes pelo hash do descriptor ao ler do disco e antes de gravar. Registro inválido é removido e recebe uma tentativa de novo download. ROM incorreta é erro de lançamento; IPS ausente, incompleto, inválido ou indisponível é enhancement ignorado com log, seguindo com ROM original.
4. Promessas de download e preparação são compartilhadas no Hub. Usar Web Locks por hash, quando disponível, para impedir downloads concorrentes em outras abas da mesma origem; após adquirir o lock, reler o IndexedDB. Sem Web Locks, a garantia de um download vale para as nove instâncias do mesmo Hub.
5. Falha/quota/bloqueio do IndexedDB degrada para cache em memória e download verificado. Não impedir jogo válido por falha de persistência. Não solicitar permissão de armazenamento nem criar controles de cache. O navegador pode apagar seus dados; nesse caso, reconstruir o cache.
6. IPS é aplicado sobre uma cópia, nunca sobre a ROM original. Suportar registros normais, RLE, expansão preenchida por zero e truncamento opcional após EOF; rejeitar EOF ausente, payload incompleto, RLE zero e saída acima de `maxOutputBytes`. O limite concreto de saída por lançamento será `max(romBytes.byteLength, 0x100FFFE)`: maior final de registro possível com offset de 24 bits e tamanho de 16 bits, preservando ROMs originais maiores. Registros sobrepostos obedecem à ordem do IPS, com a última escrita prevalecendo.
7. Entregar uma cópia independente dos bytes finais a cada iframe e criar o Blob URL nessa origem. Usar somente `EJS_gameUrl`; não configurar `EJS_gamePatchUrl` nesse caminho. Configurar `EJS_CacheLimit = 0`, confirmado em `loader.js`/`emulator.js` 4.2.3, para impedir que `storage.rom.put` persista nove Blobs com chaves aleatórias. Essa opção não substitui o isolamento de saves nem desliga globalmente os caches de core/BIOS. Fechar um player remove seu pedido e URL, sem cancelar download necessário aos demais ou transferir o buffer que o cache ainda usa.
8. A nova versão é determinada pelo descriptor fresco: hash novo é entrada nova; remover registro da versão anterior somente quando a nova versão do mesmo asset tiver sido verificada e não estiver em uso. Ausência/remoção de IPS no descriptor resulta imediatamente em ROM original, mesmo que exista patch antigo no disco.
9. Falha/timeout do bridge usa o mesmo preparador no player com download verificado, preservando o lançamento. Nesse modo excepcional não prometer deduplicação entre origens. Conservar o isolamento de saves em MEMFS e o fluxo de 404 de perfil novo.
10. Acrescentar evento `game-asset` à whitelist do coletor atual: fase, origem `network/disk/memory`, hashes da ROM original, IPS e ROM entregue, aplicação/skip do patch, motivo, bytes e duração. RNG/reset deve usar o resultado efetivo da preparação para `patchApplied`, nunca somente a presença do hash no descriptor. Preparação bem sucedida prova transformação dos bytes; RNG funcionando exige a evidência de execução abaixo.

Referências de plataforma: [IndexedDB e isolamento por origem](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [Web Locks entre abas da mesma origem](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API), [EmulatorJS 4.2.3](https://cdn.emulatorjs.org/4.2.3/data/src/emulator.js).

### Plano de implementação

Review focus: nove aberturas concorrentes; update/remoção de patch com cache preenchido; storage corrupto/indisponível; fechamento ou troca de sessão durante download; cache válido entregando ROM original ao runtime. Os testes abaixo exercitam cada condição.

#### C1 — Reproduzir pelo lançamento do produto antes de corrigir

Arquivos: ampliar `apps/tests/frontend-observability/run.py` e `README.md`; criar `apps/tests/frontend-observability/hub-launch.py` para a preparação do ambiente de teste, sem criar outro player/HTML de emulação.

- [ ] Executar o frontend real com `src/main.jsx`, `src/player.js`, APIs do backend real, nove origens e EmulatorJS 4.2.3 em ambiente descartável com volumes próprios. Usar o runner/script de ambiente existente, incluindo o proxy de origens. Usar ROM privada verificada, IPS do registro e perfis de teste; nunca saves ou leases de produção.
- [ ] Abrir o jogo pelo seletor real; registrar descriptor, requisições, configuração EJS, nome do arquivo passado ao core e hash/bytes desse arquivo no `gameManager.FS`. Comparar a entrada efetiva do runtime com o resultado independente de `test-data/create_emerald_rtc_rng_fixed.py:patch_rom`. Ler do runtime seu arquivo efetivo, não recalcular o hash só da variável de entrada do player. O arquivo no FS prova a entrada; um core pode aplicar patch em memória sem alterar esse arquivo, portanto FS original sozinho não prova ausência de patch no core. Não inventar um leitor de ROM mapeada que a API inspecionada não oferece.
- [ ] Demonstrar o comportamento atual com IPS via Blob e controle sem IPS, correlacionando arquivos/configuração e execução do RNG. Guardar todos os eventos/limitações, sem descartar tentativas que perderam a janela. Se a entrada já for corrigida, ou os resets atuais já mostrarem reseed RTC, rejeitar a hipótese correspondente e investigar execução do hook/RTC ou a diferença frente à caça de produção antes de atribuir a correção ao cache.
- [ ] Criar as asserções inicialmente falhas: um download para nove origens e ROM efetiva igual à referência corrigida. Manter a fixture anterior apenas como teste de componente, identificada assim no relatório.

#### C2 — Parser e preparação explícita da ROM

Arquivos: criar `apps/packages/ips-patch.mjs` e `.test.mjs`; ajustar `game-patches.mjs` e `.test.mjs` para reutilizar validação estrutural sem alterar descoberta/registro; criar `game-rom-preparation.mjs` e `.test.mjs`.

Interfaces: `isValidIps(bytes: Uint8Array): boolean`; `applyIpsPatch(romBytes, patchBytes, { maxOutputBytes }): Uint8Array`; `prepareGameRom({ romBytes, patchBytes, romSha256, patchSha256, hash }): Promise<{ bytes, effectiveRomSha256, patchApplied, patchSha256, reason }>`; `hash` recebe bytes e retorna SHA-256 hexadecimal. Ausência/skip retorna `patchSha256: null`; original verificada é obrigatória.

- [ ] Testes vermelhos para formatos/bounds acima, registros sobrepostos, ROM original imutável e aplicação única; comparar digest completo e bytes do hook/cave com o gerador Python independente usando ROM privada no E2E.
- [ ] Implementar o parser/preparador sem branches de título. Tratar mismatch da ROM como fatal; erro opcional do IPS como original verificada + motivo.
- [ ] Executar `node --test apps/packages/ips-patch.test.mjs apps/packages/game-patches.test.mjs apps/packages/game-rom-preparation.test.mjs`; exigir aprovação integral e ausência de mutação/double patch.

#### C3 — Cache compartilhado e bridge

Arquivos: criar `apps/packages/game-asset-cache.mjs` e `.test.mjs`, `game-asset-storage.mjs` e `.test.mjs`, `player-origin-asset-bridge.mjs` e `.test.mjs`; integrar criação/teardown e handler em `apps/frontend/src/main.jsx`.

Interfaces: `createGameAssetStorage({ indexedDB }).get(sha256)/put(record)/delete(sha256)/close()`; `createGameAssetCache({ storage, fetchAsset, hash, locks }).get({ sha256, url }): Promise<{ bytes, source }>`; `createPlayerOriginAssetClient({ browser, parent, hubOrigin, sessionId, profileId, gameId, generation, timeoutMs: 30000 }).getLaunch()/prepareRom(launchToken)/dispose()`; `respondToPlayerAssetRequest(event, { frame, session, origin, launchLoader, assets, preparation })`. `getLaunch` retorna `{ launch, launchToken }`; `prepareRom` retorna o resultado de C2. O handler mantém descriptors/tokens apenas durante a sessão e revalida sua existência após awaits.

- [ ] Testes vermelhos: nove solicitações → um fetch; duas abas com lock → um fetch; falha não envenena próxima tentativa; hash errado de disco → remover/refetch; update/remoção de IPS; quota → memória; origem/source/session/generation/token inválidos → nenhuma leitura ou entrega; fechar um dos nove → oito continuam; resposta tardia → ignorada.
- [ ] Implementar IndexedDB separado e cache com promessas compartilhadas; persistir só depois de verificar. Tratar rejeição/blocked da abertura sem prender o lançamento. Preparar a ROM em memória uma vez por combinação; copiar por player para manter os buffers vivos no Hub.
- [ ] Executar `node --test apps/packages/game-asset-storage.test.mjs apps/packages/game-asset-cache.test.mjs apps/packages/player-origin-asset-bridge.test.mjs`; validar persistência também no navegador real em C5, pois doubles não provam IndexedDB/origens.

#### C4 — Consumir no player e registrar identidade efetiva

Arquivos: `apps/frontend/src/player.js`, `apps/packages/frontend-events.mjs` e `.test.mjs`; criar `apps/frontend/player-game-assets.test.mjs`; ampliar `player-startup-failure.test.mjs`, `player-memory-save-startup.test.mjs`, `player-close-snapshot.test.mjs` e testes de bridge/reset relevantes.

- [ ] Testes vermelhos para bridge nos players de mesma origem e origens distintas, fallback, cleanup do Blob, ausência de `EJS_gamePatchUrl`, limite zero de cache de ROM do EmulatorJS e metadata efetiva em RNG/snapshots quando IPS é ignorado.
- [ ] Substituir os downloads em `start()` pelo bridge e preparador; carregar save/snapshots em paralelo com `prepareRom`, após descriptor fresco. Usar a ROM final no Blob. Quando enhancement falha, conservar as verificações existentes de incompatibilidade de snapshot; não declarar patch aplicado no log ou na metadata de state.
- [ ] Ampliar whitelist com `effectiveRomSha256`, `assetSource`, `assetBytes` e fases/motivos definidos; logs passam por `/_frontend/events`, nunca por novo endpoint do backend. O valor de `patchApplied` no reset vem da preparação efetiva.
- [ ] Rodar os testes alterados mais save/lease/reset/origens e lint dos arquivos envolvidos. Não considerar match de texto do source prova suficiente do lançamento.

#### C5 — Aceitação E2E pelo sistema real

- [ ] Cache vazio, nove players Emerald em origens distintas: contar exatamente uma resposta de download da ROM e uma do IPS no servidor e no navegador; os nove arquivos de entrada efetivos do runtime devem ter o digest completo da referência Python. Conferir que nenhum dos players gravou nova ROM em `EmulatorJS-roms`. Não contar descriptor, save, runtime CDN ou logs como download de ROM/IPS.
- [ ] Fechar players e recarregar o Hub no mesmo browser context: nove novos lançamentos usam IndexedDB com zero download de ROM/IPS. Interceptar somente as rotas de assets para falhar e comprovar inicialização, mantendo backend/leases/saves acessíveis.
- [ ] Trocar hash do IPS no registro de teste: obter somente o novo patch, reutilizar ROM e conferir novo resultado. Trocar ROM exige novo download; remover IPS usa original; corrupção local refaz apenas asset corrompido; quota/falha de disco permite lançamento com log; patch 404/mismatch/malformed inicia original e informa skip.
- [ ] Soft e hard reset pelo controle real de Shiny Hunt, relógios fixos e minutos diferentes: a 1×, exigir seed observada igual ao cálculo RTC independente em pelo menos uma janela qualificada de cada cenário, preservando todas as tentativas; limite de cinco tentativas e falha da suíte se não houver prova. Controle original deve qualificar seed zero. Comparar evento por sessão/ciclo com stdout do container do frontend.
- [ ] Rodar também nove instâncias, 5× e threads reais. Janela perdida mantém seed null; exigir RNG/amostras/log correlacionados e ROM efetiva corrigida. Não reduzir velocidade ou pausar a caça em produção para esconder a limitação do observador.
- [ ] Em todas as nove instâncias, comparar saves e perfis com backend; perfil sem save deve ter MEMFS vazio; fechamento/cancelamento deve preservar fencing/lease e não duplicar save de outro perfil. Eventos de assets/RNG devem aparecer somente no coletor do frontend.
- [ ] Executar no ambiente Linux/WSL do projeto, selecionando os testes afetados; guardar comandos, SHA/snapshot dos arquivos, hashes dos assets, respostas de rede, arquivo efetivo do core e stdout. Um teste sobre Vite qualifica desenvolvimento. Quando build/deploy forem solicitados, repetir o mesmo fluxo com o bundle/imagem exatos e ambiente descartável Nginx antes de ativar produção; HTTP 200/smoke sintético não substituem esse fluxo.

### Critério de resolução

O cache resolve downloads repetidos, latência e parte das falhas transitórias de obtenção de assets. Ele não muda seed, RTC ou a aplicação de um IPS já baixado. A preparação explícita remove a dependência da descoberta automática do IPS pelo EmulatorJS e permite conferir a ROM realmente entregue. O problema de RNG só será declarado resolvido após o lançamento real produzir a ROM corrigida e resets qualificados mostrarem reseed coerente com RTC. Se a ROM corrigida continuar seguindo a trajetória inicial de zero, investigar hook/RTC/reset: o cache estará funcionando, mas o defeito de RNG continuará aberto.

## Execução autorizada — ledger

2026-10-04: usuário autorizou implementação baseada em testes. Base `bfd0722255e632b0abe19ffd4fa2f936d4a39d83`, checkout original `D:/PROJETOS/emulator-hub`, branch `master`; mudanças anteriores preservadas. Sem autorização atual para commit/build/deploy.

Ruling: incorporar prefetch ao abrir o aplicativo, em Web Worker da origem do Hub, conforme orientação posterior do usuário. O catálogo precisa expor hashes/URLs de assets verificados, sem obter lease para prefetch. Hash/preparação/IndexedDB rodam no worker; se indisponível, executar os mesmos módulos em memória no Hub. Logs seguem o coletor frontend. Isso substitui a preparação somente na abertura do player e exige pequeno acréscimo de metadata ao catálogo existente.

Ruling: usar runner Node/Playwright já instalado no projeto para E2E do Hub real, em Linux/WSL, sem uma nova instalação Python ou HTML alternativo. Nome `apps/tests/frontend-observability/hub-launch.mjs`. A referência de patch/seed permanece independente, com o gerador Python privado existente e cálculo RTC de teste.

Pre-flight: C2 produz bytes/digest/estado de patch; C3 entrega exatamente esse resultado; C4 usa resultado efetivo nos snapshots/RNG; C5 verifica entrada FS e execução, sem equiparar arquivo original a ausência de patch aplicado em memória pelo core. Worker e bridge serão reutilizados pelo prefetch e pelo lançamento.

### Validação e entrega de 2026-10-04

O usuário corrigiu o ambiente: validar este repositório pelo Windows nativo; WSL fica restrito ao IEBridge. Também autorizou concluir e publicar em produção. Isso substitui as escolhas anteriores de WSL e a ausência de autorização de build/deploy neste ledger. Não há pedido de commit.

O runner do Hub real usa a interação existente de adicionar várias instâncias: o seletor permanece aberto até a nona. A ROM lida no FS de cada core é comparada integralmente com a saída do gerador Python independente. Não são usados HTML ou fluxo de lançamento alternativos.

O observador passivo pode perder o instante exato do seed, sobretudo em hard reset; nesse caso o evento mantém `seed: null`. A aceitação de reseed compara pelo menos quatro amostras reais da trajetória LCG com o seed RTC calculado independentemente, exige a mesma origem de frames e rejeita a trajetória de seed zero. Não transformar seed inferida em observada. Esta evidência substitui exigir seed diretamente observada em todo cenário.

Windows: `node --test --test-concurrency=2 apps/frontend/*.test.mjs apps/packages/*.test.mjs apps/frontend/server/*.test.mjs apps/backend/test/server.test.mjs`: 1100 passaram, zero falhas, dois testes de symlink indisponíveis no Windows foram skipped. Lint dos módulos alterados e `git diff --check` passaram. A revisão identificou IPS pendurado: corrigido com espera opcional máxima de 5 s e regressão passando; a ROM válida continua disponível e a preparação sem IPS não é cacheada.

`node apps/tests/frontend-observability/hub-launch.mjs`: passou prefetch em Worker antes de abrir player, nove origens/cores com ROM corrigida e somente um download de ROM e IPS, soft/hard reset com trajetória RTC, Shiny Hunt real dos nove players com eventos no stdout frontend, e reload usando IndexedDB sem novos downloads. Artefatos privados: `test-data/frontend-observability/hub-1791111668149-14688`.

`--image` repete o mesmo teste na imagem Nginx compilada para produção, em container descartável na VPS e backend de teste isolado por túnel. Não usa perfis ou saves de produção. Rollback mantém as imagens anteriores e backup de fonte; backup backend pré-deploy retornou 201, com 25 saves e 19865 registros Redis. Nenhum lease ativo na verificação pré-deploy.

Entrega concluída: o E2E `--image` passou todos os cenários acima; evidência `test-data/frontend-observability/hub-1791111835805-18076`. Oito amostras coerentes com RTC em cada reset (seeds esperadas 48012 e 48015; seed diretamente observada permaneceu null, corretamente). Frontend ativado: `sha256:b3f3e90b560f4ed7aca405c1a98118d5d8266220180beab20e1560aba89dab8f`; backend: `sha256:4db8d742d17a503c1e64bf37ac8f4719533e5d60af41bd6248ef07b4ac9881ac`. Compose aguardou saúde e ambos estão running. Catálogo público respondeu 200 com hashes da ROM/IPS iguais aos testados. No navegador Windows acessando produção, os dois assets completos foram conferidos no IndexedDB com SHA256 independente; eventos `asset-ready` foram confirmados no stdout do container frontend.

Limitação de verificação pós-deploy: Chrome pode expulsar ROM de 16 MiB do cache de inspeção de rede; `response.body()` falhou por essa razão. A confirmação foi feita lendo e calculando SHA256 dos registros efetivamente persistidos pelo Worker no browser, e passou. Nenhum save/perfil de produção foi alterado pelo smoke.
