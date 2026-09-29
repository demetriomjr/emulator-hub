---
title: Pokémon Hub end-to-end snapshot integrity
date: 2026-09-28
tags: [spec, pokemon-hub, playwright, snapshots, concurrency]
status: active
---

# Spec 084 — Integridade end-to-end dos snapshots do Pokémon Hub

Este é o spec canônico desta conversa. A suíte fica em `apps/tests/pokemon-hub`. O runner inicia backend e Vite localmente, cria ROM e saves Gen III sintéticos em diretório temporário, usa persistência Redis em memória e grava `test-results/runtime/<run-id>/backend.ndjson` e `frontend.log`. Cada execução preserva seus próprios logs. Não lê nem altera saves do usuário. As transferências entre Saves, perfis Hub e slots são **estímulos**; o objeto principal do teste é detectar snapshot divergente, Pokémon duplicado ou perdido, race condition e gargalo.

## Oráculos de integridade

1. Em cada payload canônico enviado pelo navegador e recebido como correção, os panes têm IDs únicos e placements ocupados válidos. A mesma chave de idempotência nunca representa dois payloads diferentes. Cada request termina com resposta e status esperado, exceto quando o caso injeta explicitamente perda ou retenção da resposta.
2. Antes e depois de cada sequência, comparar o multiconjunto global de IDs do Save e dos perfis Hub envolvidos. O ID pode mudar de slot ou source, mas não pode desaparecer, aparecer duas vezes nem ser substituído.
3. Após confirmação e fechamento, comparar autoridade do backend, layout reaberto e `.sav` materializado. Um estado visível no navegador isoladamente não prova persistência.
4. A auditoria por teste anexa requests, revisões, chaves, status, tempos e eventos do backend. Qualquer erro no backend reprova o caso. Respostas de snapshot no fixture isolado têm limite de 5 s; p95 e máximo são registrados para diagnóstico, sem tomar esse limite como benchmark de produção.
5. Injetar atraso e replay em pontos controlados. Os testes usam perfis separados e um worker para evitar interferência acidental. Fechamento deve drenar operações pendentes e liberar o source antes da próxima abertura.

## Cobertura automatizada atual

