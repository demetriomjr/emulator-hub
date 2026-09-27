---
title: Pokemon Hub integrity and infrastructure simplification
date: 2026-09-26
tags: [spec, pokemon-hub, saves, snapshots, leases, integrity]
status: proposed
---

# Spec 075 — Pokémon Hub: integridade, simplificação e plano de investigação

## Como usar este documento no próximo chat

Este é o **único spec de trabalho** desta investigação no projeto Emulator Hub. Consolida o diagnóstico do incidente, o relatório literal do subagente Astra e quatro revisões críticas do plano. A seção anterior ao apêndice é o entendimento vigente; o apêndice preserva palavra por palavra a análise original do Astra como registro histórico, inclusive propostas que foram refinadas depois. Em caso de diferença, prevalece o contrato consolidado nesta seção, seguido dos Specs de produto citados.

**Estado do trabalho:** somente análise e redação. Nenhum código do produto, dado de produção, configuração, deploy ou build foi alterado por este trabalho. O spec não autoriza implementação. O usuário pediu uma solução coesa, enxuta e íntegra, construída ponto por ponto, aprofundando cada tópico até fechar seus requisitos e provas de conceito antes de avançar. Ele rejeitou planos rasos e arquivos paralelos. O trabalho seguinte deve continuar **neste arquivo**, não gerar novos specs sobre o mesmo problema.

**Repositório:** `D:/PROJETOS/emulator-hub`. **Arquivo do incidente:** `C:/Users/dm3o/AppData/Local/Temp/emulator-hub-backend-1-2026-09-26T15-45-04.log`. **Astra:** auditou HEAD `59ad053`; seu texto literal começa no apêndice. **Levantamento ampliado:** leitura do código em HEAD `bf6a82c` e da árvore de trabalho em 27/09/2026; há edições paralelas em outros arquivos, portanto cada afirmação sobre o estado atual deve ser reconferida antes da implementação. **Regra local:** `AGENTS.md` exige contratos em `.spec/`, build apenas se pedido no prompt atual e commit apenas se pedido no prompt atual.

## Objetivo e limites

Preservar a experiência e as regras atuais do Pokémon Hub, reduzindo autoridades duplicadas e caminhos de escrita. Um movimento aceito entre save e Hub, ou entre saves permitidos, conserva os IDs, admite retry após resposta perdida e continua recuperável após close, expiração e crash. O backend é autoridade para IDs, records nativos, placements, ownership e publicação do `.sav`. Snapshot canônico de workspace e runtime state do emulador são artefatos distintos.

“100% de integridade” significa não aceitar perda, duplicação, substituição ou acesso a save desatualizado nos cenários definidos e ensaiados. Não há prova finita para toda falha imaginável. Durabilidade física de um ACK depende do RPO explicitado e da configuração real de Redis/volume, ainda não verificados. Spec 019 documenta AOF `appendfsync everysec`, que não basta, sozinho, para prometer RPO zero sob qualquer falha de host/energia.

Não mudar regras de transferência, visual, protocolo canônico ou close como efeito colateral de infraestrutura. Não adotar banco novo, fila nova, versão extra, outbox worker, manifest de arquivo ou reducer completo sem demonstrar que a alternativa menor não satisfaz o mesmo invariante. Não retirar rota antes de inventariar consumidores. Não migrar dados nem declarar incidente resolvido com base apenas neste documento.

## Contratos anteriores que precisam sobreviver

| Spec | Contrato aplicável |
| --- | --- |
| 024 — record e transporte | `pokemonInstanceId` é opaco e criado pelo backend. PID, trainer ID e hash nativo não são identidade global. Evento correspondente a movimento pertence à transação ou a outbox durável no mesmo commit. |
| 029 — snapshot canônico | Corpo do comando é snapshot completo de três panes; aceitação devolve 200 vazio; correção 409 devolve **snapshot canônico cru**, sem envelope ou campo extra. Retry mantém Idempotency-Key e fingerprint. |
| 030 — close | O X envia imediatamente a última intenção completa; não espera nem cancela flight já despachado. UI/heartbeat encerram localmente antes da resposta. Backend resolve reordenação e faz recovery por expiry; não ressuscita a sessão local. Fechar pane é diferente de fechar workspace. |
| 040 — lease global | Save `(profileId, gameId)` tem um owner efetivo Hub/player. Hub precisa reservar antes de inspecionar/adotar bytes; player não entra enquanto Hub ou recovery finalizam dirty save. Saves de jogos distintos podem operar em paralelo. |
| 059 — save vs runtime | Runtime state não substitui `.sav`; restauração de state, por si, não faz save PUT. Não alterar comportamento de fechamento/limpeza do player junto com o Hub. |
| 063 e 071 — Party | Writer Gen III deve preservar bytes e checksums. Regra atual de transferência proíbe PC/Hub→Party; permite sair da Party se ao menos um Pokémon permanecer após a transação inteira. Existência de writer PC→Party não autoriza o movimento proibido. |
| 070 — invalidação | Hub flush que muda save grava `runtimeStateInvalidatedAtRevision` na nova revisão e apaga `cloud-recovery` e `user-state` antes de confirmar flush; falha de deleção é retryável. State anterior ao marker não pode ser servido. |

## Evidência do incidente e níveis de certeza

| Achado | Grau | O que é seguro concluir |
| --- | --- | --- |
| Log em 26/09/2026 15:42:44.887 UTC: `SNAPSHOT_INVALID: Snapshot slot is invalid.` | Observado | `placementsForCanonicalPane` recebeu slot ausente em `source.placements`; rejeitou antes de `coordinator.sync`. Log não contém pane, slot, source ou payload. |
| Mensagem “The source save is not loaded in this workspace.” | Relato + caminho de código | `ensureHubSessionSource` lança isso quando pane de save visível não tem snapshot. |
| Callback da UI descarta snapshot de pane adicionado após abertura | Reproduzido pelo Astra em memória | `applyCanonicalSessionSnapshot` usa ref atual para panes visíveis, mas fatia snapshots por tamanho capturado no render inicial (`pokemon-hub-ui.jsx:124–147,313–327`). Explica a mensagem sob essa sequência; cronologia exata de produção não foi provada. |
| Falha após primeira source write deixa sources/record divergentes | Reproduzido pelo Astra em memória | `coordinator.sync` grava sources, records, eventos e idempotência sequencialmente (`pokemon-hub-snapshot-coordinator.mjs:387–425`). É defeito real de atomicidade, mas não prova corrupção nesse incidente. |
| `HUB_LEASE_INVALID` posterior | Observado, correlação aberta | Cleanup pode remover lease da fonte antes de tentar release do lease global já expirado; log não liga esse observer à sessão do slot inválido. |
| Perfil ocupado excluído sem descarte | Reproduzido em memória nesta análise | `GET /profiles` projeta ocupação do source, mas `delete` consulta grid legada vazia. Perfil some, source ocupado fica órfão, resposta informa contagem zero. Falta teste HTTP isolado. |
| Catálogo de perfis pode perder atualização entre processos | Risco deduzido | Redis guarda uma lista JSON com read-modify-write; fila do store é local ao processo. Ainda falta PoC concorrente. |
| Flush pode ler source/records de instantes distintos | Janela confirmada no código | `getSaveFlushPlan` lê source e records separadamente; `markSaveFlushed` confere revisão após possível escrita do save. Manifestação específica ainda requer interleaving reproduzido. |
| Save e metadata publicados por dois renames | Confirmado no código | Crash/leitor entre renames pode achar par inválido; ainda não houve fault injection em disco. |
| `GET layout` pode inspecionar/adotar sem reservar Hub | Confirmado no código | Rota consulta lease e rejeita player ativo, mas não chama `acquireHub` antes de ler/adotar (`server.mjs:841–882`); isso contraria o limite do Spec 040. Não atribuir ao incidente sem evidência. |
| Backup não tem checkpoint coerente nem restore | Confirmado no código atual | `backend-state-backup.mjs` já copia `runtimeStateInvalidatedAtRevision` quando presente, junto com bytes/revision/hash/fence e eventual `eventGrantReceipt`. Varre Redis e saves sem writers quiescentes. Não há restore no módulo. O achado anterior de omissão do marker pertence à auditoria histórica, não ao código lido em 27/09. |
| Observer pode atuar durante backup de startup | Confirmado no código | `makeServer()` dispara observer antes de `backendStateBackup.create('startup')` (`server.mjs:154–175,2050–2070`). Outras instâncias também não são pausadas por esse backup. |

**Não comprovado:** slot concreto da produção, causa única, corrupção dos saves de produção, queda completa do backend, vínculo causal entre os dois erros de log e configuração efetiva de durabilidade. Dados de produção só podem ser diagnosticados por scanner read-only e evidência preservada, sem reparo automático.

## Modelo de autoridade e invariantes

### Vocabulário operacional e fronteiras

