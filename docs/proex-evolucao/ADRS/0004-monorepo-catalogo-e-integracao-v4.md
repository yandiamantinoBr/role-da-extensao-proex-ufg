# ADR 0004 — Monorepo, catálogo e integração V4

Data: 23/10/2026. Estado: **decisão implementada e V4 publicada**, versão 4, fonte Sites `ae50c4eab331f74057c60dd487167af1b9925410`, estado succeeded; configuração, pré-cadastro e sincronização inicial externa verificados separadamente. Esta ADR amplia a [ADR 0003](0003-identidade-e-operacao-v3.md), sem substituir os registros de publicação anteriores.

## Contexto

O repositório já contém o jogo livre, seu histórico e as primeiras evoluções do portal. As PRs #1, #2 e #3 foram integradas à base pública; `feat/proex-v4` parte de `origin/main` observado em `ff27166`. A equipe precisa continuar o portal sem duplicar o histórico do jogo nem confundir uma atualização de código com uma publicação.

O jogo livre usa a raiz e `github-pages`, com seu Site e Pages existentes. O portal exige Worker, identidade, D1 e R2 próprios. Misturar manifestos ou publicar a partir do diretório errado pode atingir outra aplicação; criar outro repositório agora acrescentaria coordenação e duplicação sem eliminar essa necessidade.

## Decisão

Manter um **monorepo**, com o portal público em `apps/proex-portal` e implantação independente. A raiz e `github-pages` continuam pertencendo ao jogo livre. O portal conserva manifesto, dependências, build, migrações, recursos e comandos próprios. Executar testes e publicar a partir do diretório da aplicação correta. Permissão para operar o portal não concede GitHub nem publicação.

Os 12 arquivos do baseline livre permanecem protegidos pela referência `f905f0d78371dc4a8784cce27bdbc7ef6fa88103`. Esse é um baseline de preservação, não a posição atual de main. Mudanças futuras no jogo exigem revisão deliberada da referência; a V4 do portal não autoriza reescrever a experiência livre.

O repositório público reúne código, documentação, testes e migrações; não recebe bancos, credenciais, sessões, objetos privados ou dados de participantes. A preparação de fonte exigida pelo Sites pode manter sua representação técnica própria: sua revisão publicada deve ser registrada junto da revisão pública. A cópia entre fontes é explícita e revisada, sem copiar histórico Git privado ou anunciar sincronização automática inexistente. GitHub, PR e deploy continuam evidências distintas.

## Catálogo e metadados

Projetos têm tipos configuráveis, ciclo de vida e hierarquia sem herança de privilégios. Editais, links e cronologia são entidades distintas de campanhas, participação e estoque. Escritas usam autorização atual, CAS, chaves idempotentes e versões; restauração cria outra versão e revalida as regras. Relações compartilhadas não permitem que um gestor altere outro escopo.

O catálogo inicial usa fontes oficiais com proveniência e ressalvas de data. Referências de outra gestão não provam encerramento. Pré-cadastro só cria itens ausentes com saldo zero e preserva dados manuais; não gera histórico operacional a partir de notícias ou ilustrações.

## Planilha e serviços externos

D1 permanece como fonte transacional da operação. A planilha é uma projeção portátil com edição controlada de metadados e operações declaradas. Resultados, saldos calculados, identidade e permissões não recebem dupla gravação irrestrita. Recibos e versões impedem repetição e sobrescrita silenciosa; conflitos devem ser expostos.

Configuração de Drive/Sheets e agendamento não comprovam funcionamento. Uma integração sem visitante só pode ser declarada ativa após execução autorizada real, leitura de retorno e registro de conclusão. Os IDs e endereços privados da instituição ficam na configuração e no handoff autorizado, fora desta ADR. Objetos privados e restauração exigem verificação separada da planilha. Calendar continua por ICS de leitura, sem OAuth ou gravação bidirecional.

## Consequências

Há um único histórico público para revisar e preservar, com aplicações isoladas por diretório e deploy. A configuração e a CI precisam distinguir os checks da raiz dos checks do portal. Cada aplicação tem sua publicação e seu rollback; um build não publica a outra.

Uma extração futura de repositório ou pacote compartilhado continua possível se houver necessidade operacional demonstrada. Exigirá plano de histórico, identidade, migrações, arquivos, CI e suporte. Não se duplicam serviços nem se altera o jogo livre apenas para organizar esta etapa.

O estado verificável desta entrega fica em [ENTREGA-V4.md](../../ENTREGA-V4.md) e [ESTADO_ATUAL.md](../ESTADO_ATUAL.md). A publicação V4 e a sincronização real têm evidências separadas. As ferramentas MCP ficaram disponíveis num contexto novo de nuvem. Configuração e seed de produção foram concluídos; a primeira execução em 23/10/2026 às 14:14:59 UTC exportou 118 linhas e verificou 27 tabelas e 118 linhas-base, com zero alterações importadas e zero conflitos. A segunda execução concluiu às 14:22:45 UTC, com 130 linhas exportadas, três descrições de buttons importadas por controle de versão e zero conflitos. As descrições editadas pela planilha foram conferidas no portal, com incremento de versão e estoque zero, reexportadas e relidas nas 27 tabelas e linhas-base. A rotina periódica está ativa, sem propagação instantânea.

O percurso planilha → portal → planilha foi verificado para essas três edições de metadados. Isso não comprova homologação de todos os tipos de operação, homologação institucional completa ou backup restaurável. Não havia anexos ou limpezas pendentes na execução. Os endereços e identificadores privados permanecem fora da documentação pública.