- **Baseline de persistência:** movimento dentro do Save, swap, Party/Box, Save→Hub→Save, Save→Save, Save→Hub→Hub e Box 2. Em todos, auditar cada snapshot de rede; comparar IDs finais e bytes `.sav` ou grid Hub. São fluxos de preparação e integridade, não testes da política de negócio.
- **Operações rápidas:** três drags seguidos de fechamento imediato; fechamento de pane após drag; drop cancelado; destino ocupado e outras operações recusadas sem alteração de bytes. O objetivo é encontrar snapshot parcial ou persistência inesperada.
- **Confirmação atrasada:** backend aceita primeiro snapshot; resposta fica retida enquanto ocorre segundo drag; fechamento drena e o multiconjunto global permanece íntegro.
- **Replay:** reenviar o mesmo payload e a mesma chave após aceitação deve responder sem executar outra mutação.
- **Revisão obsoleta:** enviar snapshot antigo com nova chave deve receber correção 409 íntegra; fechar deve preservar o movimento já aceito.
- **Força repetida e aleatória:** 24 drags alternados, 100 drags pseudoaleatórios entre 15 slots e 30 transferências pseudoaleatórias entre dois Saves e um perfil Hub. Seeds fixos e modelo de slots tornam a falha reproduzível. Ao final, comparar todos os IDs, grids e records físicos dos Saves.
- **Ciclo de sessão:** seis fechamentos/reaberturas que movem Eevee em ambos os sentidos; cada sessão deve ter ID novo, lease anterior liberado e espécie 133 no slot físico esperado.
- **F5 com sessão aberta:** após ack de snapshot, recarregar a página, aguardar a expiração/flush da sessão abandonada, reabrir o Save e verificar Eevee, ID, novo session ID e bytes.
- **Concorrência de requests:** oito POST simultâneos com o mesmo payload/chave; doze POST obsoletos simultâneos com chaves diferentes; segunda sessão tenta adotar Save ocupado e consegue após o close da primeira.
- **Ack perdido após commit:** o Playwright deixa o backend aceitar o snapshot e aborta apenas a resposta ao navegador. Após expiração, o Save físico deve conter Eevee uma única vez e permitir nova sessão.
- **Janelas de reload:** F5 antes do debounce e com confirmação retida depois do commit. O primeiro admite estado antigo ou novo, mas exige exatamente um Eevee e nova sessão; o segundo exige o Eevee no destino após recovery.
- **Correção 409 na UI:** interceptar o primeiro snapshot, enviar revisão obsoleta, exigir que a UI desfaça o movimento otimista e aceite uma nova tentativa. O caso revelou que a reconciliação procurava o Save com uma chave diferente da usada pela UI; a chave foi alinhada e o cenário passou.
- **Lease expirado:** F5 antes do debounce revelou `HUB_LEASE_INVALID` no observador de sessões expiradas. O caminho de limpeza agora tolera esse código somente quando a própria sessão já expirou; o teste exige zero erro de backend.
- **Concorrência visível:** duas abas reais disputam o mesmo Save; a segunda recebe 409 e consegue carregá-lo após o close da primeira. Fechar pane de origem com ack retido deve drenar o movimento e liberar ambos os Saves.
- **Fila sem coalescência:** doze movimentos aguardam a confirmação individual de cada snapshot; revisões aceitas crescem e a fila drena antes do close.
- **Payloads adversariais:** dois snapshots válidos da mesma revisão enviados em paralelo têm apenas um vencedor; IDs duplicados, ausentes ou desconhecidos recebem correção íntegra; reutilizar chave com payload diferente não aplica mutação nova.
- **Falha transitória no flush:** uma escrita do `.sav` falha de forma injetada no fechamento; o observador tenta novamente após expiração, grava Eevee uma vez e libera o lease. Executar com `npm run fault`, separado da suíte normal.
- **Reinício do backend:** depois do aceite do snapshot, reiniciar o servidor na mesma porta mantendo a persistência; o close da sessão antiga faz flush, e a reabertura cria outro session ID com Eevee no slot físico correto.
- **Seletor do Hub:** vinte ciclos de abertura e fechamento do perfil Hub verificam que o seletor e o estado da sessão não ficam presos após manipulação repetida.
- **Drag interrompido:** `Escape` enquanto o ponteiro está sobre um destino fecha o Hub sem aceitar aquele movimento; o Save físico, os IDs e os slots permanecem iguais. O cenário revelou que o close podia levar ao backend a posição local do drag ainda ativo sem POST de snapshot; o cancelamento foi ligado ao fechamento e ao evento final do drag.
- **Painel Hub em voo:** fechar o painel Hub de destino com a confirmação de transferência retida drena a operação e deixa o Pokémon uma única vez no perfil Hub, com o Save físico atualizado.

`npm run stress -- 5` executa cinco rounds com seeds diferentes, backend/fixture novo por round e logs preservados por execução. O primeiro erro interrompe a campanha e mantém os artefatos da falha. Foram concluídos 34 rounds de 130 movimentos cada (4.420 movimentos). Os dez últimos rounds, executados após a correção do drag cancelado, produziram 394 respostas de snapshot, zero eventos de erro no backend e máximo de 110,42 ms. Uma execução intermediária parou antes de mover Pokémon porque o clique no seletor do perfil Hub não efetivou a escolha; o mesmo seed passou isoladamente e os vinte ciclos específicos passaram. A causa dessa intermitência do seletor continua aberta; ela não foi classificada como erro de snapshot.

## Próximas campanhas, em ordem de risco