| Termo | Significado neste levantamento | Não confundir com |
| --- | --- | --- |
| Backend profile | Perfil dono de uma sessão/namespace do Hub, usado como `profileId` na URL de `/api/profiles/:profileId/pokemon-hub/...` | Perfil de save de jogo ou perfil de armazenamento do Hub. |
| Save profile | Perfil real sob o qual o `.sav` é guardado; junto com `gameId` identifica um save físico | Workspace que o está visualizando. |
| Hub profile | Coleção de slots do Hub identificada por `hubProfileId` e com owner vinculado quando necessário | `profile.grid.entries` legado, que hoje não prova ocupação canônica. |
| Source | Documento Redis de slots, IDs e revisões para `save:<saveProfileId>:<gameId>` ou `hub:<hubProfileId>` | Pane, sessão ou layout renderizado. |
| Record | Documento persistente do `pokemonInstanceId` com representações nativas, display, provenance, placement e revisão | Sprite/display projetado. |
| Pane | Um dos três lugares do snapshot canônico da sessão; pode ser `null` | Source físico; um source deve poder sobreviver ao fechamento da pane. |
| Snapshot canônico | Comando/retrato completo `{revision, panes:[...3]}` com ocupação por ID; contém só slots ocupados | `source.placements`, que enumera também slots vazios. |
| Adoção | Reconciliação inicial ou posterior de bytes de `.sav` para source+records | Movimento do usuário ou publicação do save. |
| Dirty | `source.needsSaveFlush` indica obrigação de projetar placements aceitos no `.sav` | Debounce da UI ou fila em memória do flush service. |
| Publicação | Troca da geração binária e metadata do `.sav` que o player consumirá | Commit lógico Redis. |
| Close | Última intenção e finalização de sessão ou saída de pane | Meramente retirar componente React da tela. |

O **grafo de integridade** liga cada source aos IDs em seus placements, cada ID ao seu record/placement, cada save source ao arquivo físico, cada pane a um source e cada operação aceita aos sources que alterou. Os seus vértices não podem ser migrados ou revertidos isoladamente quando uma operação os conectou. O catálogo global introduz uma dependência adicional para criação, vinculação e exclusão de Hub profile. O lease e os índices de expiração são mecanismos de coordenação desse grafo, não fontes independentes de verdade sobre a localização de um Pokémon.

### Inventário concreto de dados e escritores observado

| Estado atual | Chave/arquivo e formato relevante | Quem escreve hoje | Regra a fechar |
| --- | --- | --- | --- |
| Catálogo Hub | `pokemon-hub:profiles`, uma lista JSON de perfis schema 1–6; file store alternativo `profiles.json` | `pokemon-hub-profile-store.mjs` create/rename/bindOwner/delete; fila em memória por instância | Concorrência interprocesso e vínculo entre exclusão e source canônico. |
| Source | `pokemon-hub:v2:{ph:<backendProfileId>}:source:<sourceKey>`; schema 1, revisões, adapter, placements, display, capability, `needsSaveFlush` | `ensureHubSource`, `adopt`, `sync`, `refreshTransferCapability`, `markSaveFlushed` | Identidade física única, CAS por geração, writer único para alterações de placement. |
| Record | Mesmo hash tag, `:record:<pokemonInstanceId>`; representação Base64/hash, placement/revision | `adopt`, `sync` | Igualdade bidirecional com source e geração do commit. |
| Evento | Mesmo hash tag, `:event:<id>:<eventId>` e event outbox | `pokemon-hub-event-store` chamado após outras gravações | História de movimento nasce junto com a alteração aceita ou em outbox durável do mesmo commit. |
| Sessão/operação | `:session:<id>`, `:session-operation:...`, `:session-terminal:...`, `:snapshot-sync:...`; expiring-session global | `pokemon-hub-session-service`, coordinator | Não haver resposta aceita sem geração correspondente; replay sem reexecutar. |
| Lease de source/índices | `:lease:<sourceKey>`, `:workspace-lease:<workspaceId>`, sorted set global expiring-lease | Coordinator acquire/renew/release/observer | Owner/fence efetivo e índice reconstruível. |
| Lease global save | `game-save-lease:<saveProfileId>:<gameId>`; player tem generation; Hub usa workspaceId/TTL | `game-save-lease-coordinator.mjs` | Expiração do TTL não libera dirty; finalizador antigo não afeta owner novo. |
| Save físico | `.sav` e metadata de revisão, sha256, fenceGeneration, marker runtime e eventual recibo de evento | `save-store.mjs` e múltiplos fluxos de player/Hub | Par de uma só geração visível ou leitor bloqueado; CAS e fence na publicação. |
| Runtime state | `cloud-recovery` e `user-state`, separados do `.sav` | Fluxos de player; flush Hub deleta após publicar save | Marker impede servir state anterior à revisão de invalidação. |
| Legado | `pokemon-hub:inventory`, `pokemon-hub:pokemon` e chaves/documentos prévios; rota inventory e transfer | Migração e serviços legados ainda chamáveis | Mapear consumidores, impedir writer paralelo no cutover e preservar dado não convertido. |

O hash tag atual agrupa chaves v2 **por backend profile**, o que favorece scripts dentro desse perfil, mas não garante identidade física: dois backend profiles podem construir `sourceKey` igual em hash tags distintos para o mesmo `.sav`. Um movimento que conecta fontes de hash tags diferentes também limita scripts em Redis Cluster; validar o deployment real antes de escolher algoritmo. Não assumir que `MULTI/EXEC` fornece rollback de comandos nem que atomicidade em Redis abrange arquivo `.sav`.

### Invariantes verificáveis

1. **Identidade:** para cada par físico `(saveProfileId, gameId)` ou `hubProfileId` existe uma autoridade canônica resolvível; aliases históricos são inventariados e bloqueiam escrita se conflitarem. Backend profile concede acesso, não duplica o objeto.
2. **Conservação:** uma transferência ordinária é uma permutação dos IDs das fontes participantes; não cria, remove nem clona ID. Adoção e descarte explícito são operações de tipo diferente, com causa, precondições e auditoria próprios.
3. **Unicidade:** em uma geração publicada, cada `pokemonInstanceId` ativo ocupa um slot em uma única fonte; nenhum slot possui dois IDs; source e record apontam um para o outro. Histórico de eventos não conta como localização atual.
4. **Topologia:** todo placement e comando usa slot existente na topologia da geração verificada. Party e Boxes obedecem forma do save; slots do Hub são absolutos. Grid CSS e tamanho da janela não alteram identidade de slot.
5. **Commit:** sources, records alterados, revisões, obrigação dirty, idempotência, estado mínimo de sessão e evento/outbox têm um ponto lógico único de visibilidade ou falham integralmente. Commit Redis não é prova de persistência física sob toda falha; RPO precisa ser declarado.
6. **Replay:** mesma chave e mesmo fingerprint obtêm o mesmo resultado lógico mesmo se a resposta anterior se perdeu; mesma chave e corpo diferente causam conflito. O fingerprint inclui o significado inteiro do comando, inclusive fontes, panes e revisão, em representação estável.
7. **Ownership:** apenas o owner/fence atual pode materializar, limpar dirty ou liberar save. Player só adquire depois que toda obrigação lógica aceita está coberta por save validado e runtime state antigo invalidado.
8. **Publicação:** um `get` entrega bytes+metadata que combinam em revisão/hash/fence ou falha sem oferecer par incompleto. Retry da mesma geração é seguro; geração ultrapassada não substitui geração nova.
9. **Recuperação:** close, expiração, retry e restart são formas de prosseguir uma obrigação durável; falha conserva dados e impede player até recuperação, sem descarte automático e sem depender de um processo específico.
10. **Autorização:** nenhuma pane/sessão/rota antiga acessa source ou save de outro owner; validação de perfil, jogo, capacidade e política ocorre antes do commit, inclusive em fluxos de leitura que possam adotar.
11. **Preservação nativa:** edição de placement muda só bytes permitidos, mantém estruturas não relacionadas, Party válida, checksums e representação suportada; ausência de integração opcional não interfere no fluxo essencial de save.
12. **Operação segura:** scanner/backup não corrigem silenciosamente. Se estado prévio já divergiu, nova escrita nesse componente é bloqueada até classificação e recuperação verificadas.

| Autoridade | Escritor lógico previsto | Observação |
| --- | --- | --- |
| Catálogo e owner de Hub profile | Operação de perfil sob concorrência entre processos | Grid legada pode existir como compatibilidade, mas não decide ocupação/exclusão canônica. |
| Source e record | Commit condicional de placement; adoção controlada | Um source físico por save real ou Hub profile. Session e browser são views/comandos, não segunda autoridade. |
| Topologia | Descritor/revisão da fonte | Party/Box derivam do formato; Hub usa slots absolutos, não largura da UI. |
| Ownership e fence | Transição de acesso por save | Índices TTL são reconstruíveis, não prova de que save está liberado. |
| Save publicado | Save store com versão/metadata coerentes | Player só lê geração que cobre movimento Hub aceito. |
| Intenção local | Browser até ACK/close | Drag otimista não é persistência. Close envia última intenção conforme Spec 030. |

