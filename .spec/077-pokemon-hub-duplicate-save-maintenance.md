---
title: Pokemon Hub duplicate save maintenance and snapshot reconciliation
date: 2026-09-27
tags: [spec, pokemon-hub, saves, snapshots, reconciliation, integrity, maintenance]
status: data-maintenance-complete-structural-work-pending
---

# Spec 077 — Duplicatas entre Hub e saves Gen III

## Escopo e autoridade

Este documento registra a evidência de produção encontrada em 27/09/2026 e o contrato de manutenção para impedir que um Pokémon já transferido ao perfil Hub reapareça em um `.sav`. Complementa os Specs 024, 025, 040, 059, 070 e 075. O pedido de manutenção imediata é remover dos dois saves as ocorrências identificadas abaixo e preservar as do Hub. Nenhuma conclusão sobre a causa raiz fica implícita na limpeza dos dados.

O perfil Hub afetado é o primeiro e único perfil do catálogo de produção, **Geral**, `hubProfileId=d74f7a29-b001-4f37-9410-f409e55d0dac`, vinculado ao backend profile `b752bc20-3e51-4fdd-8280-910ce7e7e5c3`. A namespace efetiva de produção é `emulator-hub:v1`. O source autoritativo do Hub é `pokemon-hub:v2:{ph:b752bc20-3e51-4fdd-8280-910ce7e7e5c3}:source:hub%3Ad74f7a29-b001-4f37-9410-f409e55d0dac`, sob essa namespace.

## Evidência somente de leitura, antes da manutenção

Às 22:05–22:06 UTC, foram lidos o source do Hub, seus records, os oito `.sav` Ruby/Sapphire/Emerald vinculados ao workspace, seus metadados de revisão/hash e os oito sources desses saves sob o backend profile dono do Hub. A leitura usou `pokemonGen3Adapter.readAllSlots` sobre o arquivo inteiro e comparou os primeiros 80 bytes de cada representação nativa; para Pokémon na Party, os 20 bytes seguintes são estado de runtime e não entram na comparação com um slot de PC. A repetição às 22:06:56 UTC confirmou que os oito hashes de `.sav`, as oito source revisions e a Hub source revision permaneceram inalterados durante a auditoria.

| Medida | Resultado |
| --- | --- |
| Hub Geral | source revision 202, 155 placements ocupados, 155 IDs distintos, 155 records com bytes |
| Oito saves | 5 Ruby, 2 Sapphire, 1 Emerald; 83 Pokémon ocupados no total |
| Arquivo vs metadata | SHA-256 válido nos oito `.sav` |
| Source de save vs arquivo | 83/83 placements ocupados conferem byte a byte com os records e os slots dos arquivos; `needsSaveFlush=false` nos oito |
| Mesmo core de 80 bytes entre Hub e saves | **2 pares** |
| Mesmo PID + original trainer ID com core diferente entre Hub e saves | 0 pares adicionais |
| Mesmo `pokemonInstanceId` simultaneamente no Hub e nesses oito sources | 0 pares; cada reaparição recebeu ID novo |
| Mesmo core repetido dentro do Hub | 0 pares |

### Caso A — Gloom (#44)

- Hub: slot interno 35, posição visual **36**, `pokemonInstanceId=5572ee7b-d90a-4b23-8b0d-8504e7774391`. O record conserva representação `party-record` de 100 bytes, core SHA-256 `4e4d3c982647a62799389de345c6ba3531545b7bc7d200fb8b516205dbe9464d`.
- Save: Pokémon Sapphire, profile `5fe3e604-36c9-4878-a772-1b1aa5886c03` (“Post Game - Tem MB”, criado em 18/09), game `rom-89b45fb172e6b55d51fc0e61989775187f6fe63c`, **Box 1, slot 13** (índices internos box 0, slot 12). O record atual no source de save é `a8a85d94-db14-4e08-9e4c-280bbd26aca3`, representação `pc-record` de 80 bytes, mesmo core SHA-256.
- Evento: o ID preservado no Hub foi observado na Party, slot interno 5, às `21:35:56Z` e transferido para o Hub às `21:39:08Z`. O arquivo `.sav` atual foi gravado às `21:56:06Z`. O novo ID do slot de Box foi observado por adoção às `21:59:28Z`. A evidência mostra reaparição posterior à transferência; não identifica qual writer recolocou os bytes no arquivo.
- Antes da manutenção: save revision 69, source revision 83, `needsSaveFlush=false`, SHA-256 do arquivo `ade759444a4d5ddafe5b422a26629a525f2f2564b80b708a915b623bc83e760a`.

