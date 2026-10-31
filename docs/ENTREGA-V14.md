# V14 · Publicada e conferida

PR #15 integrada em 31/10/2026 às 19:23:33Z: revisão funcional `7f7550c600562765afc944e25a5d768174ee78d9`, candidato aprovado `1fb20f35de0af0e5a6b0e92441d9766e48fd5fe8`. Vercel produção `dpl_5jy8XC6hi5BSmn3YnFTZX93NEUfH` READY no mesmo SHA. CI do candidato aprovado; 755 testes do portal e 33 do jogo. Nota independente 9,0/10 nos estados observados, sem certificação WCAG ou prova de zoom de 200%.

Pós-deploy real: sessão preservada, grupos de Configurações e catálogo autorizado carregados, Demandas desktop/celular com espaço medido de 24 px entre filtros e ações e sino de 44×44 px legível. Central de notificações abriu dentro do viewport e fechou por Escape; nenhum novo erro de console nessa rodada, nenhum dado de QA gravado. Health canônico 200; hosts antigos V9/V10 403. Provas privadas em `apps/proex-portal/.sites-runtime/production-v14/published-ui-proof.json` e imagens correspondentes. Registros posteriores só de documentação mantêm o mesmo código funcional; conferir GitHub/Vercel para o SHA corrente.

R23 concluído neste escopo; avisos repetidos, metadados pequenos, ensaios de zoom/leitor de tela/aparelhos físicos continuam limites ou melhorias explícitos. R24 segue em V15 isolada. R21 continua preparado e OFF, pendente da confirmação específica de acesso Google; a escolha do remetente não concedeu OAuth. Esta atualização supersede os checkpoints abaixo.

Atualização da retomada de 31/10/2026: builds Worker/Node concluídos no candidato `c35140a`, CI da PR #15 aprovado e última recaptura de Tempo e som confirmada em 1250/375 px e claro/escuro: fechar 44×44 px, Enter abre, Espaço fecha e foco retorna ao acionador. Comprovante local separado `resume-final-proof.json`; o JSON da coleta anterior não contém essa retomada. Auditor independente reaplicou os mesmos oito pesos e atribuiu **9,0/10** (ponderada 9,045) aos estados observados. Parecer em `apps/proex-portal/docs/AUDITORIA-DESIGN-V14-FINAL.md`.

Nenhum novo defeito visual bloqueador foi demonstrado. Zoom de 200% continua não comprovado e é limite de evidência, sem declaração de conformidade WCAG; não foi contornada a interrupção da janela nativa. Pendem apenas CI do descendente documental, merge autorizado e comprovação do deploy/produção. R24 (central Meu trabalho, nomeações e demandas mais visuais) está em implementação isolada V15 e não integra esta nota ou a nota de design da V14.

## Histórico do checkpoint anterior, superado pela retomada acima

Checkpoint anterior de 31/10/2026. Naquele momento a última produção comprovada era V13: revisão funcional `d069c7f`, documentação publicada `23bbeae`, PR #14. Os gates abaixo descrevem aquela interrupção e não substituem a atualização no topo.

## Mudança e evidência

Demandas separa filtros e ações por 24 px, mantém organização/projeto visíveis e recolhe busca/estado/prioridade em um agrupamento nativo. O sino tem contraste e área de 44 px nos dois temas; Escape fecha e devolve o foco. Projetos, Agenda, Materiais, Equipe, Relatórios e Configurações priorizam o trabalho e recolhem controles avançados. A tabela dos relatórios vem antes dos formatos. Fotos do material têm botões reais acessíveis por teclado; avisos de áudio usam cores semânticas legíveis no escuro. Rotas públicas oferecem aparência consistente. Campos editáveis móveis usam 16 px.

A auditoria encontrou problemas adicionais, corrigidos durante a conferência: marca e sino se sobrepunham em 320 px; o botão da chave de sincronização usava classes sem definição; o backup precisava de respiro; controles do evento público tinham alvos menores. As recapturas demonstraram a separação de 8 px entre marca e sino, sem encolher seus controles. O último fechamento do modal do evento passou de 40 para 44 px no commit `0804314`; sua recaptura ainda falta.

O detalhe do projeto mostrava datas ausentes e atraso falso porque convertia timestamps numéricos em strings antes de ler a data e fazia comparação textual com ISO. Também calculava disponibilidade sem descontar equipamentos emprestados. A correção `3fa3222` normaliza datas, usa uma comparação temporal finita e consulta a mesma regra autoritativa de disponibilidade do catálogo, sem depender dos empréstimos paginados/visíveis. A consulta preserva `inventory.read`; resposta incompleta mostra “Não informado”. Revisão independente aprovou o diff, testes e probes de ACL, reservas e valores inválidos. Recapturas nos quatro contextos mostram datas corretas, “Retirado” e disponibilidade zero para o equipamento emprestado.

## Verificações concluídas