Para uma geração aceita: cada ID aparece em exatamente um placement; o multiconjunto de IDs de movimento é conservado; record e source apontam à mesma localização; revisão, sessão, resultado idempotente e evento/outbox correspondem ao mesmo commit; source dirty mantém obrigação durável; player não obtém save anterior a essa obrigação. Descarte de Pokémon exige operação explícita e auditável, nunca consequência implícita de deletar um perfil. Bytes nativos, Party, checksums e campos não autorizados permanecem íntegros.

O commit único é **lógico**, dentro da autoridade Redis. Redis e volume de saves não fazem uma transação conjunta. Um movimento aceito cria obrigação recuperável de projeção; enquanto ela não se conclui, ownership bloqueia player. Close/release confirma publicação validada e liberação. `MULTI/EXEC` não reverte comandos anteriores quando comando posterior falha; um script também exige pré-validação antes da primeira mutação e domínio de chaves compatível. Comparar script, geração imutável com ponteiro condicional e outra store transacional apenas onde as provas exigirem, medindo tamanho/latência/GC/recovery. Mutex local e compensação entre writes não atendem ao commit lógico multi-fonte.

## Dossiê 1 — identidade, perfil, adoção e exclusão

### Caminhos de entrada, leitura e escrita que precisam ser inventariados

Esta tabela é o mapa estático inicial de `apps/backend/server.mjs` lido em 27/09; “ativo no produto” depende de confirmar chamadas do frontend e eventuais clientes externos. O prefixo `:p` em rotas de sessão é backend profile; `:saveProfile` é dono físico do arquivo.

| Entrada | Efeito ou dependência atual | Risco de coexistência e prova necessária |
| --- | --- | --- |
| `GET/POST /api/pokemon-hub/profiles`; `PATCH/DELETE /api/pokemon-hub/profiles/:hubProfile` | Lista/cria/renomeia/exclui catálogo; GET projeta source e vincula owner quando aplicável | DELETE lê grid legada; demonstrar ocupação canônica e corrida com movimento/abertura. |
| `GET /api/pokemon-hub/save-profile-games`; `GET /api/pokemon-hub/save-profiles/:game/:saveProfile/layout?workspaceProfileId=...` | Descobre saves; layout lê arquivo, inspeciona, pode adotar source ou atualizar capability | GET tem efeito persistente, `workspaceProfileId` escolhe namespace v2 e apenas consulta lease global; requer reserva antes da primeira leitura que influencia adoção. |
| `GET /api/profiles/:p/pokemon-hub` | Inventory pelo serviço legado | Definir se é só leitura e quem ainda o usa; não usar como autoridade. |
| `POST /api/profiles/:p/pokemon-hub/transfers` | Se corpo contém `workspaceId`+`sources`, chama grid transfer/coordinator; caso contrário serviço legado | Duas semânticas por shape de body; serviço legado escreve save/hub por caminho independente. |
| `POST .../snapshots/acquire|renew|sync|release` | Contrato de snapshot direto; release faz flush antes de soltar source | Mesmo coordinator, mas sem sessão canônica; telemetria/cliente necessários antes de aposentá-lo. |
| `POST /api/profiles/:p/pokemon-hub/sessions` | Abre sessão | Sessão inicia independente de panes; source é adquirido em pane load/attach/sync. |
| `POST .../sessions/:id/panes/:pane` | Carrega/substitui pane canônica; adquire e finaliza source de saída | Testar 1→2→3 panes, troca, stale revision, erro de acquire e compensação. |
| `POST .../sessions/:id/snapshots` | Comando canônico de 3 panes; 200 vazio ou 409 correção | Backend atual injeta `reason` em certos 409, divergência do Spec 029. |
| `POST .../sessions/:id/close` | Última intenção canônica com Idempotency-Key; finaliza save/leases | 200 vazio ao concluir, 409 raw quando corrigido; falha após commit deve ser retomável. |
| `POST .../sessions/:id/heartbeat`; `DELETE .../sessions/:id` ou `.../sources/:sourceId`; `POST .../sources` | Heartbeat/close e attach/detach prévios | Verificar consumidores e interação com operação canônica em voo. |
| Player `.../save` e `.../lease` | Lê/escreve `.sav`, adquire/renova/libera lease de player | É a barreira física do Hub; cenários de GET/layout, PUT e launch precisam verificar fence/dirty. |
| Observer, startup migration, backup | Expira sessão/lease; migra legado; varre Redis e saves | São writers/leitores fora do HTTP. Corte operacional deve abranger todas as instâncias. |

O frontend usa `apps/packages/pokemon-hub-ui.jsx` e o cliente HTTP correspondente; o inventário deve buscar chamadas dessas rotas, capturar método/schema/erro esperado e confrontar com testes de servidor. Uma rota que não aparece no frontend ainda pode ser chamada por cliente antigo ou integração externa. A decisão de aposentá-la requer telemetria com janela, política de versão e bloqueio do writer em todas as instâncias.

### Adoção: requisitos específicos

- **Precondições:** save existente, perfil/jogo autorizado, adapter e layout compatíveis, bytes íntegros, nenhum player concorrente, reserva Hub efetiva com fence. O layout lido deve pertencer à mesma revisão do save que será comparada com `source.saveRevision`.
- **Reimportação:** se source existe e save revision divergiu, só adotar quando não houver obrigação dirty. Se dirty, não sobrepor placements aceitos com bytes antigos. Se duas leituras observam revisões diferentes, abortar ou reiniciar sob a mesma reserva.
- **Matching de ID:** `adopt` reusa records por SHA-256 da representação nativa. Dois registros com bytes idênticos podem trocar de identidade por ordenação; isso é limite de observabilidade, não erro que se resolve com PID ou hash como identidade. Exigir mapeamento determinístico, conjunto de IDs conservado e aviso/estratégia explícita se a garantia individual for necessária.
- **Commit:** source, records e eventos `pokemon.observed` de uma adoção devem aparecer juntos. Falha em qualquer ponto conserva a geração anterior; retry não cria novos IDs para a mesma observação já aceita.
- **Capability:** `refreshTransferCapability` hoje altera source por script sem incrementar revisões. Decidir se capability participa do fingerprint de política e qual revisão a protege; comando validado com capability antiga não pode ganhar permissão silenciosamente. Registrar versão apenas se source revision não cobrir esse caso.

### Perfil e exclusão: requisitos específicos

O catálogo tem nome único sem distinção de acento, nome NFC de 1–26 caracteres imprimíveis, UUID de Hub profile e `ownerProfileId` opcional. Esses contratos atuais devem ser preservados ou alterados apenas por decisão explícita. Create, rename, bindOwner e delete são serializados por `queue` local do store; a versão Redis lê e regrava uma lista JSON inteira. Dois backends podem perder uma alteração. A PoC precisa usar duas instâncias do store sobre a mesma persistência, barreira entre leitura e gravação, e verificar que ambos os perfis/renomes sobrevivem ou que um recebe conflito.

Para DELETE, o predicado de vazio vem de source canônico sob operação condicional que também verifica ausência de sessão/lease/projeção em andamento. A resposta deve refletir exatamente o número/IDs descartados. O flag `discardOccupied` existente não deve autorizar descarte com base em grid vazia. Definir retenção de records/eventos para descarte auditável e recuperação; nunca eliminar source, record e catálogo em passos independentes com sucesso parcial exposto. Perfil excluído com source ocupado já encontrado deve entrar em quarentena read-only até recuperar associação ou executar descarte explícito autorizado, sem reaproveitar ID de perfil.

### Critérios de saída do tópico 1

Registrar esquema escolhido de source físico, chave de compatibilidade/alias, algoritmo de adoção sob lease, política para records idênticos, concorrência do catálogo, semântica exata de exclusão e migração de dados legados. Executar PoCs com dois workspaces, dois backends e fault injection nos writes; obter oráculo de source/record/evento antigo ou novo. Um esquema que apenas move o alias para outro lugar sem impedir escritor antigo não fecha este tópico.

**Hoje:** source/record/sessão usam hash tag de `workspaceProfileId` (`pokemon-hub-redis-keys.mjs`), embora source de save inclua perfil físico+jogo. O mesmo save pode ter aliases duráveis. `GET layout` mistura inspeção do `.sav` com IDs Redis e pode adotar/atualizar capability. `coordinator.adopt` escreve records, source e eventos em sequência. `pokemon-hub:profiles` é lista global JSON com fila de mutação local. DELETE consulta `profile.grid.entries`; GET mostra o source. Existem chaves v2 e documentos legados `pokemon-hub:inventory`/`pokemon-hub:pokemon`.

**Contrato:** identidade física de save = perfil real+jogo; de Hub = `hubProfileId`. Workspace/pane/owner/nome são referências, não criadores de identidade. Adoção é idempotente e ocorre sob reserva/fence antes da leitura de bytes conforme Spec 040, mantendo a experiência de abertura preguiçosa. Leitura pura pode ser resultado final, mas não deve romper seleção de save. Catálogo precisa de CAS/serialização entre backends. Excluir perfil usa ocupação canônica, bloqueia sessão/lease/projeção pendente e só descarta mediante regra explícita com IDs e contagem auditáveis. Hash nativo é fingerprint; representações idênticas podem ser indistinguíveis após reimportação. Exigir conservação do conjunto de IDs e atribuição determinística, não identidade individual impossível de inferir.

