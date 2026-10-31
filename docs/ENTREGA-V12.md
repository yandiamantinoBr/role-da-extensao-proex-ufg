# V12 · Acompanhamento, equipes e notificações

PR [#12](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/12), integrada em 31/10/2026 às 16:09:59Z. Candidato `ff99395a4de5b6f10b87a015606ac290cefaca3a`; merge `00e4fd231eb96af535b15b3994a8e8a25950d312`. Deploy de produção `dpl_7KoZBEMFRfHcMKkCcD1jWSY6vZ7x` **READY no mesmo SHA**. Checks de PR/main aprovados. No domínio canônico, sessão autenticada, catálogo real, Demandas e sino carregaram sem novos erros do portal. Health200; hosts antigos V9/V10 continuam403. Nenhum cadastro de QA em produção.

## Comportamento entregue

- Demandas por organização/projeto com prioridade, prazo, estado, histórico e atribuição individual ou por equipes sobrepostas. Equipes não concedem acesso a outros contextos. Concessão explícita de trabalho permite acompanhamento limitado sem alterar o papel da pessoa.
- Conferência pós-evento por material, tamanho e unidade: quantidade esperada, contada e avariada. Encerramento do evento e abertura da conferência são atômicos; divergências geram revisão idempotente. Nenhuma contagem altera estoque, confirma devolução ou fecha empréstimo implicitamente.
- Sininho com notificações persistentes, leitura e pendências pessoais, link direto à demanda, atualização ao voltar à tela e consulta periódica quando visível. Destinatários precisam manter acesso atual.
- Relatórios de demandas e conferências em PDF/DOCX/XLSX, com filtros e colunas, quantidades ausentes preservadas e sem somar unidades diferentes. WhatsApp compartilha somente título/link por ação da pessoa; não envia mensagens automaticamente.
- E-mail opcional via MailApp em projeto separado, consentimento individual e token `pne_` restrito por organização. Quotas, fila durável, resultado incerto sem reenvio cego, ACK idempotente e reconciliação explícita. Desativado até escolher/configurar remetente e autorizar Google. Aceitação pelo MailApp não comprova entrega ou leitura.
- Backup completo recorrente com AES-GCM e RSA4096: servidor/Apps Script recebem apenas a pública, Drive privado com releitura do ciphertext e ACK. Instalação, custódia privada, recuperação e gatilho são etapas próprias; publicar o código não as comprova.
- Entrada pública opcional sem papel institucional, comprovação de e-mail e recuperação limitada ao participante. Permanece fechada enquanto aviso/aprovação e infraestrutura de envio não forem configurados.

## Verificação do candidato

CI aprovado: **644/644** testes do portal e **33/33** do jogo. Local: suíte **643/643 Node26**, um contrato independente posterior e demais testes focados passaram; Node24 teve 636/636 antes do último painel e revisão focada posterior, além da suíte completa no CI. Tipos sem erros; lint integral sem erros e três avisos preexistentes. Builds Worker e Node passaram.

Modelo e migrações 0000–0015 correspondem em **82 tabelas**, sem alterar SQL antigo. Ensaio offline no backup real V10 aplicou 0008–0015 em RAM, preservou as 49 tabelas originais e terminou com integridade OK/FK zero. Nenhum arquivo claro ou chamada de provedor foi necessário para esse ensaio.

CUA integrado percorreu encerramento de evento, checklist P/M/G, contagem 10/10/10, uma avaria M e demanda filha de prioridade alta. Exportações XLSX/DOCX/PDF foram reabertas com as três linhas; PDF de duas páginas renderizado e inspecionado. Layouts 375/414/1250 sem overflow, sino dentro da tela. O build final confirmou demanda criada → link direto → recarga do detalhe → notificação e consentimento pessoal persistido/retirado com envio desligado. Apenas fixtures sintéticas no ambiente local.

Smoke HTTP local validou Sheets, edição concorrente/conflitos e backup cifrado de 5,29 MB em 161 chunks com recuperação física. Benchmark público local: 100 pedidos, concorrência10, zero erros, p95 14,47 ms; não estima capacidade serverless. Revisão independente reduziu uma página de 50 demandas de 101 para uma consulta de versão, zero recargas/commits do snapshot estável; ganho de CPU local não representa latência Postgres.

Revisão adversarial corrigiu autoridade operacional após rebaixamento, roster apagado por edição parcial, N+1, respostas tardias de interface, auditoria duplicada no ACK e estado administrativo/token retido após403. Ver os relatórios de revisão na documentação da aplicação.

## Continuidade

Provas privadas, capturas e arquivos reais ficam fora do Git. R09 detalhamento de saídas, R10 IA documental e R11 diagnóstico explícito de conexão continuam na próxima entrega, conforme [matriz R01–R22](COBERTURA-DE-REQUISITOS.md). Custódia independente, políticas institucionais, remetente e abertura pública não foram inventados nem ativados implicitamente.

## Compatibilidade com o Drive real

A primeira execução do backup foi recusada antes de emitir ticket: o Drive identifica a própria permissão única `user/owner` como herdada do Meu Drive. Diagnóstico sanitizado confirmou proprietário atual, pasta diretamente na raiz, nenhuma permissão adicional, nenhum Drive compartilhado e nenhum atalho. A correção aceita esse marcador da permissão do único proprietário, preservando todas as demais restrições. Regressão positiva falhou antes/passou depois; grupos, permissões adicionais, outro proprietário, pasta aninhada e paginação continuam recusados. 22 testes focados passaram e houve revisão independente.

Durante o diagnóstico, uma seleção incorreta da função `prepararPastaBackup` criou outra pasta vazia, sem captura. Ela foi identificada por horário/ID, conferida vazia e movida para a lixeira recuperável. A pasta configurada foi preservada. O diagnóstico temporário de metadados não inclui e-mails, tokens ou conteúdo privado e será retirado do script instalado.

## Publicação da correção e recuperação real

PR [#13](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/13) integrada em 31/10 às 16:21:02Z: SHA `62761e65566e0621f498aae4953e99ff496c07dc`, Vercel **READY** `dpl_G5Dr1RFQuJjJxU4K7GbcQQNoF5Bp` no mesmo SHA. Checks PR/main aprovados: **645/645** testes do portal e **33/33** do jogo. Asset público do script corresponde ao fonte local, SHA-256 normalizado `1249535c8da5e91d4d1e4d08c9cf5aa010b3b9794cd0e103772fb9397a77a565`; health canônico 200 e versões antigas 403.

A primeira cópia real da rotina foi capturada em **31/10 às 13:19:05 BRT** e teve ACK/releitura confirmada às 13:19:11. O arquivo cifrado no Drive privado tem **485.224 bytes**, SHA-256 `f13c9a6678d956550b7789e9ee4b928892c1fccc8c3612a944563ed6c12ada50`, igual ao recibo do portal e à cópia baixada independentemente. Recuperação física isolada com a privada offline passou: formato 2, snapshot 270, SQLite de 1.183.744 bytes, um objeto de 416.503 bytes e 16 migrações conhecidas, com integridade/FK/hashes válidos. A réplica clara temporária foi removida. Localizadores e provas privadas ficam na Vault e fora do Git.

O projeto Google existente contém o conector atualizado e o arquivo adicional corrigido, sem diagnóstico temporário nem MailApp. Gatilho diário instalado na faixa das **03h, America/Sao_Paulo**; consulta confirmou um gatilho de backup, último recibo válido e nenhum pendente. A captura manual pela rotina e a recuperação foram comprovadas; a primeira execução pelo relógio ainda não ocorreu. Os gatilhos de dados/anexos foram preservados. A custódia da privada ainda é local, protegida por DPAPI: transferência para custódia independente permanece necessária para cobrir perda do computador.
