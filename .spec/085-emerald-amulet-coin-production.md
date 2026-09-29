---
title: Pokémon Emerald production Amulet Coin grant and open progression issue
date: 2026-09-29
tags: [spec, pokemon-emerald, save, production]
status: open
---

# Spec 085 — Amulet Coin no save de produção

Esta é a spec canônica desta conversa. O pedido imediato é colocar exatamente um Amulet Coin (`ITEM_AMULET_COIN`, ID 189) no bolso normal de itens da Bag do perfil de Pokémon Emerald `Falta Rayq - tem MB` em produção. A investigação do bloqueio do evento da mãe permanece aberta.

## Evidência anterior à alteração

- Save de 128 KiB, revisão 102, SHA-256 `278f34f6561c5a6b28be9e74fbf2b5ebd2d9885efca6737a93604b74b4f6737a`, com cópias Gen III válidas. A cópia ativa tem índice 353.
- `FLAG_BADGE05_GET` (`0x86b`) está ativa. `FLAG_HAS_MATCH_CALL` (`0x12f`), `FLAG_ENABLE_MOM_MATCH_CALL` (`0xd8`) e `FLAG_RECEIVED_AMULET_COIN` (`0x85`) estão desativadas nas duas cópias. O item 189 não está na Bag, no PC ou com um Pokémon; o bolso normal de itens usa 15 de 30 slots.
- No roteiro original de Emerald, a mãe exige Match Call antes de verificar a quinta insígnia e tentar entregar o item. O motivo de `FLAG_HAS_MATCH_CALL` estar desativada apesar da quinta insígnia não foi determinado. Fonte: `pret/pokeemerald`, `data/scripts/players_house.inc`; posição da flag e do inventário conferida em `kwsch/PKHeX`.

## Intervenção autorizada

1. Confirmar a identidade do perfil e ausência de lease ativo. Ler novamente bytes e metadados atuais; abortar se mudaram de forma inesperada.
2. Preservar cópias verificáveis dos bytes e metadados anteriores em área privada do volume de produção.
3. Escrever um único item 189, quantidade 1, em um slot vazio do bolso normal da Bag. Respeitar o XOR da quantidade com a chave de segurança Gen III e atualizar o checksum da seção alterada. Preservar os demais bytes, os Pokémon e as flags.
4. Gravar por meio do save store existente com revisão e fence esperados; invalidar runtime states anteriores. Confirmar leitura posterior, checksum, SHA-256 dos metadados, presença do item, ausência de outro item 189 na Bag e invariância das flags.

## Questão pendente

Investigar por que o save tem a quinta insígnia sem `FLAG_HAS_MATCH_CALL` e qual é a ação de progresso correta. A entrega manual do item não resolve essa causa. Como `FLAG_RECEIVED_AMULET_COIN` permanece desativada, o evento normal pode entregar uma segunda unidade quando o Match Call for habilitado. Resolver essa duplicidade ao tratar a causa, sem alterar agora o estado da história.

## Execução em produção

- Em 2026-09-29, o perfil foi confirmado sem lease ativo. A primeira tentativa parou antes de qualquer gravação porque o backend estava reiniciando. Depois que voltou a ficar saudável, os bytes e metadados ainda correspondiam à revisão 102 e ao SHA-256 acima.
- Backup privado verificado: `/app/apps/backend/data/backups/manual-save-edits/emerald-amulet-r102-2026-09-29T21-55-20.068Z-ec721de3-0509-46b0-88bc-f31e84bcc5f5/`, com `before.sav` e `before.json`.
- O item 189, quantidade 1, foi escrito no slot 16 (índice 15) do bolso normal. O save store persistiu a revisão 103 com SHA-256 `720bb6a14702e0548225b50c3762d645edeef8a8e410eb17d6faf0d05db71fab` e invalidou runtime states anteriores.
- A leitura posterior confirmou checksum Gen III válido, exatamente um Amulet Coin no bolso e flags `0x85=false`, `0xd8=false`, `0x12f=false`, `0x86b=true`. A causa do Match Call segue pendente.