### Caso B — Doduo (#84)

- Hub: slot interno 90, posição visual **91**, `pokemonInstanceId=ad3bd77b-3117-48f6-a95d-38ed88be4b89`, representação `party-record` de 100 bytes, core SHA-256 `81e1560944dd6846fd77c984314dc9d7f4fb599608975d5eceb5f47bca244617`.
- Save: Pokémon Ruby, profile `5cf5d8af-1bae-46fa-ab94-41ffd25f1915` (“Post Game - Sem MB”, criado em 25/09), game `rom-5b64eacf892920518db4ec664e62a086dd5f5bc8`, **Box 1, slot 7** (índices internos box 0, slot 6). O record atual no source de save é `8eabfdb0-e34b-4c9b-8776-c78f65a14c9f`, representação `pc-record` de 80 bytes, mesmo core SHA-256.
- Evento: o ID preservado no Hub foi observado na Party, slot interno 5, às `21:35:45Z` e transferido para o Hub às `21:42:11Z`. O arquivo `.sav` atual foi gravado às `21:54:31Z`. O novo ID do slot de Box foi observado por adoção às `21:58:53Z`. A evidência mostra reaparição posterior à transferência; não identifica qual writer recolocou os bytes no arquivo.
- Antes da manutenção: save revision 53, source revision 51, `needsSaveFlush=false`, SHA-256 do arquivo `cab96755f2bf121727e1ff2ead5ab2ed6d7ef03dc47cf76a58eb4fd27ed4ee1d`.

## Interpretação e limite da prova

Byte equality do core mais a origem, o evento de transferência e a reaparição no mesmo save constituem evidência forte de duplicação operacional. PID, trainer ID, hash ou espécie isoladamente não são identidade global (Spec 024); por isso, o procedimento não presume que qualquer ocorrência semelhante em outro save seja uma duplicata. Os dois IDs novos foram criados ao readotar os saves já contendo os bytes. A diferença entre o horário do evento de transferência e o mtime do `.sav` torna plausível reintrodução por writer ou state antigo, mas os dados coletados **não provam** se o gatilho foi flush, save do player, restore de runtime snapshot, sessão em outro backend profile ou outra sequência. Investigar logs, revisões e interleavings antes de atribuir causa raiz.

**Ampliação às 22:12 UTC:** o mesmo Sapphire físico aparece em **5** sources Redis sob owners diferentes; o mesmo Ruby físico aparece em **6**. Nenhum tinha lease ativo ou `needsSaveFlush=true` naquele instante. Vários tinham `saveRevision` antiga e ocupação diferente do arquivo físico atual. Os sources do próprio perfil de cada save e os do owner do Hub ainda continham a duplicata com IDs distintos; os demais variavam entre bytes antigos, posição vazia e outros registros. A manutenção precisa reconciliar todos os 11 sources com o arquivo resultante, porque um workspace aberto por outro owner pode tomar um snapshot obsoleto como autoridade e ressuscitar conteúdo antigo.

## Manutenção autorizada para estes dois casos