**PoCs e saída:** dois workspaces para mesmo save, inclusive dirty; player/Hub disputando layout; adoção repetida, falha entre cada write e dois records nativos idênticos; duas instâncias alterando catálogo; DELETE ocupado com/sem descarte e com lease; migração de aliases conflitantes em cópia. Fechar identidade, mapeamento legado, semântica de ambiguidade, adoção e exclusão antes do dossiê 2.

## Dossiê 2 — topologia, slots e correção canônica

### Contratos de forma e divergência atual

`validatePokemonHubCanonicalSnapshot` exige exatamente três panes indexados 0–2, cada um `null` ou um objeto estrito de save/Hub; bloqueia ID duplicado e slot ocupado duas vezes. O pane de save traz `party` e `boxes` só com ocupados; Party deve ter ao menos um membro e índices contíguos desde zero; Box aceita slots absolutos 0–419; Hub aceita inteiro 0–`MAX_SAFE_INTEGER`. A validação sintática não demonstra que o slot existe na **fonte**. `placementsForCanonicalPane` monta chaves das posições pedidas e rejeita a que não existe em `source.placements` com `SNAPSHOT_INVALID`. Esse é o ponto observado no incidente. Não estreitar o teto sintático de Hub sem identificar fonte legada/expansão e sem migrar todos os clientes afetados.

O layout de save define 6 Party slots e 14×30 Box slots para os saves Gen III suportados; a topologia de Hub vem do source, com mínimo inicial 60 em fluxo atual. A UI constrói células conforme projeção de perfil e pode referenciar um destino local sem placement correspondente. O contrato de disponibilidade precisa ser entregue ao cliente ou inferido de um snapshot autoritativo da mesma geração: botão visível/área de drop e source. CSS/responsividade afeta colunas, nunca a numeração persistida.

**Correção:** o 409 de snapshot/close retorna exatamente `{revision,panes}` do Spec 029. Um campo `reason` altera o schema estrito e pode virar entrada inválida no próximo envio. Código HTTP atual (`server.mjs` perto de 1013 e 1051) acrescenta esse campo se existir. A causa/slot inválido deve aparecer em log estruturado, com correlação de sessão/operação, ou cabeçalho documentado sem payload sensível. O log deve diferenciar falha sintática, slot ausente, source revision stale, membership e policy, mantendo texto público estável.

**PoC reproduzível:** construir source Hub de 30, 60 e 61 slots e comando para 29/30/59/60; testar slot vazio existente, slot ausente, slot negativo e ocupação duplicada. Rodar Party 5/6 e Box 419/420, inclusive fonte cujo adapter apresente topologia diferente. Para cada rejeição, registrar `sourceKey`, pane, location, revisão e o 409 cru; confirmar nenhum writer executado. Para fonte legada curta, decidir entre expansão CAS ao abrir e esconder posições inexistentes até a expansão, considerando lease e sessões concorrentes.

**Hoje:** snapshot valida Party 0–5, Box 0–419 e Hub até `MAX_SAFE_INTEGER`, mas backend exige slot presente nos placements. Hub novo/UI começam com 60, fonte legada pode ser menor; UI mostra número dinâmico de células e pode acessar `placements[toSlot]` ausente. O log demonstra rejeição, não slot 60. Servidor injeta `reason` em alguns 409, contrariando schema cru do Spec 029.

**Contrato:** backend e UI concordam sobre conjunto de slots válidos da fonte/revisão. Largura afeta render, nunca ID de slot. Primeiro testar se manter capacidade fixa 60 resolve os casos reais; expansão/esparsidade apenas se requisito comprovado. Revisão de source pode bastar para invalidar topologia antiga; `topologyVersion` separado só se necessário. Correção pública segue snapshot cru do Spec 029; diagnóstico seguro fica em log ou outro canal sem alterar corpo. Pane sem snapshot correspondente não é interativo.

**PoCs e saída:** Party 5/6, Box 419/420, Hub 29/30/59/60 e fonte legada curta; resize, pane novo, correção 409, versão/revisão obsoleta; log com source/pane/slot/revisão sem token/bytes. Fechar contrato de slots e corpo HTTP antes do dossiê 3.

## Dossiê 3 — browser, intenções e close

### Fluxo do usuário que a infraestrutura deve conservar

1. O usuário abre workspace com sessão backend; três panes existem no protocolo mesmo quando somente um ou dois estão visíveis. Selecionar save/Hub acrescenta pane estrutural, obtém source/snapshot e projeta Party, Boxes ou grid. Um save ainda sem `.sav` mostra ausência e não oferece movimentação.
2. Drag de slot ocupado para destino vazio aplica intenção local com feedback de política. A UI envia snapshot completo após debounce, com Idempotency-Key, serializado por `snapshotFlight`. Até 200, a posição local é tentativa; 409 substitui a base pela correção canônica e deve reavaliar intenção pendente sem apagar source recém-carregado.
3. Acrescentar/trocar/fechar pane é transição estrutural que adquire e, se necessário, materializa/libera source de saída. Não é movimento implícito de Pokémon. Reordenação do callback não pode cortar `snapshots` pela quantidade capturada em render antigo; `pokemon-hub-ui.jsx` usa `pokemonHubPanesRef.current.length` para visibilidade mas fatia o snapshot com `pokemonHubPanes.length` da closure em `applyCanonicalSessionSnapshot`.
4. X do workspace captura intenção final completa e manda close imediatamente. A UI desliga heartbeat e fecha localmente sem aguardar rede/flight; backend precisa ordenar comando anterior e close ou corrigir de forma segura. Fechar pane segue outro caminho. Expiração deve finalizar sessão se close se perdeu.

### Estados mínimos a observar nas PoCs

| Situação | Resultado observável obrigatório |
| --- | --- |
| Pane 2/3 adicionado após callback de pane 1 | Snapshot novo permanece no mapa local; drag entre todos os panes carrega source correta. |
| 409 durante drag otimista | UI aplica snapshot cru, preserva ID e mostra falha/estado corrigido; não apresenta transferência recusada como salva. |
| ACK 200 perdido | Retry com mesma chave/corpo reproduz aceitação sem segundo movimento; snapshot do servidor confirma placement. |
| Close durante debounce ou request em voo | Última intenção capturada é enviada conforme Spec 030; backend ordena/reconcilia; nenhuma aba do browser precisa permanecer aberta para concluir save. |
| Close remoto falha ou conexão cai | UI segue fechada; lease/dirty/session pendente ficam recuperáveis por observer; abrir player continua bloqueado até finalizar. |
| Pane removido com save dirty | Flush da geração correspondente conclui antes de liberar save; falha mantém owner/finalização. |

Não trocar o comportamento do X por espera de rede. Uma ref consolidada para snapshots, panes e intenção pode simplificar a UI, mas só adotá-la após medir quais states são projeções e quais representam intenção em voo. Não descartar o `snapshotFlight` apenas porque o commit backend será atômico: ordenação de comandos e retry continuam necessários.

**Hoje:** callback criado na abertura usa pane count antigo e pode apagar snapshot de novo pane após correção. UI guarda panes, layouts, snapshots em ref/state e projeções de perfil; drag altera localmente e envia após debounce. `snapshotFlight` serializa requests. `closePokemonHub` fecha UI antes de resposta; isso é a semântica exigida pelo Spec 030, mas intenção local e falha remota precisam de prova.

**Contrato:** uma geração aceita e intenção local suficiente para gerar comando/correção, sem duplicar autoridade. Callback lê refs atuais. Correção reidrata todos os panes; intenção incompatível é rejeitada visivelmente. ACK de movimento significa persistência lógica; drag local não pode ser apresentado como salvo. **Não alterar o X:** capturar snapshot final, enviar imediatamente sem esperar/cancelar flight em andamento, parar heartbeat e encerrar UI local; backend resolve ordem, replay e expiry. Fila persistente/reducer completo só entram se PoC provar necessidade.

**PoCs e saída:** sessão abre 1 pane, passa a 2/3, recebe correção e move de cada pane; flight antes/depois de close, debounce não enviado, ACK perdido, pane retirado, refresh e expiração. Demonstrar que a última intenção capturada no close não some e que falha remota é recuperável sem ressuscitar UI. Fechar máquina de estados e interleavings antes do dossiê 4.

## Dossiê 4 — planejamento e commit lógico

### Ponto de linearização e interleavings exigidos

O coordinator hoje verifica leases/revisões, compara topologia, rejeita ID não autorizado/destino ocupado, consulta records e política, então grava cada source alterado, cada record, eventos e `snapshot-sync` sequencialmente. O session service, por sua vez, adquire fontes, chama sync, solta fontes de saída, persiste sessão via transição e grava resultado de operação depois. Esses dois escopos não compartilham um commit. Um erro após o primeiro `writeSource` pode deixar a primeira fonte atualizada e a segunda antiga; um erro após sync mas antes de persistir a sessão pode apresentar correção baseada em sessão antiga diante de sources novos.