- Fonte `3fa3222`: 755/755 testes do portal em Node 24 e Node 26; 33/33 do jogo da raiz. Tipos sem erros; lint sem erros e com três avisos anteriores. Builds Worker e Node aprovados. `0804314` posterior altera somente as dimensões CSS do botão de fechar; falta recompilar esse último ajuste.
- Onze abas principais nos quatro contextos de 375/1250 px e claro/escuro; estados adicionais de projeto, filtros ativos, patrimônio, conferência, equipes, IA indisponível, importação com prévia e rotas públicas. Capturas/medições sintéticas privadas em `apps/proex-portal/.sites-runtime/production-v14`. A fonte principal é `186e44f`; recapturas pontuais posteriores identificam `3fa3222`. Não confundir a captura de um defeito com aceite da correção.
- PDF, DOCX e XLSX reabertos: um empréstimo sintético, datas 31/10/2026 e “Em atraso: Não” preservados. PDF renderizado com Poppler sem cortes. Paginação nativa do Word não comprovada.
- Teclado: agrupamentos nativos, filtro ativo preservado ao recolher, detalhes do material pelo nome, seletor de foto com prévia antes de enviar, retorno de foco de drawer/sino/menu móvel/configuração do evento. Nenhuma câmera, gravação ambiente, chamada paga ou dado de QA em produção.
- Benchmark interno da fonte `3fa3222`, loopback/processo único: evento público, 25 amostras, p50 1,37 ms / p95 1,67 ms; painel autenticado, 25 amostras, p50 14,37 ms / p95 17,17 ms; rajada pública de 100 consultas, concorrência 10, zero erros, p95 14,16 ms. Não estima capacidade da Vercel/Supabase em evento real.
- Produção consultada antes de publicar: o painel confirmou tentativa Sheets concluída de 159 linhas às 15h35m49 e última conclusão às 15h36m59 BRT, em 31/10; uso do conector às 15h53m35. Esse recibo não comprova monitoramento permanente, todos os gatilhos ou nova releitura dos anexos.

## Gate pendente e retomada

A proteção do controle de computador encerrou o uso visual ao não conseguir identificar a URL da janela Chrome no Windows com segurança, durante a tentativa de zoom nativo. Não houve contorno dessa proteção. Atalhos anteriores não alteraram a escala; **200% não foi comprovado**. QA descartável encerrado. Nenhum merge/deploy V14 realizado.

1. Na aplicação `apps/proex-portal`, recompilar Worker e Node de `0804314` ou do descendente documental. Não iniciar QA enquanto os builds escrevem em `dist`.
2. Iniciar `node scripts/qa-local.mjs --benchmark`, autenticar a conta sintética indicada pelo próprio script e abrir o portal. O helper privado ignorado `apps/proex-portal/.sites-runtime/production-v14/seed-design-qa.mjs` espera que a primeira página já tenha criado o projeto-base; se rodar antes, recusa no preflight sem mutação. Ele foi usado uma vez por ambiente, depois do login visual, para os cenários adicionais.
3. Retomar CUA somente quando a proteção permitir em novo turno; não usar outra tecnologia para contornar a interrupção. Recapturar o fechamento de “Tempo e som” de 44 px, completar zoom/teclado pendentes e pedir a conclusão da rubrica independente. Baseline preservada: 6,95, arredondada para 7,0/10; oito pesos fixos, dezesseis famílias. Nenhuma nota final foi inventada.
4. Após gates: criar/concluir PR, CI verde no candidato exato, merge autorizado com SHA fixado, Vercel READY no mesmo SHA, conferência real do domínio/sessão/dados e isolamento dos hosts antigos. Atualizar esta nota, guia/matriz, Vault e oito conversas com resultado real.

Limites residuais: calendário de sete colunas em 375 px usa células de 40×84 px com lista alternativa; avisos repetidos da mesma demanda ainda precisam de agrupamento ou causa/data mais clara; mudanças externas na lista de Demandas exigem Atualizar/troca efetiva do recorte. Leitor de tela, aparelhos físicos, câmera/microfone e inferência paga não foram certificados por estas capturas.

## Outros requisitos preservados

R01–R23 e A01–A28 continuam em `docs/COBERTURA-DE-REQUISITOS.md` e na Vault. Esta revisão não encerra automaticamente os requisitos institucionais ou a auditoria inicial. Nenhuma migração de banco foi adicionada; persistência SQLite/Supabase, ACL, conector Sheets e WAF permanecem no desenho existente.

R21: Yan escolheu a conta Google pessoal atual como remetente provisório. Remetente salvo com envio OFF; planilha/Apps Script privados separados preparados, menu e quatro escopos explícitos verificados. A confirmação específica dos novos escopos Google, credencial restrita de 30 dias e teste para a própria conta está pendente. Nenhum token, OAuth, gatilho de avisos ou e-mail concluído. Não confundir a escolha do endereço com concessão de acesso. Endereços e localizadores privados somente na Vault; nenhum segredo no repositório público.