| ID | Estímulo | Falha que o oráculo deve identificar |
| --- | --- | --- |
| R01 | Alternar dois drags antes do debounce de 500 ms, em mesma Box | Snapshot enviado parcialmente; intenção perdida. |
| R02 | Save→Hub→Save com ack do primeiro snapshot atrasado | Mesmo ID em Save e Hub; revisão do segundo movimento obsoleta. |
| R03 | Save A→Save B e movimento imediato em B | Source A não descarregado; perda na materialização. |
| R04 | Três panes, cadeia A→B→C, seguida de movimento inverso | Duplicação transitória ou final nos panes. |
| R05 | Swap ocupado sob sequência rápida de outros drags | Um dos records substituído. |
| R06 | Drag iniciado e pane de origem fechado antes do mouseup | Intenção aplicada a source removido. |
| R07 | Drag concluído e pane de origem fechado com sync em voo | Close libera lease antes do commit/flush. |
| R08 | Pane destino fechado ou perfil trocado com sync em voo | Snapshot antigo contamina source novo. |
| R09 | Fechar Hub antes do debounce, durante request e durante ack atrasado | Última intenção perdida; close travado. |
| R10 | Fechar e reabrir imediatamente o mesmo Save/perfil Hub | Lease antigo persiste; layout reaberto difere do `.sav`. |
| R11 | Recarregar aba após ack, antes do flush e após close | Visão local diverge da autoridade. |
| R12 | Duas abas tentam abrir e mover o mesmo source | Fence/lease permite dois escritores. |
| R13 | Duas abas usam sources distintos e mesmo owner | Estado de sessão cruzado. |
| R14 | Backend aceita snapshot e resposta ao navegador é perdida | Retry muda chave/payload ou aplica operação duas vezes. |
| R15 | Repetir chave e payload em paralelo, antes do primeiro commit | Duas operações aceitas. |
| R16 | Repetir chave com payload diferente | Segunda mutação aceita indevidamente. |
| R17 | Enviar duas revisões concorrentes em ordem inversa | Revisão velha sobrescreve a mais recente. |
| R18 | Receber 409 de revisão obsoleta durante drag subsequente | UI mantém seleção ou source obsoleto. |
| R19 | Abortar request no upload, depois de commit e durante close | Estado pendente sem recuperação. |
| R20 | Rede offline/online durante debounce, sync e flush | Retry infinito, duplicação ou fechamento falso. |
| R21 | Latência crescente de backend em sequência de 10/50 movimentos | Fila cresce, p95/max disparam, requests nunca drenam. |
| R22 | Falha injetada entre gravação de sources, placements e evento | Commit parcial ou recuperação divergente. |
| R23 | Falha no flush `.sav` após snapshot aceito | UI declara persistência inexistente. |
| R24 | Expiração de heartbeat e nova sessão com Save dirty | Writer anterior ainda altera o Save. |
| R25 | Reinício do backend após aceite e antes de flush | Recovery perde ou duplica Pokémon. Caso implementado e passou isoladamente. |
| R26 | Perfil Hub removido/renomeado durante request | Placement órfão ou pane com ID errado. |
| R27 | Coordenadas rápidas, drop fora, Escape e pointer cancel | Snapshot dirty sem intenção completa. Escape e drop fora têm cobertura; pointer cancel físico permanece pendente. |
| R28 | Navegar de Box durante drag | Índice físico incorreto; gravação em outro slot. |
| R29 | Payload canônico com ID/slot duplicado, pane faltando e source não carregado | 4xx/409 sem mutação parcial. |
| R30 | Reexecutar campanhas sob Redis real descartável e browser paralelo | Corridas ocultas pela persistência em memória. |

## Execução

Em `apps/tests/pokemon-hub`, `npm test` inicia os serviços e executa Chromium com Playwright, sem build. Os artefatos ficam ignorados pelo Git. Os casos R12, R21–R25 têm cobertura parcial ou controlada no runner atual; R30 ainda pede Redis real descartável e browser paralelo. A tabela registra riscos e não transforma cobertura parcial em resultado comprovado.

## Evidência da execução integral

Em 2026-09-29, `npm test` concluiu **38/38** casos em Chromium após a correção do drag cancelado. O log `test-results/runtime/2026-09-29T09-20-04-196Z-6716/backend.ndjson` contém 120 respostas de snapshot: 101 com 200 e 19 correções 409. Foram 0 eventos de erro; p95 de 20,07 ms e máximo de 73,51 ms. As advertências pertencem a correções, disputas de lease e rejeições adversariais esperadas. `npm run fault` concluiu **1/1** caso com falha de flush injetada e recuperação posterior; `node --test apps/packages/pokemon-hub-session-view.test.mjs` concluiu **6/6** testes da reconciliação. `git diff --check` não indicou erro de whitespace, apenas avisos de normalização LF/CRLF.

Os números de latência são do backend local com Redis em memória e Saves sintéticos, em um worker. Eles não medem concorrência com Redis real, disco de produção ou múltiplos processos de backend. A intermitência observada na escolha do perfil Hub durante uma campanha continua sendo um risco de interface a investigar.