O desenho a ser provado precisa fixar **qual** write torna a operação aceita. Toda precondição dependente do mundo atual deve ser lida/validada novamente ou protegida no mesmo limite: versão de cada source, IDs/placements envolvidos, session generation, lease/fence de cada save, owner dos Hub profiles, capability/policy relevante e Idempotency-Key. Records e evento/outbox devem estar prontos antes da primeira mutação visível. Se um script for escolhido, erros previsíveis de tipo/limite/schema não podem ocorrer após metade dos writes; pré-validação e limite de payload devem ser medidos. Se gerações imutáveis com ponteiro forem escolhidas, readers e GC precisam usar o mesmo ponteiro e sobreviver a crash. Se store transacional substituir Redis, migração/operacionalização precisa ser justificada por PoC que rejeite as alternativas menores.

| Corrida/falha | Oráculo de aceitação |
| --- | --- |
| Duas sessões movem IDs do mesmo source com revisão igual | Uma aceita; outra recebe correção atual, sem lost update ou duplicação. |
| Duas operações independentes em saves/jogos distintos | Ambas podem progredir sem mutex de todo o Hub. |
| Source A foi gravado e processo morre antes de source B no código antigo | Scanner detecta anomalia; implementação nova não pode produzir esse estado. |
| Commit concluiu, HTTP 200 não saiu | Retry retorna o mesmo resultado e gerações; não reaplica policy/novo evento. |
| Chave idempotente reaparece com outro corpo | Conflito explícito e nenhuma escrita. |
| Session close e snapshot comum correm em backends diferentes | Ordem definida pelo estado persistido; depois do terminal não se aceita novo movimento. |
| Política nega destino por capability ou Party | Nenhuma fonte/record/evento/dirty é alterada; correção usa snapshot cru. |

O evento `pokemon.moved` é trilha histórica imutável, não placement canônico. Se o caminho único o grava depois do commit, existe estado aceito sem evento em crash; Spec 024 exige acoplamento ou outbox durável no mesmo commit. Outbox worker só se a entrega independente for necessária; um documento de evento pronto no commit pode ser suficiente. Definir retenção de resultado idempotente maior que janela de retry/close e comportamento depois de expirar, evitando replay indistinguível de comando novo.

**Hoje:** `coordinator.sync` valida e depois grava cada source, record, evento e resultado de idempotência; sessão confirma depois. Uma falha entre writes pode perder placement visível. A fila por sessão e CAS de partes do fluxo já ajudam, mas não cobrem todas as fontes e records juntos.

**Contrato:** planner puro valida revisão, topologia, ownership/fence, IDs, política, representações e fingerprint. Commit condicional publica placements de todas as fontes tocadas, records, revisões, estado mínimo de sessão/resultado de retry, obrigação dirty e evento ou outbox durável no mesmo ponto lógico. Mesmo Idempotency-Key+payload = mesmo resultado; chave com payload distinto = conflito; resposta perdida reexecuta replay, não movimento. Sources disjuntas de sessões diferentes podem progredir em paralelo; comandos da mesma sessão seguem a ordem do protocolo. Nenhum writer legado pode contornar esse commit após cutover.

**PoCs e saída:** Redis descartável e adaptador de memória, dois backends; falhas em cada fronteira lógica e pós-commit/pré-HTTP; scanner exige estado antigo completo ou novo completo; replay igual/conflitante; fontes em namespaces distintos; medir domínio de chaves e limites. Definir técnica mínima, ponto de linearização e recuperação antes do dossiê 5. Publicação de `.sav` fica no dossiê 6, não é parte do commit Redis.

## Dossiê 5 — ownership, lease, fence e expiração

### Tabela mínima de transições de acesso

| Estado efetivo do save | Evento | Novo estado admissível | Guarda |
| --- | --- | --- | --- |
| Disponível, save coerente, sem dirty | Player acquire | Player ativo | CAS owner/fence; launch lê a mesma geração validada. |
| Disponível | Hub reserve antes de layout/adopt | Hub ativo | Reserva física `(saveProfileId,gameId)` antes de inspecionar bytes. |
| Hub ativo e clean | Movimento aceito | Hub ativo e dirty | Obrigação durable criada no commit lógico, não apenas callback `markDirty()` vazio. |
| Hub ativo e dirty | Close, saída de pane ou expiry | Finalização | Fence preservado; player continua negado. |
| Finalização | Save publicado, marker/deleção concluídos e source clean | Disponível | Somente mesmo owner/fence; retry idempotente. |
| Hub ativo clean | Close sem mudança | Disponível | Release condicional; índices limpos depois. |
| Qualquer estado ativo | TTL nominal expira | Recovery ou estado pendente | TTL é sinal para observer, nunca prova de save livre se dirty/finalizando. |
| Player ativo | Player PUT/heartbeat/release | Player ativo ou disponível | Generation atual e CAS de revisão/fence; Hub não adota enquanto ativo. |

O lease global atual considera lease expirado como inexistente em `get` e `acquirePlayer`; `source` ainda pode ter dirty. O source lease expira em 9 s por padrão, mas não deve libertar save antes de flush. `coordinator.release` remove source lease e índices por `Promise.all` e só depois chama `gameSaveLeases.releaseHub`; se o lease global expirou ou mudou, aparece `HUB_LEASE_INVALID` com estado parcial de cleanup. A ordem nova precisa provar que nenhum crash abre janela de acesso ao player a save velho. Um CAS de limpeza do dirty deve conferir source revision **e** fence/geração de owner; a verificação atual de `markSaveFlushed` só confere source revision.

O observer em `server.mjs` varre sessões e leases expirados. Uma falha de item não deve abortar os seguintes; obrigação falha permanece indexada ou é redescoberta por varredura segura. Dois observers simultâneos precisam eleger/fencear o mesmo trabalho sem global lock. `listExpiredLeases` remove índice órfão ou futuro; índices podem ser reconstruídos do estado principal. Clock avançado/atrasado, renew tardio, crash após flush e antes de release, e source lease ausente com dirty devem estar na matriz de recovery. Definir readiness quando observer não consegue recuperar um componente, mantendo indisponibilidade localizada quando possível.

**Hoje:** lease de source, índices de workspace/expiração, lease global player/Hub e sessão evoluem separadamente. Lease global expirado pode ser adquirido pelo player antes do flush de source dirty. Release apaga lease de source/índices antes de `releaseHub`, o que explica um caminho para `HUB_LEASE_INVALID`. Observer tem `try/catch` para lote inteiro. `markSaveFlushed` compara source revision, não owner fence explícito.

**Contrato:** um estado efetivo por save distingue disponível, Hub ativo, finalização pendente e player ativo. Pode reutilizar lease global+flag dirty se recuperação for provada; não criar quatro stores só por nomenclatura. TTL vencido não torna save dirty disponível. Mesmo owner/fence pode repetir close/expiry; outro owner não pode flushar, limpar ou liberar. Índice é derivado. Observer tenta itens independentemente; falha mantém obrigação e retry. Saves de jogos distintos não ganham lock global.

**PoCs e saída:** clock controlado, dois backends, Hub dirty expirando enquanto player abre; flush falhando, close/expiry concorrentes, renew tardio, dois observers, crash em cada transição. Player só abre após save atual; worker antigo não libera owner novo. Fechar tabela de transições e erros antes do dossiê 6.

## Dossiê 6 — projeção binária e runtime state

**Hoje:** `needsSaveFlush` é obrigação persistida; `markDirty`, `flushDue` e `isDirty` do flush service são no-ops. Plano de flush lê source e records em instantes diferentes. Save store faz dois renames (bytes e metadata) e reader lê ambos em paralelo. Flush pode publicar bytes antes de descobrir que source mudou; depois apaga snapshots de runtime e marca clean.

**Contrato:** plano de materialização usa source e records de uma mesma geração lógica, com fence e revisão ainda válidos antes da publicação. Materializer preserva bytes nativos não alterados, representa Party/PC conforme Specs 063/071, valida checksums e falha fechado se faltam dados. Reader vê par bytes+metadata completo ou bloqueia com recuperação preservando versão anterior. Manifest imutável ou journal do formato atual são alternativas; escolher a menor que passa crash/reader concorrente. Retry não publica geração velha nem marca nova como clean. Marker de Spec 070 acompanha nova revisão e impede state velho mesmo se deleção física atrasar; deleção dos dois slots precisa concluir antes de ACK de flush Hub.

**PoCs e saída:** mutação entre leituras source/records, entre plano/publicação, crash entre renames, bytes/metadata ausentes, checksum/fence divergente, deleção de snapshot falhando e retry após save publicado/clean pendente. Fixtures reais de Ruby/Sapphire/Emerald/FireRed/LeafGreen, leitura independente e round trip de emulador. Fechar protocolo reader/writer e recovery antes de liberar player.

## Dossiê 7 — política e protocolos redundantes

**Hoje:** backend/client preservam serviço legado, grid transfer, snapshot direto, compact session e canonical session. Regras Gen III, capabilities, região, trade, Party e passport já existem. Não há inventário comprovado de clientes externos. Revisions de source, sessão, save, fence e capability têm papéis distintos; uma versão global seria simplificação falsa.