1. Antes de modificar, verificar no mesmo instante as duas ocupações, hashes de core e IDs do Hub, hashes/revisões dos `.sav`, sources, ausência de `needsSaveFlush` e ownership/leases. Se houver divergência, interromper sem apagar nada.
2. Preservar cópia verificável dos dois `.sav` e metadados originais, junto aos dois sources de save, ao source do Hub e aos quatro records envolvidos, em armazenamento operacional fora de Git. O backup permite recuperar um erro de alvo ou falha entre etapas.
3. Aplicar a limpeza unicamente nos slots PC especificados, usando o adapter Gen III para recalcular checksums setoriais. Publicar cada arquivo pelo save store com revisão esperada, fence vigente e invalidação dos runtime states anteriores; limpar as projeções de runtime `cloud-recovery` e `user-state` correspondentes antes de liberar o save para jogo.
4. Conciliar os dois sources de save com os novos arquivos sob ownership exclusivo e revisão condicional. O Hub source e os dois records que ele referencia não podem ser alterados. Conservar os records/events históricos das ocorrências removidas até existir política de tombstone ou arquivamento; sua presença sem placement em source não autoriza ressuscitar o Pokémon.
5. Verificar após a manutenção: slots vazios nos `.sav`, metadados/hash/revisão coerentes, 155 Pokémon do Hub com os mesmos IDs/bytes/slots, demais 81 Pokémon dos oito saves byte a byte preservados, sources dos dois saves coincidentes com arquivo e `needsSaveFlush=false`, nenhuma duplicata desses dois cores no conjunto auditado. Registrar os valores finais aqui. Se um passo falhar, manter os saves bloqueados para escritores concorrentes e executar recuperação explícita a partir do preimage; não declarar sucesso parcial.

## Trabalho estrutural exigido dos snapshots

- **Uma autoridade por save físico.** Identificar e cercar um source pelo `(profileId, gameId)` do arquivo físico, independentemente de qual backend profile iniciou o workspace. Sources duplicados em owners distintos não podem divergir silenciosamente nem reimportar bytes de uma revisão antiga.
- **Ordem e reconciliação.** Transferência confirmada para o Hub deve ter movimento de placement, revisão de source, publicação do `.sav` e invalidação de runtime state ligados por um estado recuperável. Um arquivo/revisão anterior não pode ser readotado como fonte nova sem resolver a divergência com o movimento confirmado. O player deve receber apenas `.sav` que incorpore todos os movimentos Hub confirmados.
- **Readopção consciente de linhagem.** `coordinator.adopt` hoje reutiliza records por hash dentro do source anterior e cria um novo ID se o core reaparecer depois que o record original passou ao Hub. Isso permite que a reintrodução se torne dois IDs válidos. Definir procedimento explícito para classificar reaparição de bytes já movidos: bloquear, reconciliar ou exigir decisão humana conforme prova; não fundir automaticamente IDs por PID/hash, pois clones legítimos são possíveis.
- **Commit e projeção.** Sources, records, eventos e idempotência de um movimento aceito precisam de decisão atômica ou recovery durável equivalente, seguida por projeção do arquivo e marker de invalidação de runtime. Crash em qualquer etapa deve impedir acesso a save velho. Revisões e fences condicionam toda publicação; `needsSaveFlush=false` só depois de confirmar o arquivo e as projeções necessárias.
- **Diagnóstico mínimo.** Registrar source físico, source owner, revisão de arquivo, source revision, snapshot revision, operação que alterou placement, origem da readoção e digest do core (sem expor bytes nativos). Fornecer auditoria somente de leitura capaz de detectar: mesmo ID em dois placements, mesmo core no Hub e em save, record órfão, source divergente do arquivo e runtime snapshot anterior ao marker.
- **Ensaios.** Reproduzir transferência Party→Hub, flush, close, save posterior no player, restore de runtime state, reabertura sob outro backend profile, perda de resposta, reinício entre source write/record write/evento e entre publicação dos bytes/metadata. Cada ensaio afirma conservação de IDs/bytes, ausência de ressurgimento, revisão/fence monotônica, Hub preservado e bloqueio seguro quando a ordem não puder ser provada. Testes com clones intencionais confirmam que coincidência de hash sozinha não apaga dados.

