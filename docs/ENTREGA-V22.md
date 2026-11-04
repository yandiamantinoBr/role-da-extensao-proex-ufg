# V22 · Relatórios com identidade visual e central de avisos

## Critérios de aceite

Quem acompanha um projeto deve conseguir ver o recorte e os totais antes de baixar. O documento precisa identificar a PROEX/UFG, usar a marca de projeto de fonte comprovada, mostrar números e rótulos legíveis, distinguir zero de campo ausente e preservar as permissões da consulta. A revisão inclui prévia em claro e escuro a 390 e 1366 px, PDF A4 reaberto e renderizado, ficha única e paginação de recortes maiores.

Quem acompanha demandas deve conseguir limpar sua caixa de avisos e ocultar uma pendência pessoalmente. Novos avisos precisam continuar visíveis e o histórico da demanda e a entrega por e-mail preservam suas regras. Revisar a autorização de cada ação, a repetição e a concorrência.

As referências de design são as capturas fornecidas e o [processo do VGP](https://vgp-site.vercel.app/). A referência editorial usa a ordem identidade, recorte, indicadores e detalhamento. O portal usa seus próprios ativos e cores.

## Reconciliação de branches

Em 04/11/2026, a PR #22 já estava integrada, com a V21 READY. O commit local de diagnóstico `d03c25b` tem patch equivalente em `main`. A consulta ao remoto mostrava `main` e duas branches antigas. As pontas de `feat/proex-v5` (`e04f158`) e `v13-coordenacao` (`23bbeae`) eram ancestrais de `main`, sem PR aberto. As duas referências foram removidas do GitHub com verificação do SHA esperado. As worktrees locais e os históricos de PR foram preservados.

## Continuidade

A rodada de qualidade fica concentrada em relatório, avisos e operação do CONPEEX. A área de chaves, a triagem JEV, o acabamento mais amplo e a entrada Google têm aceites separados. A migração de segredos exige ensaio com dados sintéticos e configuração própria. Chamadas a provedores dependem de configuração explícita, consentimento, cota e estimativa antes de ativar.

### Próximos aceites

| Frente | Situação verificada | Próximo aceite |
| --- | --- | --- |
| CONPEEX e operação | Agenda de 9 a 13/11, nove demandas registradas e planilha de contagem vinculada na V20/V21. | Confirmar saldos e responsáveis de cada lote com a equipe. Separar a conferência de qualquer alteração real de estoque. |
| V23 · Credenciais e modelos | Diagnóstico de conexão já integrado. DeepSeek, TypeSafe e Deepgram usam configuração por organização. Groq é um piloto delimitado por ambiente. | Implementar ponte de leitura v1/v2 com chave independente, recifra retomável e proteção contra gravação concorrente. Entregar painel de administração com metadados e ACL, sem devolver segredos. |
| V24 · JEV e custos | Cota por organização mede reservas. | Triagem de urgência e importância com explicação e revisão humana. Separar reserva, estimativa, uso medido por modelo e cobrança confirmada. |
| V25 · Acabamento e conta Google | Marca móvel e atalhos por projeto já implementados. | Revisar telas restantes e validar login com vínculo explícito por convite e preservação dos escopos. Conferir com aparelhos físicos e leitor de tela. |
| Comunicação e integrações | Registro de publicações por projeto na V21. Sheets e backup operam por rotinas próprias. | Validar Drive institucional, permissões de exportação Docs/Sheets, links de designs e captação de publicações por fonte. Preservar o fluxo de proposta com aprovação para qualquer ação de IA. Tratar a exportação Markdown pessoal, o compartilhamento pelo usuário e a automação WhatsApp como fluxos distintos. |

A triagem comparou as notas da Vault com os fluxos atuais. O diagnóstico existente consulta metadados de conexão. Teste com inferência é um aceite separado, com carga sintética, consentimento, limite e registro de uso. O segredo de login ainda protege propostas e replays de voz e documentos. A migração de chaves de provedores precisa preservar esses fluxos. O retorno após a primeira gravação v2 exige uma versão que leia ambos os formatos.

## Verificação da candidata

A PR [#23](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/23) integrou a candidata `51047f3` no merge funcional `51fedadfdc27ab7f05059ad6276b871d64f0e15e`. As duas rotinas do [CI](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/actions/runs/41855432257), o preview Vercel e os comentários de preview passaram. O build Node local, o typecheck e o lint passaram. O lint registrou três avisos anteriores em Registros e Equipe.

- A prévia e o sino foram exercitados no navegador a 390 e 1366 px, em Claro e Escuro, com dados sintéticos. Não houve overflow horizontal nos painéis. Os botões de exportação e de ocultação mediram 44 px. A revisão final manteve os formatos visíveis acima da prévia móvel.
- O PDF A4 foi gerado, reaberto e renderizado. A ficha sintética do CONPEEX ficou em uma página com três marcas, quatro indicadores e campos ausentes distinguíveis de zero. Relatórios mais longos repetem o cabeçalho. O Rolê usa a marca na ficha operacional confirmada em produção. O Curta o Campus usa identidade PROEX/UFG e título enquanto falta um ativo oficial isolado.
- O sino passou por ensaio HTTP local, com 401 anônimo, 403 de origem divergente, ausência de cache, ocultação e restauração, versões antigas preservando o estado atual e um aviso posterior sobrevivendo à limpeza. A revisão corrigiu a confirmação da operação em corrida. A lista de ocultadas exibe até 20 por vez. A validação de feedback da correção usou testes de componente e serviço no código final.
- A revisão de permissões validou escopo do relatório, filtros de projeto, negação de marca em cadastro duplicado, links conforme acesso e isolamento de filtros salvos por conta. O PDF usa apenas ativos locais conhecidos. Parecer visual independente de **9,2/10** para o PDF e **9,1/10** para o sino, sem P0/P1 nas áreas auditadas. A revisão emulou tamanhos de tela. Aparelhos físicos, leitores de tela e as demais áreas do portal ficam fora desse parecer.
- A bancada de integração do conector aplicou duas alterações sintéticas e detectou edição concorrente. No benchmark loopback de 25 amostras por rota, p95 de **5,58 ms** no evento público e **59,24 ms** no painel autenticado. Em 100 leituras públicas com concorrência 10, **0 erros**, p95 de **89,51 ms**. As medidas descrevem o processo único local com dados sintéticos.

## Produção · 04/11/2026

Vercel `dpl_2ei6jUVH2CgbRbVwvAdG9cXcuWiS` ficou READY para `51fedadfdc27ab7f05059ad6276b871d64f0e15e`. O CI final aprovou **899/899 testes do portal e 33/33 do jogo**, os builds Node e Worker e o smoke de autenticação. A suíte focada final passou 65/65 localmente. O domínio canônico respondeu 200 e os dois hosts históricos permaneceram isolados com 403. A branch da PR foi removida após o merge. A conferência do remoto retornou apenas `main`.

Na sessão autenticada, a ficha do CONPEEX apresentou a prévia, as três marcas e os atalhos de Demandas, Agenda e Planilhas. O PDF de produção foi baixado às 12:18 (Brasília) e renderizado em A4 de uma página, com a marca oficial, campos ausentes explícitos e os quatro valores iguais aos da prévia. A contagem de Eventos reflete campanhas cadastradas. O marco da Agenda aparece na linha do tempo separadamente. A fila registra explicitar a diferença no relatório. A conferência do sino mostrou **Limpar todos os avisos** e o controle para ocultar individualmente a demanda de teste, que segue registrada. Limpeza e restauração foram exercitadas na bancada sintética.

A migração 0019 acrescenta duas estruturas pessoais. O acesso à caixa em produção confirmou a leitura do novo fluxo. O conector mantém suas 35 projeções, e os estados pessoais ficam fora do espelho. A verificação bidirecional desta rodada foi local. O último checkpoint real registrado está na entrega V19.

No smoke autenticado de navegação, as 13 abas do menu abriram com título correspondente e largura de rolagem igual à largura útil. O ensaio usou o menu lateral a 932 px e a navegação inferior a 390 px, incluindo o menu Mais. Foram testadas abertura e largura do documento. A auditoria funcional das demais ações segue na fila.