**Contrato:** congelar matriz de decisão atual sem mudar regra incidentalmente. Planner de política puro recebe source/destination/record/capabilities, sem I/O. Todos os writers ativos usam o mesmo commit. Rota de compatibilidade chama o caminho único ou responde upgrade explícito e versionado; cada adaptador temporário tem critério de retirada. Não remover protocolo antes de medir uso e preservar cliente antigo na janela definida.

**PoCs e saída:** comparar política atual/candidata para save↔Hub, save↔save, Party→PC, PC/Hub→Party negado, Party final com ≥1, destino ocupado, região/trade/passport, representação incompatível e save não suportado; inventário estático + telemetria de rotas/writers; simular cliente antigo e verificar que não contorna commit. Fechar consumidores, versões necessárias e cronograma de retirada antes do cutover.

## Dossiê 8 — diagnóstico, scanner, backup, durabilidade e cutover

**Hoje:** log não informa pane/slot rejeitado. Backup varre Redis depois saves e não implementa restore; o código atual já inclui runtime marker e recibo de evento quando presentes. Bootstrap migra legado, cria servidor (que já dispara observer), então executa backup antes de abrir HTTP. Portanto backup de startup é barreira de listener, não checkpoint de pré-migração nem garantia de quiescência. Outras instâncias podem continuar escrevendo.

**Contrato:** diagnóstico por operação/source/pane/slot/revisões/fase, sem dados nativos/tokens. Scanner **read-only** percorre catálogo, fontes, records, sessões, leases, evento/outbox, obrigação dirty, save e runtime marker; diferencia evento histórico de placement atual. Violação bloqueia escrita apenas do componente afetado quando identificável; não apaga IDs nem conserta sozinho. Backup de migração captura corte coerente com metadata completo ou manifest capaz de reconstruí-lo. Restore é ensaiado isoladamente antes de qualquer migração. RPO/RTO para crash de processo, reboot, host, volume e Redis são definidos com configuração efetiva, não inferidos do Spec 019.

**PoCs e saída:** gerar slot inválido conhecido e confirmar diagnóstico; scanner detectar duplicado, órfão, record divergente, perfil excluído com source, save/metadata inválidos e runtime marker ausente; backup sob movimento/flush concorrentes deve ser rejeitado se corte não for recuperável; restore isolado e fault drill por ACK. Este dossiê começa como **baseline antes do dossiê 1** e fecha no cutover depois dos demais.

## Oráculos comuns das provas

| Fronteira | Sucesso | Falha admissível |
| --- | --- | --- |
| Adoção | Source+records+IDs de uma geração | Nenhuma adoção visível ou geração anterior íntegra; sem record solto considerado atual |
| Movimento | ID no destino, record/sessão/idempotência/evento alinhados | Origem inteira ou destino inteiro; nunca ID perdido/duplicado |
| Close/expiry | Save materializado, runtime antigo inválido, owner liberado | Finalização recuperável com player bloqueado |
| Publicação binária | Bytes+metadata da nova revisão legíveis juntos | Versão anterior completa ou bloqueio recuperável, sem servir par inválido |
| Perfil | Exclusão apenas de vazio ou descarte explícito auditado | Perfil e seus Pokémon preservados |
| Restore | Mesmo grafo lógico e geração binária | Serviço não fica ready; evidência preservada |

Scanner compara placements, record pointers, hashes, revisões, owner/fence e obrigação de projeção. Uma diferença entre source lógico e `.sav` só é aceitável enquanto existe obrigação recuperável e player bloqueado. PoC de durabilidade registra ACKs em journal externo ao backend e compara com estado após restart/falha física no cenário de RPO escolhido.

## Ordem de aprofundamento e gates de mudança

1. **Baseline transversal (dossiê 8):** mapa de writers HTTP e workers, chaves v2/legadas, scanner read-only, estado real classificado, fixtures de comportamento e restore de checkpoint isolado. Se houver inconsistência preexistente, preservá-la para análise antes de qualquer write.
2. **Modelo (1 e depois 2):** identidade, perfil/exclusão, adoção, topologia e corpo de correção fechados. Cada ponto só sai de investigação quando seu contrato, alternativas e PoCs estiverem completos.
3. **Comportamento (3 e depois 7):** provar bug da closure e todos os interleavings de close sem mudar Specs 029/030; congelar regras/consumidores.
4. **Persistência lógica (4):** commit único demonstrado em falhas/concorrência, idempotência e evento histórico íntegros.
5. **Acesso físico (5 e depois 6):** lease/finalização, publicação binária, runtime marker e player barrier recuperáveis.
6. **Cutover (8):** só após restore, migração, shadow comparison, uma autoridade por fonte e RPO comprovado.

O rollback não é sempre “por fonte”: catálogo é global, sessão e movimento podem conectar save, Hub profile e records. A unidade segura é o **componente conectado** por fontes, sessões e operações ativas. Antes de migrá-lo: impedir novos comandos, pausar/esperar observers de todas as instâncias, confirmar ausência de sync/close/flush em voo e capturar checkpoint **anterior** à nova migração. Shadow read não faz dual write autoritativo. Todas as instâncias antigas que não entendem fence/cutover saem de tráfego **e de workers**. Colisão/alias divergente para escrita e entra em quarentena. Rollback após ACK novo só é admissível se houver replay determinístico desses ACKs sobre estado restaurado; caso contrário, forward recovery é obrigatório.

**Critério de parada:** qualquer ID perdido/duplicado, record/source divergente, save antigo acessível ao player, correção fora do contrato, writer alternativo ativo, checkpoint não restaurável ou rollback incapaz de conservar ACKs impede avanço. Redução de complexidade é medida pela eliminação de autoridades e caminhos de escrita concorrentes; não pelo número de arquivos/classes.

## Decisões abertas para o próximo chat

- Payload, pane, slot, source e revisões do `SNAPSHOT_INVALID` real: ausentes no log. Reproduzir mecanismo, mas não inventar causa exata.
- Estado atual dos dados de produção: não inspecionado por scanner; corrupção não comprovada.
- Política de descarte explícito e recuperação de perfil Hub ocupado.
- Capacidade Hub fixa de 60 ou necessidade real de crescimento; versão de topologia separada só se necessária.
- Técnica mínima de commit Redis; domínio de chaves em eventual Redis Cluster; limites de payload.
- Se `needsSaveFlush` + scan/fence basta ou exige job separado; manifest versus journal para publicação binária.
- Política de ambiguidade de records nativos byte a byte idênticos após reimportação.
- Consumidores externos das rotas antigas e configuração/durabilidade efetiva de produção.

## Registro das quatro revisões críticas

**Revisões 1–2:** corrigiram exclusão órfã, imprecisão sobre rollback de `MULTI/EXEC`, flush de gerações misturáveis e, naquele momento, backup sem runtime marker; separaram fato de hipótese; removeram propostas que contrariavam close imediato do Spec 030 e corpo cru do Spec 029; tornaram job/outbox worker/manifest/topologyVersion/reducer opções condicionadas a prova; delimitaram o commit atômico a Redis, com publicação de arquivo posterior e barreira de ownership. O código lido em 27/09 já inclui o marker no backup.

**Revisões 3–4:** acrescentaram o requisito de lease antes de inspecionar/adotar layout (Spec 040), o limite de identidade por hash nativo (Spec 024), a distinção entre materializador PC→Party e política que proíbe esse movimento (Specs 063/071), e reafirmaram evento de movimento vinculado ao commit (Spec 024). Encontraram observer ativo durante backup de startup, backup posterior à migração legada, necessidade de inventariar chaves legadas e v2, e risco de rollback “por fonte” em operações que conectam várias fontes. O plano passou a exigir quiescência verificável de todas as instâncias/workers e checkpoint pré-migração restaurado em isolamento.

Essas revisões não executaram as PoCs propostas. O único teste novo desta fase, além das duas reproduções em memória do Astra, foi a reprodução em memória da exclusão órfã de perfil; não houve teste HTTP desse caso. O próximo chat deve tratar este documento como hipótese técnica rigorosa a verificar, não como implementação aprovada ou prova de produção íntegra.

---
## Appendix — Astra analysis, verbatim

The following report is preserved word for word as the analysis on which this specification is based. Its code locations and findings describe the repository at HEAD `59ad053`; the body below has not been edited for style or reconciled with later changes.

Análise concluída, somente leitura. Repositório: `D:/PROJETOS/emulator-hub`, HEAD `59ad053`. Não alterei arquivos, não executei build. Havia alterações preexistentes em `.spec/README.md` e `.spec/074-gen3-event-save-research.md`. Usei investigação sistemática e duas reproduções isoladas em memória.

## 1. Conclusão principal

A complexidade é estrutural: o mesmo workspace tem várias representações parcialmente autoritativas, protocolos antigos continuam acessíveis, a sincronização divide uma transferência entre várias gravações independentes e o ciclo de ownership divide-se entre três leases.

Encontrei:

