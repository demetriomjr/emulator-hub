---
title: Pokémon Home/Hub — evolução por troca simulada Gen III
date: 2026-09-27
tags: [spec, pokemon-hub, gen3, evolution, save-integrity, research]
status: research-draft
relates: [078-pokemon-hub-pokemon-card-and-save-data.md, 035-generation-iii-regional-transfer-gates.md]
---

# Spec 079 — Evolução por troca simulada Gen III

## Contexto e decisão

Os cinco jogos suportados são Ruby, Sapphire, Emerald, FireRed e LeafGreen. A evolução por troca original ocorre no fluxo de troca: cada jogo avalia o Pokémon recebido e abre a cena naquele momento. Os registros de Pokémon não possuem uma flag persistente de “evoluir ao retirar do PC”; colocar um Pokémon no `.sav`, retirá-lo da Box ou movê-lo para a Party não dispara a cena. Isso foi conferido nos caminhos de [troca e avaliação de Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/trade.c), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/trade.c) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/src/trade_scene.c), e nos respectivos caminhos de armazenamento. Emuladores do produto ainda não executam trocas link entre instâncias.

Foi investigada a possibilidade de um IPS que transformasse um NPC em serviço de evolução. Ela exige modificar scripts/código de cada ROM exata e, sem um protocolo novo, atenderia qualquer elegível da Party, mesmo que nunca tenha sido transferido pelo Hub. A decisão atual é **não usar IPS, NPC, link cable ou manipulação de runtime** para esta feature. O Pokémon Home/Hub apresenta a evolução e grava o resultado íntegro no save de destino. A opção descartada não participa do plano de implementação.

Esta é a **spec única de pesquisa** para esta feature. A referência primária são os decomps [pokeruby](https://github.com/pret/pokeruby) (Ruby/Sapphire), [pokeemerald](https://github.com/pret/pokeemerald) (Emerald) e [pokefirered](https://github.com/pret/pokefirered) (FireRed/LeafGreen). Ruby e Sapphire compartilham uma base; FireRed e LeafGreen compartilham outra, com variações de build. As regras abaixo devem ser derivadas desses repositórios antes de implementar; testes futuros podem usar saves sintéticos descartáveis gerados a partir dos layouts documentados, sem exigir saves reais como fonte da pesquisa.

## Regra de produto registrada

O Pokémon Home/Hub simula a evolução quando um Pokémon elegível **entra em um save de destino** cujo treinador não corresponde ao OT nativo completo desse Pokémon. A entrada pode vir de outro save ou do armazenamento Home/Hub; só mover dentro do mesmo save ou depositar no Home/Hub não dispara a regra. A comparação é `pokemon.otId32 !== destinationSave.playerTrainerId32`, depois de validar o save e extrair os quatro bytes corretos do treinador. `profileId`, nome do profile, jogo de origem (`metGame`) e Trainer ID público de 16 bits não substituem essa comparação. O jogo original evolui na troca mesmo entre treinadores com o mesmo OT; a exigência de OT diferente é uma escolha explícita deste produto.

O fluxo só avalia uma evolução depois de todas as regras existentes de ROM, transferência, lease, revisão e save. Evolução, preview e gravação devem usar o mesmo registro nativo validado. Se elegível, o Home/Hub apresenta a evolução e persiste todos os efeitos no Pokémon e no `.sav` de destino. A mecânica atual de movimentação não muda de “mover” para duplicar por causa da palavra “copiar” usada na descrição do gatilho. O frontend não fornece bytes de save, espécies finais nem resultado de elegibilidade.

## Fontes e alcance da pesquisa

As tabelas originais de evolução das três bases de código são [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/data/pokemon/evolution.h), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/data/pokemon/evolution.h) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/src/data/pokemon/evolution.h). Ruby e Sapphire compartilham a primeira base; FireRed e LeafGreen compartilham a terceira. A varredura de todas as entradas `EVO_TRADE` e `EVO_TRADE_ITEM` dessas tabelas encontrou **11 espécies de origem e 12 resultados**, idênticos nas três bases. Não incluir evoluções posteriores à Gen III, mesmo de espécies presentes nesses jogos.