Esses requisitos devem ser reconciliados com o plano de simplificação do Spec 075: uma solução por invariante, sem mais um mecanismo paralelo de snapshot. Nenhuma implementação estrutural está autorizada implicitamente por este registro de manutenção.

## Resultado da manutenção

**Execução autorizada pelo usuário e concluída em 27/09/2026, 22:15 UTC, na VPS de produção.** Não houve alteração de código, build, commit ou deploy nesta manutenção. As operações usaram leases globais dos dois saves e lease do source Hub, o save store com revisão/fence esperados e invalidação de runtime, o adapter Gen III para zerar cada slot e recalcular checksums, e a adoção existente para reconciliar os 11 sources Redis dos dois arquivos físicos. Os leases foram liberados após a verificação no processo de manutenção.

Antes da primeira gravação, foi conferido e relido o preimage em `/app/apps/backend/data/backups/pokemon-hub-duplicate-maintenance-20260927T221521-11d429af-b90a-4e9b-bc06-3a964b7f84b8.json` (SHA-256 `19fe5ff6d2c096f8e7fc5699dccbf73345bd95e30c94da24a24da2a0e5cfcc2a`). Contém bytes e metadados originais dos dois `.sav`, os 11 documentos source, o source Hub, os dois records do Hub e os runtime states existentes dos dois saves. O backup está no volume persistente da aplicação, fora do Git; não é proteção independente contra perda do próprio volume.

Os dois records dos slots de save, que não foram alterados pelo procedimento, foram copiados separadamente em `/app/apps/backend/data/backups/pokemon-hub-duplicate-maintenance-20260927T221521-11d429af-b90a-4e9b-bc06-3a964b7f84b8-save-records.json` após a manutenção, com leitura de volta e SHA-256 `b3ae85ca0a6273bbae3c79b0ff48ffdb7781c41db9d63e2d7638d29da4f09c28`. Sua captura é posterior à primeira gravação, mas os records não estavam no conjunto de chaves mutadas; o preimage dos bytes nativos já constava dos `.sav` copiados antes da gravação.

| Save | Slot limpo | Revisão antes → depois | SHA-256 do `.sav` depois | Ocupação depois | Sources reconciliados |
| --- | --- | --- | --- | ---: | ---: |
| Sapphire `5fe3e604…` | Box 1, slot 13 | 69 → **70** | `06f37010d7b99366bd157b9c836d8e7e106802286bf6fc6e64c6274a68095780` | 13 | 5 |
| Ruby `5cf5d8af…` | Box 1, slot 7 | 53 → **54** | `6043ed7f56e6373e5bab3e83ec376ed9384024d1f0b4a3d2dd283a09d9e5d482` | 7 | 6 |

**Verificação independente às 22:16 UTC:** os dois slots estão vazios nos `.sav`; todos os demais records nativos desses arquivos são byte a byte iguais aos preimages; SHA-256 dos outros seis `.sav` permaneceu igual à auditoria inicial; os 11 sources passaram a refletir integralmente os arquivos respectivos e `needsSaveFlush=false`, com `sourceRevision` incrementada uma vez por source. Os metadados dos dois saves contêm os novos hashes e `runtimeStateInvalidatedAtRevision` igual à nova revisão. `cloud-recovery` e `user-state` dos dois saves estão ausentes. O Hub segue na revision 202 com 155 placements, source e dois records envolvidos byte a byte iguais ao backup. O conjunto dos oito saves contém agora 81 Pokémon, sem core de 80 bytes coincidente com os 155 do Hub.

**Limite:** a limpeza e a reconciliação eliminam as duas duplicatas observadas e os sources obsoletos encontrados neste momento. Não demonstram a causa raiz da reintrodução nem impedem nova ocorrência por um fluxo ainda não corrigido. Os records e eventos históricos dos IDs removidos foram conservados; não constituem placements atuais. Os requisitos estruturais acima permanecem pendentes.