1. **Um defeito confirmado no frontend que explica a mensagem “The source save is not loaded in this workspace” depois de uma correção do servidor.**
2. **A origem precisa da rejeição `Snapshot slot is invalid`, mas não o slot concreto enviado na produção.** Não há payload ou source snapshot no log.
3. **Um defeito confirmado de atomicidade na transferência:** falha entre gravações deixa o Pokémon sem placement em ambas as fontes.
4. **Uma inconsistência concreta no cleanup de leases expirados**, compatível com `HUB_LEASE_INVALID`.
5. **Lacunas adicionais de persistência e ownership** que impedem afirmar “100% de integridade” sobre a implementação atual.

A especificação deve converter a exigência de integridade em invariantes e critérios verificáveis, sem prometer certeza absoluta nem relaxar validações.

## 2. Incidente: cadeia de evidências

### 2.1 Rejeição do snapshot na produção — fato

Arquivo de log, linhas 5767–5792:

- 15:42:44.887Z;
- perfil `b752bc20-3e51-4fdd-8280-910ce7e7e5c3`;
- sessão `6e7b6108-22e7-486d-a440-ec8ae1fb754c`;
- operação `ce4c05d4-05c1-4fc4-acf5-3b331b208320`;
- `SNAPSHOT_INVALID: Snapshot slot is invalid.`;
- stack em `pokemon-hub-session-service.mjs:784`, chamado da linha 338.

`apps/packages/pokemon-hub-session-service.mjs:768–785` transforma o snapshot compacto em placements usando a geometria persistida da fonte. A linha 784 rejeita quando o cliente pede um slot que **não existe em `source.placements`**.

Isso não é uma rejeição por Pokémon incompatível nem pelo save não estar carregado. É desacordo entre topologia enviada e topologia persistida.

O erro acontece **antes de `coordinator.sync`**, que só é chamado na linha 348. Portanto essa requisição específica não chegou à etapa que grava placements novos. Isso não demonstra o estado das requisições anteriores.

### 2.2 A correção do servidor pode destruir a referência local do save — confirmado

Em `apps/packages/pokemon-hub-ui.jsx`:

- Linhas 124–147: na abertura da sessão, `snapshotFlight` recebe callbacks que capturam funções do render de abertura.
- Linhas 135–139: qualquer correção chama aquele `applyCanonicalSessionSnapshot`.
- Linha 316: calcula panes visíveis usando `pokemonHubPanesRef.current.length`, atualizado.
- Linha 318: reconstrói snapshots com `snapshot.panes.slice(0, pokemonHubPanes.length)`, **capturado no render antigo**.
- Linha 327: substitui os snapshots locais pelo subconjunto reconstruído.
- Linhas 359–363: se um snapshot desapareceu, mantém o layout visual anterior.
- Linhas 211–214: drag posterior encontra o save visível, mas sem snapshot, e lança exatamente `The source save is not loaded in this workspace.`

O workspace começa com um pane (`pokemon-hub-workspace.mjs:1–2`). Se a sessão abre nessa configuração e depois ganha um segundo pane, uma correção posterior pode manter ambos visíveis e apagar o snapshot do segundo.

**Reprodução em memória, usando as próprias funções extraídas do arquivo:**

```json
{
  "visiblePanes": [
    {"kind":"hub","hubProfileId":"h"},
    {"kind":"game","gameId":"g","profileId":"p"}
  ],
  "retainedSnapshots":["hub:h"],
  "gameSaveSnapshotDropped":true
}
```

Isso prova o defeito; não prova a ordem exata dos panes do usuário naquele momento. É uma explicação forte para a mensagem relatada, condicionada à ordem de abertura dos panes.

### 2.3 Gatilho do slot inválido — ainda não determinado

Há desacordos reais que precisam desaparecer:

- UI cria **60 placements fixos** para Hub: `pokemon-hub-ui.jsx:789–793`.
- UI renderiza quantidade dinâmica de slots: `pokemon-hub-ui.jsx:578,596`.
- A quantidade visível depende de largura, linhas e maior ocupação: `pokemon-hub-grid.mjs:17–25`.
- Validador canônico admite slots Hub até `Number.MAX_SAFE_INTEGER`: `pokemon-hub-canonical-session-snapshot.mjs:24–27`.
- Backend cria 60 slots somente no caminho de fonte inexistente: `server.mjs:1895–1897,1912–1924`.
- Existe expansão de fontes persistidas: `pokemon-hub-snapshot-coordinator.mjs:72–88`, mas o caminho HTTP usual não a chama para uma fonte existente.

Portanto fontes antigas menores, geometria divergente ou crescimento do grid são possíveis causas. **Não afirmar que foi um limite de 60 ou erro de segunda linha:** uma fonte normal Gen III contém todos os slots de Box e Party (`pokemon-gen3-adapter.mjs:30–43`), e o log não revela qual pane/slot foi rejeitado.

Além disso, tentar um slot Hub acima de 59 pode falhar antes no frontend, porque `applyLocalSessionMove` acessa `placements[toSlot].pokemonInstanceId` sem expandir o array (`pokemon-hub-ui.jsx:232`). Isso é outro defeito de geometria, não prova daquele stack.

A correção backend também perde a razão específica nesse caminho: `pokemon-hub-session-service.mjs:391–404` chama `canonicalReject` sem o erro; a resposta conserva somente snapshot. O frontend mostra mensagem genérica.

### 2.4 Lease expirado — defeito concreto, correlação limitada

Às 15:43:48, log linhas 5793–5796: `HUB_LEASE_INVALID`.

Fluxo atual:

1. Observer chama `releaseExpired`, com `ignoreLeaseInvalid: true`: `server.mjs:159–164`.
2. `releasePokemonHubSessionSources` faz flush e release: `server.mjs:1077–1085`.
3. `coordinator.release` apaga lease da fonte e índices primeiro: `pokemon-hub-snapshot-coordinator.mjs:234–245`.
4. Depois chama `gameSaveLeases.releaseHub`.
5. O coordenador global rejeita release de lease expirado: `game-save-lease-coordinator.mjs:36–45,109`.
6. O wrapper só ignora `LEASE_INVALID`, não `HUB_LEASE_INVALID`.

Há portanto um caminho natural para esse erro mesmo sem corrupção. O observer captura uma exceção ao redor do lote inteiro (`server.mjs:158–169`); uma falha interrompe o processamento das fontes/sessões restantes naquela passagem.

O log não inclui identidade no erro do observer, então não permite associá-lo com certeza à sessão das 15:42:44 nem afirmar que todo o processo travou.

## 3. Fluxo atual end-to-end

### Leitura e abertura

- UI carrega catálogo e Hub profiles.
- Selecionar save chama `getSaveProfileLayout` antes do carregamento canônico: `pokemon-hub-ui.jsx:260–266`.
- Backend lê `.sav`, inspeciona binário e consulta/adota source snapshot Redis: `server.mjs:841–882`.
- `adoptPokemonHubSave` extrai todos os slots e registros nativos: `pokemon-hub-save-adoption.mjs:1–14`.
- `coordinator.adopt` cria/reutiliza identidades por hash de bytes e grava records, source e eventos: `pokemon-hub-snapshot-coordinator.mjs:107–164`.
- UI abre sessão e faz `loadCanonicalPane`.
- Backend adquire ownership, produz pane a partir da fonte, persiste sessão: `pokemon-hub-session-service.mjs:91–129`.
- UI usa a resposta para a revisão, mas mantém o snapshot montado a partir da leitura anterior: `pokemon-hub-ui.jsx:276–297`.

**Problema:** leitura prévia e aquisição autoritativa são duas operações, e a UI não hidrata tudo da resposta autoritativa adquirida.

### Movimento

- Drag aplica regras locais e altera placements locais: `pokemon-hub-ui.jsx:166–242`.
- Agenda snapshot em ~500 ms: linhas 331–340,736–742.
- `snapshotFlight` serializa envios e correções: `pokemon-hub-snapshot-flight.mjs`.
- Sessão valida forma/revisão, adquire fontes novas, faz flush de fontes removidas, transforma slots, verifica conservação de membros e chama coordinator: `pokemon-hub-session-service.mjs:254–356`.
- Coordinator valida leases, revisão, slots, Party, duplicação, identidade e política: `pokemon-hub-snapshot-coordinator.mjs:318–383`.
- Coordinator grava fontes, records, eventos e resultado de idempotência: linhas 385–425.
- Sessão grava canonical snapshot e resultado externo: `pokemon-hub-session-service.mjs:374–386`.

### Persistência no save

- Durante movimento, Redis guarda placement autoritativo; `.sav` pode continuar anterior, marcado por `needsSaveFlush`.
- Ao remover fonte, fechar ou expirar, materializador projeta os records no binário.
- `pokemon-hub-save-flush.mjs:44–81` lê save, materializa, faz put com revisão/fence, invalida runtime states e marca source limpo.
- Adapter conserva representações nativas e recalcula checksums: `pokemon-gen3-adapter.mjs:52–86`.
- Runtime snapshots do emulador (`cloud-recovery`, `user-state`) são apagados/invalidados após alterações Hub: `pokemon-hub-save-flush.mjs:68–78`.