O comportamento é definido por [avaliadores Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/pokemon_3.c), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/pokemon.c) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/src/pokemon.c), além das cenas [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/evolution_scene.c), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/evolution_scene.c) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/src/evolution_scene.c). Esses caminhos, e não uma hipótese baseada na animação, definem a emulação no Home/Hub.

## Catálogo exaustivo de evoluções por troca

| Origem | Resultado | Condição de troca Gen III |
| --- | --- | --- |
| Poliwhirl | Politoed | King's Rock segurada |
| Kadabra | Alakazam | Troca, sem item exigido |
| Machoke | Machamp | Troca, sem item exigido |
| Graveler | Golem | Troca, sem item exigido |
| Slowpoke | Slowking | King's Rock segurada |
| Haunter | Gengar | Troca, sem item exigido |
| Onix | Steelix | Metal Coat segurada |
| Seadra | Kingdra | Dragon Scale segurada |
| Scyther | Scizor | Metal Coat segurada |
| Porygon | Porygon2 | Up-Grade segurada |
| Clamperl | Huntail | Deep Sea Tooth segurado |
| Clamperl | Gorebyss | Deep Sea Scale segurada |

Os itens exigidos são consumidos no caminho `EVO_TRADE_ITEM` do avaliador original quando a evolução é permitida. `Everstone` impede a evolução pelo efeito de segurar item, inclusive nos casos sem item exigido. O item segurado de um caso sem exigência permanece. Ovo não é candidato válido. Para `Clamperl`, Tooth e Scale são caminhos mutuamente exclusivos pelo item de fato segurado. Os três avaliadores consultam o efeito customizado de `Enigma Berry` quando esse item é segurado; a elegibilidade deve usar o efeito do item no save, não inferir que um ID desconhecido equivale a `ITEM_NONE`.

**FireRed/LeafGreen sem National Dex:** o [avaliador](https://github.com/pret/pokefirered/blob/master/src/pokemon.c) calcula `targetSpecies` mesmo para um resultado posterior a Kanto, mas só consome o item de `EVO_TRADE_ITEM` se `IsNationalPokedexEnabled()` ou se o resultado for de Kanto. Depois, a [cena de evolução por troca](https://github.com/pret/pokefirered/blob/master/src/evolution_scene.c) cancela automaticamente quando `!IsNationalPokedexEnabled()` e `postEvoSpecies > SPECIES_MEW`, antes de gravar a espécie, recalcular stats, atualizar Pokédex ou incrementar o contador. Logo, sem National Dex, **Politoed, Slowking, Steelix, Kingdra, Scizor, Porygon2, Huntail e Gorebyss não se concretizam**, e seus itens exigidos continuam segurados. Alakazam, Machamp, Golem e Gengar são resultados de Kanto e não sofrem esse bloqueio. A simulação deve checar o estado efetivo do National Dex no save de destino antes de oferecer a evolução; não basta observar o valor retornado pelo avaliador.

## Base stats e habilidades efetivas

Os valores abaixo são **base stats** do resultado, na ordem HP/Attack/Defense/Speed/Sp. Attack/Sp. Defense, não os stats finais de um indivíduo. A comparação das tabelas [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/data/pokemon/base_stats.h), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/data/pokemon/species_info.h) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/src/data/pokemon/species_info.h) encontrou os mesmos seis valores e pares de habilidades para estas 23 espécies nas três bases. `—` na segunda habilidade significa que a espécie só tem a primeira.

**Para os stats:** atualizar o ID de espécie no core, preservar EVs/IVs/nature/experiência, derivar o mesmo nível da experiência e recalcular os seis stats de Party pela fórmula Gen III; ajustar HP atual pela diferença entre os HP máximos. Os deltas abaixo são das **bases da espécie**, úteis para conferir a tabela, e **não** quantidades a somar aos stats do indivíduo. Para HP, `floor(((2B + IV + floor(EV/4)) × nível)/100) + nível + 10`; para cada outro stat, aplicar o modificador de nature (90%, 100% ou 110%, com divisão inteira) a `floor(((2B + IV + floor(EV/4)) × nível)/100) + 5`. Assim a diferença final varia entre indivíduos. Um Pokémon em Box guarda a espécie nova, mas não possui os seis stats nem HP atual de Party para reescrever. O código de `CalculateMonStats` em [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/pokemon_1.c), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/pokemon.c) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/src/pokemon.c) é a referência para esse recálculo.