**É essencial distinguir** snapshot de placements do Hub, `.sav` e snapshot de runtime do emulador. São artefatos diferentes com autoridade e validade diferentes.

## 4. Lacunas de integridade comprovadas ou diretamente verificáveis

### 4.1 Transferência entre fontes não é atômica — reprodução confirmada

`pokemon-hub-snapshot-coordinator.mjs:387–424` grava cada source separadamente, depois records, depois eventos, depois idempotência. O claim atômico da sessão não engloba essas gravações.

Reproduzi com duas fontes em memória e erro na gravação da segunda:

```text
injected-second-source-write-failure
origem: slot vazio
destino: slot vazio
record: placement ainda aponta para origem
```

O registro nativo continua existindo, mas o Pokémon desaparece de ambas as projeções. Dependendo da ordenação/origem, interrupções também podem criar duplicação temporária.

A sessão ainda pode executar rollback apenas do documento de sessão (`pokemon-hub-session-service.mjs:601–611`), deixando fontes já alteradas. Não é rollback da transação de transferência.

### 4.2 `.sav` e metadados são dois commits

`save-store.mjs:48–51`: escreve bytes atomicamente, depois metadata atomicamente. `get` lê os dois em paralelo e valida hash (`74–82`).

Crash ou leitura intermediária entre renames pode produzir bytes novos com metadata antiga e erro de integridade. O lock protege writers, mas `get` não usa esse lock. Não executei injeção de falha em disco; evidência é a ordem de operações.

Requisito para spec: publicar uma geração completa por manifest/pointer atômico ou mecanismo equivalente; manter versão anterior recuperável.

### 4.3 Expiração pode liberar jogador antes da projeção final

O lease global trata lease expirado como disponível (`game-save-lease-coordinator.mjs:9,12–33`). O flush é executado depois por observer. Não há estado global durável “finalizando save” preservando exclusão até materialização concluída.

Assim, jogador pode adquirir após expiração enquanto Redis ainda tem `needsSaveFlush`. Controle de revisão pode impedir parte das sobrescritas, mas não garante que o jogador iniciou no save materializado correto.

### 4.4 GET de layout mistura duas gerações

`server.mjs:860–882` usa ocupação/display da inspeção do `.sav`, mas IDs do source snapshot Redis. Se Redis está dirty, `.sav` pode estar anterior; aparecem combinações que nunca existiram como estado autoritativo único.

Além disso o GET pode adotar/gravar records sem adquirir ownership Hub primeiro. Isso aumenta corridas e torna leitura uma operação de mudança de autoridade.

### 4.5 Ownership e identidade dependem do workspace profile

Redis key de source é escopada pelo `profileId` do workspace (`pokemon-hub-redis-keys.mjs`), enquanto o próprio `sourceKey` contém perfil físico do save. `server.mjs:863–872` permite `workspaceProfileId` diferente.

Uma mesma fonte física pode ter projeções/identidades em namespaces diferentes. O lease global coordena acesso ativo, mas isso não unifica o estado durável nem a identidade. O spec deve definir um dono estável para o domínio e uma única identidade física de fonte, independente do primeiro pane aberto.

### 4.6 Fechamento local antecede confirmação

`pokemon-hub-ui.jsx:392–409` captura snapshot final, apaga referências, fecha UI e só depois envia close; não drena explicitamente o flight/gate anterior.

Expiração só finaliza o que chegou ao servidor. Ela não recupera movimentos locais não enviados. A especificação deve definir precisamente quando um movimento é considerado salvo e como retry/close preserva a intenção pendente.

## 5. Por que a complexidade cresceu

Há quatro eixos de duplicação:

- **Estado:** panes, snapshots em state/ref, layouts, Hub profiles/grid, canonical snapshot da sessão, source snapshots, record placement e `.sav`.
- **Versões:** session version/canonical revision, sourceRevision, snapshotRevision, saveRevision, clientSequence, operation generation e fence generation.
- **Ownership:** sessão, lease da fonte e lease global save/player, com finalizadores separados.
- **Protocolos:** canonical session, compact session, snapshots diretos, grid transfer e serviço anterior coexistem no backend/client.

Referências: inicialização `server.mjs:101–139`; API legada/atual em `hub-client.js:117–261`; `syncSnapshot` e `syncCanonicalSnapshot` no mesmo session service.

Não recomendo apagar esses caminhos sem inventariar consumidores. Recomendo que o spec estabeleça um protocolo alvo e critérios para remoção dos demais, evitando compatibilidade indefinida.

## 6. Arquitetura recomendada para o spec

1. **Uma autoridade durável para placements e identidades.** Source físico identificado independentemente de sessão; records têm identidade estável e representação nativa imutável/versionada.
2. **Uma transação de domínio para cada mudança aceita.** Validate/plan puro; commit condicional único engloba placements de todas as fontes, revisão, record placement, estado da sessão necessário, idempotência e outbox/evento.
3. **Um lifecycle de ownership.** Owner/fence por save; sessão referencia ownership. Expiração entra em finalização; somente publicação validada do `.sav` permite novo player.
4. **Um modelo de workspace no frontend.** Estado autoritativo recebido + intenção local pendente. Views são derivadas, correção substitui/hidrata o conjunto completo. Nenhum pane “carregado” sem source correspondente.
5. **Uma topologia explícita e compartilhada.** Backend fornece slots válidos/capacidade. Coordenadas de Party/Box/Hub não dependem da largura da UI. Crescimento Hub é operação definida ou representação esparsa suportada por contrato; não um array artificial de 60.
6. **Um serviço de projeção no `.sav`.** Jobs duráveis e idempotentes por source revision, publication consistente, invalidação de runtime states na mesma decisão lógica; recovery retoma do checkpoint.
7. **Regras separadas da infraestrutura.** Política pura recebe source/destination/record/capabilities; mudança de regra não altera sessões, leases, serialização ou persistência.
8. **Observabilidade de domínio.** Operação, fonte, localização rejeitada, geometria esperada, revisões e fase da finalização; sem bytes completos de save ou tokens.

Redis já oferece `eval` e chaves com hash tag, mas nem todas as relações globais estão no mesmo domínio/tag. Não escolher “um Lua gigante” sem definir o limite transacional. Não há necessidade demonstrada de substituir banco para escrever o spec; a obrigação é o contrato atômico e sua prova de falhas.

## 7. Invariantes e aceitação indispensáveis

- Conservação do multiconjunto de IDs numa transferência; nenhum ID novo ou removido implicitamente.
- Cada Pokémon possui exatamente um placement autoritativo.
- Destino livre quando a operação cruza fontes; Party permanece válida.
- Bytes nativos e checksums preservados fora de modificações autorizadas.
- Publicação condicionada à revisão e fence atuais.
- Repetir uma operação com mesma identidade e payload produz mesmo resultado; payload diferente é conflito.
- Crash em qualquer fase resulta em estado anterior ou estado novo completo, ou finalização durável retomável que bloqueia writers incompatíveis.
- ACK ao usuário tem definição de durabilidade explícita.
- Abrir player nunca lê save anterior a alterações Hub já confirmadas.
- Correção/reconexão não deixa fontes visíveis sem snapshots.
- Geometria não muda ao redimensionar janela.
- Runtime state anterior à edição Hub não restaura um universo de Pokémon obsoleto.

Cenários prioritários:

1. Sessão aberta com um pane, depois dois/três, correção, novo drag em todos.
2. Slots da primeira e segunda linha, borda de Box, índices 59/60, Hub com legado menor/maior e resize.
3. Falha em cada escrita entre origem/destino/records/event/idempotência.
4. Mesmo comando após timeout/perda da resposta.
5. Crash entre bytes/metadata e entre save publicado/source marcado limpo.
6. Expiração simultânea a close, drag, pane load e abertura de player.
7. Dois backends/duas sessões disputando a mesma fonte.
8. Reabertura de save dirty e acesso pelo workspace com outro perfil inicial.
9. Restauro de backup coerente entre Redis e `.sav`.
10. Mudança de regra de transferência sem mudança no protocolo.

## 8. Limites e próximo passo útil

O log comprova rejeição de topologia e erro posterior de cleanup; não comprova queda completa do processo, corrupção de produção ou o slot específico. A reprodução confirma a falha de correção no frontend e a falta de atomicidade do coordinator.

Para fechar o gatilho original, seriam necessários o payload/revisões/topologia da fonte na sessão citada ou reprodução com o mesmo estado persistido. O spec pode avançar agora: deve resolver o mecanismo de divergência e recuperação, prever coleta dessa evidência e exigir reprodução do incidente antes de declarar correção implementada.

A exigência “100% de integridade” deve orientar bloqueios e testes de falha. A configuração efetiva de durabilidade Redis não foi verificada; o baseline documentado em `.spec/019-redis-application-persistence.md:18` é AOF `everysec`, que não equivale a garantia de zero perda de ACK sob toda falha física. O contrato de durabilidade e backup precisa estar explícito na especificação.