| Evolução | Bases antes → depois (HP/Atk/Def/Spe/SpA/SpD) | Delta de bases |
| --- | --- | --- |
| Poliwhirl→Politoed | 65/65/65/90/50/50 → 90/75/75/70/90/100 | +25/+10/+10/−20/+40/+50 |
| Kadabra→Alakazam | 40/35/30/105/120/70 → 55/50/45/120/135/85 | +15/+15/+15/+15/+15/+15 |
| Machoke→Machamp | 80/100/70/45/50/60 → 90/130/80/55/65/85 | +10/+30/+10/+10/+15/+25 |
| Graveler→Golem | 55/95/115/35/45/45 → 80/110/130/45/55/65 | +25/+15/+15/+10/+10/+20 |
| Slowpoke→Slowking | 90/65/65/15/40/40 → 95/75/80/30/100/110 | +5/+10/+15/+15/+60/+70 |
| Haunter→Gengar | 45/50/45/95/115/55 → 60/65/60/110/130/75 | +15/+15/+15/+15/+15/+20 |
| Onix→Steelix | 35/45/160/70/30/45 → 75/85/200/30/55/65 | +40/+40/+40/−40/+25/+20 |
| Seadra→Kingdra | 55/65/95/85/95/45 → 75/95/95/85/95/95 | +20/+30/0/0/0/+50 |
| Scyther→Scizor | 70/110/80/105/55/80 → 70/130/100/65/55/80 | 0/+20/+20/−40/0/0 |
| Porygon→Porygon2 | 65/60/70/40/85/75 → 85/80/90/60/105/95 | +20/+20/+20/+20/+20/+20 |
| Clamperl→Huntail | 35/64/85/32/74/55 → 55/104/105/52/94/75 | +20/+40/+20/+20/+20/+20 |
| Clamperl→Gorebyss | 35/64/85/32/74/55 → 55/84/105/52/114/75 | +20/+20/+20/+20/+40/+20 |

| Resultado | Base stats HP/Atk/Def/Spe/SpA/SpD | Habilidade slot 0 / slot 1 | Mudança de habilidade em relação à origem |
| --- | --- | --- | --- |
| Politoed | 90/75/75/70/90/100 | Water Absorb / Damp | Mesmo par de Poliwhirl |
| Alakazam | 55/50/45/120/135/85 | Synchronize / Inner Focus | Mesmo par de Kadabra |
| Machamp | 90/130/80/55/65/85 | Guts / — | Mesmo de Machoke |
| Golem | 80/110/130/45/55/65 | Rock Head / Sturdy | Mesmo par de Graveler |
| Slowking | 95/75/80/30/100/110 | Oblivious / Own Tempo | Mesmo par de Slowpoke |
| Gengar | 60/65/60/110/130/75 | Levitate / — | Mesmo de Haunter |
| Steelix | 75/85/200/30/55/65 | Rock Head / Sturdy | Mesmo par de Onix |
| Kingdra | 75/95/95/85/95/95 | Swift Swim / — | Seadra tinha Poison Point |
| Scizor | 70/130/100/65/55/80 | Swarm / — | Mesmo de Scyther |
| Porygon2 | 85/80/90/60/105/95 | Trace / — | Mesmo de Porygon |
| Huntail | 55/104/105/52/94/75 | Swift Swim / — | Clamperl tinha Shell Armor |
| Gorebyss | 55/84/105/52/114/75 | Swift Swim / — | Clamperl tinha Shell Armor |

A habilidade Gen III é resolvida pela **espécie atual + bit de slot de habilidade** do próprio Pokémon; não há uma habilidade independente a ser sorteada no registro. O código de [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/pokemon_2.c), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/pokemon.c) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/src/pokemon.c) lê esses dois dados. Preservar o bit de slot e interpretar a tabela da nova espécie. Para Seadra→Kingdra e Clamperl→Huntail/Gorebyss, a habilidade efetiva muda sem alteração manual do bit. Isso exige validar registros anômalos com slot 1 onde o resultado não tem segunda habilidade; não converter silenciosamente em outro valor.

Os stats finais dependem de **base stats do resultado, nível, IVs, EVs e nature** do indivíduo, e devem ser recalculados com a aritmética inteira Gen III na ordem correta. O projeto já calcula stats para Box→Party em `pokemon-gen3-party-runtime.mjs`, mas evolução de Party existente exige tratar o HP atual. `CalculateMonStats` nos três jogos recalcula HP máximo e cinco stats; se o Pokémon não está desmaiado, ajusta o HP atual pela diferença entre o máximo novo e o antigo; se está desmaiado, mantém HP atual zero. Status, experiência, IVs, EVs e natureza não devem ser reiniciados. Box guarda só o core de 80 bytes e não tem HP atual de Party para atualizar.

As 12 linhas da matriz mantêm o **mesmo growth rate** entre espécie de origem e resultado nas três bases de código, de modo que a experiência acumulada pode permanecer e o nível não precisa ser artificialmente alterado. Ainda assim, a rotina deve recomputar/verificar o nível a partir da experiência ao materializar Party, em vez de confiar em um byte de nível possivelmente inconsistente.

Tipo e proporção de sexo são propriedades da espécie, não campos que precisem ser gravados separadamente no Pokémon. Destas evoluções, três mudam de tipo: **Onix Rock/Ground → Steelix Steel/Ground**, **Seadra Water → Kingdra Water/Dragon** e **Scyther Bug/Flying → Scizor Bug/Steel**. Todas as 12 linhas mantêm a mesma proporção de sexo entre origem e resultado nas tabelas dos três jogos. Esses fatos foram comparados nas mesmas tabelas de espécie citadas acima; a UI deve rederivar tipo da espécie nova e não conservar um cache da antiga.

## Moves que podem surgir no momento da evolução

O jogo **não dá automaticamente um move fixo apenas por ser uma trade evolution**. Depois de mudar a espécie, a cena chama `MonTryLearningNewMove` para o **nível atual** do Pokémon. Se o learnset da espécie nova tiver um ou mais moves nesse nível exato, oferece cada um; se já o conhece, não duplica; se os quatro slots estiverem cheios, o jogador pode escolher qual substituir ou recusar. Não aprender retroativamente todos os moves de níveis anteriores. Isto está no [código de aprendizado de Emerald](https://github.com/pret/pokeemerald/blob/master/src/pokemon.c) e na [cena de evolução](https://github.com/pret/pokeemerald/blob/master/src/evolution_scene.c); Ruby/Sapphire e FR/LG usam a mesma regra geral.

Abaixo estão **todos os níveis não iniciais** do learnset dos 12 resultados; em cada entrada `nível:move`, esse move é candidato se a evolução ocorrer exatamente naquele nível. As fontes são os learnsets [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/data/pokemon/level_up_learnsets.h), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/data/pokemon/level_up_learnsets.h) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/src/data/pokemon/level_up_learnsets.h). Ruby/Sapphire e Emerald coincidem nestas 12 espécies; FR/LG difere nas linhas indicadas. Entradas de nível 1 são listadas separadamente porque a maioria das origens não é obtida nesse nível por jogo normal, mas o editor não pode presumir isso para todo save.

| Resultado | Ruby/Sapphire/Emerald: níveis com move | FireRed/LeafGreen |
| --- | --- | --- |
| Politoed | 35 Perish Song; 51 Swagger | Igual |
| Alakazam | 16 Confusion; 18 Disable; 21 Psybeam; 23 Reflect; 25 Recover; 30 Future Sight; 33 Calm Mind; 36 Psychic; 43 Trick | Igual |
| Machamp | 7 Focus Energy; 13 Karate Chop; 19 Seismic Toss; 22 Foresight; 25 Revenge; 33 Vital Throw; 41 Submission; 46 Cross Chop; 51 Scary Face; 59 Dynamic Punch | Igual |
| Golem | 6 Mud Sport; 11 Rock Throw; 16 Magnitude; 21 Self-Destruct; 29 Rollout; 37 Rock Blast; 45 Earthquake; 53 Explosion; 62 Double-Edge | Igual |
| Slowking | 6 Growl; 15 Water Gun; 20 Confusion; 29 Disable; 34 Headbutt; 43 Swagger; 48 Psychic | 6 Growl; 13 Water Gun; 17 Confusion; 24 Disable; 29 Headbutt; 36 Swagger; 40 Psychic; 47 Psych Up |
| Gengar | 8 Spite; 13 Mean Look; 16 Curse; 21 Night Shade; 25 Shadow Punch; 31 Confuse Ray; 39 Dream Eater; 48 Destiny Bond | 8 Spite; 13 Curse; 16 Night Shade; 21 Confuse Ray; 25 Shadow Punch; 31 Dream Eater; 39 Destiny Bond; 45 Shadow Ball; 53 Nightmare; 64 Mean Look |
| Steelix | 9 Bind; 13 Rock Throw; 21 Harden; 25 Rage; 33 Sandstorm; 37 Slam; 45 Iron Tail; 49 Crunch; 57 Double-Edge | 8 Bind; 12 Rock Throw; 19 Harden; 23 Rage; 30 Dragon Breath; 34 Sandstorm; 41 Slam; 45 Iron Tail; 52 Crunch; 56 Double-Edge |
| Kingdra | 8 Smokescreen; 15 Leer; 22 Water Gun; 29 Twister; 40 Agility; 51 Hydro Pump; 62 Dragon Dance | Igual |
| Scizor | 6 Focus Energy; 11 Pursuit; 16 False Swipe; 21 Agility; 26 Metal Claw; 31 Slash; 36 Swords Dance; 41 Double Team; 46 Fury Cutter | Igual, exceto 41 Iron Defense no lugar de Double Team |
| Porygon2 | 9 Agility; 12 Psybeam; 20 Recover; 24 Defense Curl; 32 Lock-On; 36 Tri Attack; 44 Recycle; 48 Zap Cannon | Igual |
| Huntail | 8 Bite; 15 Screech; 22 Water Pulse; 29 Scary Face; 36 Crunch; 43 Baton Pass; 50 Hydro Pump | Igual |
| Gorebyss | 8 Confusion; 15 Agility; 22 Water Pulse; 29 Amnesia; 36 Psychic; 43 Baton Pass; 50 Hydro Pump | Igual |

**Entradas de nível 1 dos resultados:** Politoed: Water Gun, Hypnosis, Double Slap, Perish Song; Alakazam: Teleport, Kinesis, Confusion; Machamp: Low Kick, Leer, Focus Energy; Golem: Tackle, Defense Curl, Mud Sport, Rock Throw; Slowking: Curse, Yawn, Tackle; Gengar: Hypnosis, Lick, Spite; Steelix: Tackle, Screech; Kingdra: Bubble, Smokescreen, Leer, Water Gun; Scizor: Quick Attack, Leer; Porygon2: Conversion 2, Tackle, Conversion; Huntail e Gorebyss: Whirlpool. Em Ruby/Sapphire/Emerald e FR/LG, essas entradas de nível 1 são iguais para os 12 resultados.

**Exemplo:** Haunter no nível 25 que evolui em Emerald pode receber Shadow Punch se não o souber; no nível 25 em FireRed/LeafGreen também pode receber Shadow Punch; no nível 30 não recebe move novo por esse motivo. Já Scyther→Scizor no nível 41 oferece Double Team em RSE e Iron Defense em FR/LG. A espécie *antes* da evolução não determina esse lookup; o resultado e o título de destino determinam.

### PP e substituição de moves

As tabelas de moves [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/data/battle_moves.c), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/data/battle_moves.h) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/src/data/battle_moves.h) dão o **mesmo PP base** para os 89 moves que aparecem nos learnsets acima. Catálogo completo de PP base, agrupado pelo valor:

| PP | Moves |
| --- | --- |
| 5 | Cross Chop, Destiny Bond, Dynamic Punch, Explosion, Hydro Pump, Lock-On, Mean Look, Perish Song, Self-Destruct, Zap Cannon |
| 10 | Confuse Ray, Curse, Double Slap, Earthquake, Psych Up, Psychic, Recycle, Revenge, Rock Blast, Sandstorm, Scary Face, Spite, Tri Attack, Trick, Vital Throw, Yawn |
| 15 | Crunch, Double-Edge, Double Team, Dream Eater, Future Sight, Headbutt, Iron Defense, Iron Tail, Kinesis, Mud Sport, Night Shade, Nightmare, Rock Throw, Shadow Ball, Swagger, Whirlpool |
| 20 | Amnesia, Bind, Calm Mind, Disable, Dragon Breath, Dragon Dance, Fury Cutter, Hypnosis, Low Kick, Psybeam, Pursuit, Rage, Recover, Reflect, Rollout, Seismic Toss, Shadow Punch, Slam, Slash, Smokescreen, Teleport, Twister, Water Pulse |
| 25 | Bite, Confusion, Karate Chop, Submission, Water Gun |
| 30 | Agility, Bubble, Conversion, Conversion 2, Focus Energy, Harden, Leer, Lick, Magnitude, Quick Attack, Swords Dance |
| 35 | Metal Claw, Tackle |
| 40 | Baton Pass, Defense Curl, False Swipe, Foresight, Growl, Screech |

O move novo entra com seu **PP base cheio**, sem PP Ups. Se houver slot vazio, `GiveMoveToMon` adiciona nesse slot. Se os quatro estiverem ocupados, o Home/Hub deve permitir escolher um slot substituível ou recusar; **HM não pode ser esquecido** pela cena original. Ao substituir, limpar os dois bits de PP Up do slot escolhido, gravar o novo ID de move e seu PP base cheio, preservando os três outros slots e respectivos PP/PP Ups. O código de [Emerald para aprender/definir move](https://github.com/pret/pokeemerald/blob/master/src/pokemon.c) e [escolha na cena](https://github.com/pret/pokeemerald/blob/master/src/evolution_scene.c) demonstra esse fluxo. Para moves que já estão no Pokémon, manter seu PP atual e PP Ups; não restaurar todos os PP por causa da evolução.

A seleção de learnset deve usar o **título verificado do save de destino** (Ruby, Sapphire, Emerald, FireRed ou LeafGreen), não o `metGame` do Pokémon, a origem do perfil nem uma tabela global sem versão. O ID da ROM e seu hash verificam qual perfil de dados é válido; se houver dúvida sobre versão/hack, não oferecer move aproximado. Embora os PP dos 89 moves coincidam aqui, o lookup também deve ser versionado pelo título.

## Layouts de save resolvidos nos decomps

Os [layouts de Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/include/global.h), [Emerald](https://github.com/pret/pokeemerald/blob/master/include/global.h) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/include/global.h) colocam `playerTrainerId[4]` em **SaveBlock2 + `0x0A` nos cinco títulos**. `save.c` de [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/save.c), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/save.c) e [FR/LG](https://github.com/pret/pokefirered/blob/master/src/save.c) mapeia SaveBlock2 ao setor lógico 0, e SaveBlock1 aos setores lógicos 1–4. Os setores físicos giram; nunca usar um offset absoluto fixo no `.sav` sem primeiro selecionar cópia e setor lógico válidos. O OT do Pokémon deve ser comparado aos quatro bytes do SaveBlock2 validado, em ordem little-endian.

Nos mesmos cinco títulos, SaveBlock2 guarda `pokedex.owned` em `+0x28` e `pokedex.seen` em `+0x5C`. Para número **National Dex** `n`, o bit é `(n - 1) % 8` no byte `floor((n - 1) / 8)`. `FLAG_SET_SEEN` atualiza também duas cópias de proteção em SaveBlock1; `FLAG_SET_CAUGHT` atualiza `owned`. As rotinas [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/pokedex.c), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/pokedex.c) e [FR/LG](https://github.com/pret/pokefirered/blob/master/src/pokedex_screen.c) exigem que os três bits `seen` concordem para a espécie ser considerada vista/capturada. Gravar só `owned` ou só o `seen` de SaveBlock2 cria uma entrada inconsistente.

| Destino | Espelhos `seen` em SaveBlock1 | Contador `GAME_STAT_EVOLVED_POKEMON` em SaveBlock1 | Codificação do contador |
| --- | --- | --- | --- |
| Ruby / Sapphire | `dexSeen2 +0x938`, `dexSeen3 +0x3A8C` | `gameStats[14]`, `+0x1578` | `u32` direto |
| Emerald | `seen1 +0x988`, `seen2 +0x3B24` | `gameStats[14]`, `+0x15D4` | `u32 XOR SaveBlock2.encryptionKey` (`+0xAC`) |
| FireRed / LeafGreen | `seen1 +0x5F8`, `seen2 +0x3A18` | `gameStats[14]`, `+0x1238` | `u32 XOR SaveBlock2.encryptionKey` (`+0xF20`) |

O índice 14 vem de `GAME_STAT_EVOLVED_POKEMON` nos [constantes R/S](https://github.com/pret/pokeruby/blob/master/include/constants/game_stat.h), [Emerald](https://github.com/pret/pokeemerald/blob/master/include/constants/game_stat.h) e [FR/LG](https://github.com/pret/pokefirered/blob/master/include/constants/game_stat.h). As rotinas [R/S](https://github.com/pret/pokeruby/blob/master/src/overworld.c), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/overworld.c) e [FR/LG](https://github.com/pret/pokefirered/blob/master/src/overworld.c) incrementam até `0xFFFFFF`, sem ultrapassar. Os offsets da tabela são **dentro do bloco lógico**; escrita exige remontar os setores afetados e seus checksums.

`IsNationalPokedexEnabled()` exige três componentes simultâneos, segundo [R/S](https://github.com/pret/pokeruby/blob/master/src/event_data.c), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/event_data.c) e [FR/LG](https://github.com/pret/pokefirered/blob/master/src/event_data.c): magic no SaveBlock2, variável de SaveBlock1 e flag de SaveBlock1. Os offsets da tabela são relativos aos blocos lógicos e derivam dos `global.h` e constantes `vars.h`/`flags.h` de cada decomp.

| Destino | Magic em SaveBlock2 | `VAR_NATIONAL_DEX` em SaveBlock1 | `FLAG_SYS_NATIONAL_DEX` em SaveBlock1 |
| --- | --- | --- | --- |
| Ruby / Sapphire | `+0x1A == 0xDA` | `0x4046`, `+0x13CC == 0x302` | `0x836`, byte `+0x1326`, bit 6 |
| Emerald | `+0x1A == 0xDA` | `0x4046`, `+0x1428 == 0x302` | `0x896`, byte `+0x1382`, bit 6 |
| FireRed / LeafGreen | `+0x1B == 0xB9` | `0x404E`, `+0x109C == 0x6258` | `0x840`, byte `+0xFE8`, bit 0 |

O Home/Hub deve **ler** os três componentes para decidir elegibilidade em FR/LG; esta feature não habilita National Dex artificialmente.

## Outros campos e efeitos que precisam ser fiéis

- **Shiny:** o cálculo Gen III usa as duas metades do OT ID e da personalidade/PID. A evolução original não troca esses valores; preservar ambos mantém o mesmo resultado shiny. Testar explicitamente variantes shiny e comuns antes/depois, inclusive ao recriptar o core. O adapter atual calcula essa condição em `pokemon-gen3-adapter.mjs`.
- **Identidade e proveniência:** preservar OT ID, nome/sexo do OT, PID, jogo/local/nível de encontro, Pokébola, língua, markings, ribbons, natureza, IVs, EVs, Pokérus e `pokemonInstanceId`. Não converter o OT para o dono do save de destino. **Amizade é exceção**: o fluxo de troca original a redefine para 70 no Pokémon recebido que não é ovo, antes da cena de evolução; ver seção seguinte.
- **Nickname:** `EvolutionRenameMon` atualiza o nome somente quando é o nome padrão da espécie antiga sob a regra de idioma do título; apelidos personalizados permanecem. Ruby/Sapphire têm uma variante `BUGFIX_EVO_NAME` que precisa ser comparada ao binário exato; [Emerald](https://github.com/pret/pokeemerald/blob/master/src/pokemon.c) e [FR/LG](https://github.com/pret/pokefirered/blob/master/src/pokemon.c) conferem idioma e nome.
- **Item:** consumir o item exigido quando `EVO_TRADE_ITEM` efetivamente evolui; preservar outros itens. Everstone impede. Em FR/LG sem National Dex, os oito resultados posteriores a Kanto são cancelados e os itens exigidos permanecem segurados, conforme avaliador e cena citados acima.
- **Moves e PP:** preservar os quatro moves, PP e PP Up existentes, exceto a alteração escolhida pelo jogador quando surge novo move. Inserir move novo com PP correto, sem duplicar um já conhecido nem apagar move arbitrariamente. Se houver quatro moves, a simulação precisa oferecer escolha ou recusa durável antes da escrita; não escolher por conta própria.
- **Party:** recalcular os seis stats, o nível derivado da experiência e HP atual conforme o estado anterior; preservar status e campos de runtime compatíveis. Se o Pokémon fica em Box, não inventar status/HP de Party; sua próxima materialização deve usar a espécie nova.
- **Pokédex/save:** a [troca R/S](https://github.com/pret/pokeruby/blob/master/src/trade.c), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/trade.c) e [FR/LG](https://github.com/pret/pokefirered/blob/master/src/trade_scene.c) marca a espécie recebida como vista/capturada antes da evolução; a cena marca também a espécie evoluída e incrementa uma vez `GAME_STAT_EVOLVED_POKEMON`. Aplicar os bits e o contador conforme os layouts acima, preservando os demais bits e bytes. O Home/Hub ainda não possui escrita dessas estruturas; ela deve integrar a mesma transação de save que altera o Pokémon.
- **Checksums e revisões:** recriptar o core com a chave original PID XOR OT ID, recalcular o checksum interno de 48 bytes e os checksums dos setores afetados. Atualizar representação, hash, display, revisão, save canônico e materialização sob fence/lease; invalidar snapshots de runtime anteriores para que não revertam a evolução.

### Efeito da troca original que precede a evolução

As rotinas de troca [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/trade.c), [Emerald](https://github.com/pret/pokeemerald/blob/master/src/trade.c) e [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/src/trade_scene.c) colocam o Pokémon recebido na Party, definem sua amizade como **70** se não for ovo e atualizam a Pokédex para a espécie recebida. Só depois o fluxo verifica a evolução por troca. Portanto um Haunter com amizade 255 recebido por troca vira Gengar com amizade 70, e as entradas de Haunter e Gengar podem ter de ser atualizadas separadamente. O Home/Hub atual transporta registros de save sem reproduzir automaticamente esses efeitos. É preciso fechar se a simulação deve aplicar a amizade 70 a **toda entrada entre treinadores diferentes**, inclusive sem evolução, ou apenas aos casos que evoluem. Para fidelidade à troca original, a primeira opção é a referência; o escopo de produto dessa mudança ainda não foi decidido.

Em [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/trade.c), a troca link remota pode habilitar National Dex conforme um campo do parceiro; os caminhos equivalentes de [Emerald](https://github.com/pret/pokeemerald/blob/master/src/trade.c) e [FR/LG](https://github.com/pret/pokefirered/blob/master/src/trade_scene.c) estão comentados e não executam a habilitação. Como o Home/Hub não executa conexão link, preservar o estado do National Dex e as regras de transferência da Spec 035; não sintetizar o campo de parceiro de Ruby/Sapphire.

## Trabalho restante antes de implementar

1. Projetar no adapter a leitura validada do SaveBlock2 e a escrita transacional dos bits de Pokédex, espelhos de SaveBlock1 e contador, usando os layouts dos três decomps; conferir se as variantes de ROM cadastradas no Hub correspondem aos builds de referência dos repositórios.
2. Fechar a decisão de produto sobre amizade 70 em toda transferência entre OTs diferentes ou somente nos 12 casos que evoluem; a regra original é conhecida, mas a transferência atual do Hub não a reproduz.
3. Projetar a escolha de moves quando os quatro slots estão ocupados e a operação atravessa uma sessão/flush. A escolha precisa ser idempotente e retomável, e nenhuma escrita parcial pode ocorrer enquanto está pendente.
4. Definir comportamento de registros corrompidos, espécie/item desconhecido, ROM não verificada, falta de catálogo ou falha de persistência. Não fabricar uma evolução aproximada; preservar o Pokémon original e o core de jogo/save. As validações de ROM, lease e save existentes não podem ser afrouxadas.
5. Definir se a regra de OT diferente vale para transferências antigas já concluídas. Este documento assume **somente novas entradas aceitas** para evitar evoluções retroativas e duplicadas. Criar testes com saves sintéticos e casos de borda derivados do código dos decomps para os cinco títulos; saves reais não são pré-requisito da pesquisa.

## Critério para transformar esta pesquisa em spec implementável

O próximo desenho deve transformar os layouts e regras dos decomps em contratos de `apps/packages/`, backend e frontend, com testes sintéticos independentes por título, evolução e estado de National Dex. A pesquisa estabeleceu os offsets e a política FR/LG diretamente no código de referência; a implementação ainda precisa validar leitura, escrita, checksums e atomicidade no parser do Hub. Não executar build do projeto nem criar commit sem pedido explícito do usuário no prompt atual.
