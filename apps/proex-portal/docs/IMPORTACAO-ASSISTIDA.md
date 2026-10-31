# Importação assistida de projetos e bens

Verificado em 2026-10-31. A implementação não altera SIGAA, SIPAC, SEI, Google Sheets ou Drive. As gravações acontecem somente no portal em que a pessoa confirmou a prévia. Não há migração de banco nesta entrega.

## Uso

O componente `components/portal/assisted-import-panel.tsx` recebe `kind="project"` ou `kind="asset"`, os projetos acessíveis, os tipos/unidades já cadastrados e a função `canWrite(projectId)`. O servidor sempre reconfere a permissão. `onImported(projectId)` é chamado depois de concluir a conferência e os anexos.

1. Escolher o destino: novo projeto, projeto existente, novo equipamento individual ou conferência de bem existente.
2. Informar uma ação pública do SIGAA/UFG ou ler PDF, DOCX, texto, HTML, JSON ou CSV/TSV. Bens também têm formulário manual.
3. Conferir a fonte, corrigir/completar os campos visualmente e escolher os valores que serão salvos. Ajustes manuais ficam identificados no registro. O importador não transforma a condição de público externo da ação em abrangência externa à PROEX.
4. Confirmar explicitamente. Para projetos existentes, somente os campos escolhidos substituem os atuais. Unidade e modalidade precisam ser relacionadas aos cadastros locais quando esses campos forem selecionados.
5. Acrescentar fotos ou PDF ao registro da conferência. A câmera usa o seletor do dispositivo; navegadores/aparelhos podem oferecer comportamentos diferentes.

O documento admite até vinte linhas, confirmadas individualmente. TXT/HTML/JSON/CSV têm limite de 256 KiB; PDF/DOCX seguem o limite de arquivo do portal. O texto extraído também fica limitado a 256 KiB. PDF usa PDF.js no navegador, até cinquenta páginas e quinze segundos, com identificação das páginas usadas. DOCX lê o corpo principal do documento, sem paginação fixa. Campos sem rótulos reconhecidos precisam ser completados na prévia. Não há OCR, interpretação de `.doc` antigo, importação de álbuns remotos ou promessa de converter qualquer diagrama/tabela em um cadastro completo.

## Campos e destino

| Fonte | Campo no portal | Regra |
| --- | --- | --- |
| Título/nome, nome curto, resumo | `projects.name`, `short_name`, `description` | Limites e validações existentes; sem truncamento silencioso |
| Datas de início/fim explícitas | `projects.starts_at`, `ends_at` | ISO com fuso; datas sem hora usam início/fim do dia de Brasília; ano do cadastro não inventa vigência |
| Área e linha de extensão | `thematic_area`, `extension_line` | Catálogo existente da UFG; valores desconhecidos são apontados na prévia |
| Unidade e modalidade | `unit_id`, `type_id` | Sugestão por correspondência exata, seguida de confirmação; identificador SIGAA nunca vira ID local automaticamente |
| Fonte oficial | `official_url`, `project_links` e registro de conferência | Atualização de `official_url` é uma opção explícita; um novo projeto com fonte já cadastrada é recusado |
| Ano, situação e financiamento na fonte | Corpo do registro do projeto | Não arquivam projetos, não habilitam brindes e não concedem acesso |
| Nome, tombamento, descrição e unidade de medida do bem | `items` | Equipamento individual; tombamento é texto para preservar zeros; saldo inicial zero |
| Marca, modelo, série, localização, unidade responsável e condição observada | Corpo do registro vinculado ao bem | Valores identificados por campo; ainda não são colunas nativas para filtros/relatórios de patrimônio |
| Conferência de bem já existente | `records` com `item_id` | Não altera seus metadados nem saldo; correções do catálogo continuam no formulário existente |
| Fotos e documentos | `record_attachments` e armazenamento privado existente | Mesmas permissões, validação do arquivo e idempotência dos Registros; até dez arquivos por conferência |

O registro conserva fonte, identificador externo quando disponível, horário da consulta, SHA-256 do conteúdo e campos selecionados. Arquivos também têm hash do original e do texto extraído. O documento bruto não é persistido automaticamente; a pessoa pode acrescentar o PDF fonte aos anexos privados após confirmar. O armazenamento de Registros aceita fotos/PDF, não o original DOCX. Cadastro de patrimônio no portal não comprova tombamento no SIPAC nem substitui guia, termo ou processo SEI. Movimentação de estoque continua no livro de movimentações existente.

## API e proteção

`POST /api/imports` exige sessão, mesma origem, JSON e `X-Proex-Action: 1`.

- `action="preview"`: `kind`, `projectId?`, `itemId?`, `sourceMode` (`sigaa`, `document`, `manual`), `sourceUrl?`, `format?`, `content?`. Consulta de SIGAA somente para projetos. A prévia não grava cadastros.
- `action="apply"`: `reviewToken`, `candidateKey`, `selectedFields`, `edits?`, `unitId?`, `typeId?`, `saveOfficialUrl?`, `confirmed=true`, `operationKey`. A confirmação é ligada à pessoa, ao destino e à versão do projeto, com validade de quinze minutos. Edições visuais passam novamente pela lista de campos e validadores no servidor.
- Criar projeto exige administração global de projetos. Atualizar exige gestão do projeto. Bens e respectivas conferências exigem gestão de materiais no projeto. Não há criação de contas, convites ou papéis a partir de fonte pública.
- O mesmo identificador de operação permite retomar após perda de resposta, inclusive se o cadastro foi salvo e o registro de conferência falhou depois. Não há uma transação única entre essas etapas. Alterar a seleção inicia outra operação; conferir o cadastro antes de fazer isso após uma falha.
- Tombamento duplicado no mesmo projeto é recusado; a importação não consolida bens entre projetos nem movimenta carga patrimonial.
- Campos desconhecidos, contatos e permissões não entram no cadastro. E-mails/CPF formatado em texto operacional são omitidos; aparentes credenciais bloqueiam a leitura. Isso não substitui a revisão humana de texto livre.

`POST /api/imports/document` usa sessão, mesma origem e `X-Proex-Action: 1`. Recebe multipart com `file`, `kind`, `projectId?`, `itemId?`, `sourceUrl?`; PDF inclui `extractedText` e `pageCount` preparados no navegador. A autorização antecede a extração DOCX. O corpo tem limite de arquivo + 256 KiB de texto + margem de multipart, incluindo requisições sem `Content-Length`.

### Extração de arquivos

- PDF: importação dinâmica de `pdfjs-dist` e worker servidos pela própria aplicação. A interface lê bytes locais, somente texto, sem viewer, scripts, formulários XFA, renderização, fontes externas ou URL remota de PDF. A biblioteca mantida PDF.js 6 removeu o caminho antigo de `eval`; o adaptador também passa `isEvalSupported=false`. O worker é encerrado ao concluir/falhar. PDFs com senha, sem texto selecionável ou acima dos limites falham com orientação. O servidor confere assinatura/tamanho/hash do original; a proveniência declara que o texto/páginas foram extraídos no navegador e revisados pela pessoa, sem alegar comparação forense texto↔PDF no servidor.
- DOCX: ZIP lido em memória com `node:zlib`, sem extração para disco. Somente `word/document.xml` é inflado, até 1 MiB. Diretório central, tamanhos e CRC são conferidos. ZIP criptografado, ZIP64/multidisco não suportado, nomes duplicados/inseguros, VBA e declarações XML externas são recusados. Relações externas nunca são resolvidas. Cabeçalhos/rodapés, comentários, imagens e documentos anexados não entram no texto. Fontes primárias: [estrutura WordprocessingML](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document), [Node zlib](https://nodejs.org/api/zlib.html) e [compatibilidade zlib em Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/zlib/).
- PDF.js: [projeto Mozilla](https://github.com/mozilla/pdf.js), [API oficial](https://mozilla.github.io/pdf.js/api/) e [aviso oficial sobre versões antigas com eval](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq). Dependências são fixadas pela integração principal; este worktree não instalou bibliotecas nem alterou package/lockfile compartilhados.

## SIGAA público: contrato observado

Fontes: [entrada pública](https://sigaa.sistemas.ufg.br/sigaa/public/home.jsf), [consulta de extensão](https://sigaa.sistemas.ufg.br/sigaa/public/extensao/consulta_extensao.jsf?aba=p-extensao) e [orientação da PROEX](https://proex.ufg.br/p/32243-sigaa-publico).

O link canônico é `https://sigaa.sistemas.ufg.br/sigaa/link/public/extensao/visualizacaoAcaoExtensao/{id}`. Uma consulta observada no [relatório oficial do Rolê](https://files.cercomp.ufg.br/weby/up/694/o/Relat%C3%B3rio_-_Rol%C3%AA_da_Extens%C3%A3o_-_2025-26.pdf) aponta para a ação `13854`. Em 2026-10-31, o registro público informa título “Rolê da Extensão e Cultura da UFG”, ano 2025, modalidade projeto, área Comunicação e unidade proponente PROEX. A menção a um edital de programas no financiamento não muda a modalidade da ação. A vigência de 2026–2030 não foi comprovada por essa leitura.

A aplicação JSF redireciona para `viewDadosCursoEvento.jsf`. Cookies anônimos precisam acompanhar os redirecionamentos; sem isso, pode aparecer um detalhe vazio com ID zero mesmo com HTTP 200. O importador rejeita a resposta vazia/identificador divergente. Guarda os cookies somente em memória durante a consulta, não recebe cookies do usuário nem acessa login. Limites: cinco respostas, doze segundos e 256 KiB; apenas HTTPS e rotas públicas de extensão do host exato. Redirecionamentos externos e desafios de verificação interrompem a operação. Nenhum CAPTCHA foi encontrado nas leituras de 2026-10-31; isso não garante ausência futura. Não foi identificada API JSON oficial documentada para esse fluxo.

O filtro público publica modalidades `1=programa`, `2=projeto`, `3=curso`, `4=evento`, `6=prestação de serviços`, `7=ACEx`. O formulário observado oferece 320 opções de unidade, incluindo `855 / 11.34.16` para PROEX e `843 / 11.34.12.04` para DLOG. IDs e códigos são strings e têm funções diferentes. Esses valores são evidência de pesquisa, não uma carga automática das unidades nem autorização para coleta em massa.

## Fontes institucionais para próximas evoluções

- [Equipe PROEX](https://proex.ufg.br/p/equipe-proex), página atualizada em 2026-10-05: grupos e funções institucionais. Não usar a lista para criar usuários, associar uma identidade ou conceder permissões automaticamente. Fotos/contatos da equipe não são importados por este fluxo.
- [SECPLAN — organogramas](https://secplan.ufg.br/p/51207-organogramas) e [Portaria 5927 de 02/09/2026](https://files.cercomp.ufg.br/weby/up/1094/o/SEI_6495517_PORTARIA_SIG_5927_2026.pdf): referência formal de hierarquia; revoga a Portaria 4265/2026. A PROEX reúne a área administrativa e as diretorias de Extensão e de Articulação/Logística; a PROAD possui DLOG e sua coordenação de patrimônio. Não inferir relação hierárquica somente pela ordem de nomes na página de equipe.
- [Manual da Extensão 2025](https://files.cercomp.ufg.br/weby/up/694/o/manual_da_extens%C3%A3o_2025_revisado.pdf): campos e tramitação de ações. O documento distingue modalidades, unidade proponente/coexecutoras, público, financiamento, descrição, objetivos, equipe, arquivos e fotos. Esses detalhes não estão necessariamente disponíveis na consulta pública.
- [DLOG — SIPAC Patrimônio](https://dlog.ufg.br/p/36979-sipac-patrimonio) e [manual disponibilizado pela DLOG](https://files.cercomp.ufg.br/weby/up/355/o/SIPAC_Patrimonio_PortalAdministrativo.pdf): tombamento, denominação, marca, condição, localização e unidade; movimentações distinguem transferência, empréstimo e devolução. O manual é de 2017 e contém exemplos de outra instituição; usar como referência de interface, sem presumir todos os procedimentos atuais.
- [Agentes patrimoniais](https://dlog.ufg.br/p/36978-agentes-patrimoniais-atribuicoes-e-concessao-de-perfil): designação institucional e perfil no SIPAC são processos próprios. Não há acesso público comprovado a cadastro/inventário patrimonial para importação automática.
- Orientações atuais da DLOG para [CAPES](https://dlog.ufg.br/p/60089-orientacoes-para-incorporacao-de-bens-adquiridos-com-recursos-capes), [CNPq](https://dlog.ufg.br/p/41994-orientacoes-para-cadastro-de-bens-oriundos-de-projetos-de-pesquisa-do-cnpq) e [FAPEG](https://dlog.ufg.br/p/54071-orientacoes-para-cadastro-de-bens-oriundos-de-projetos-de-pesquisa-junto-a-fapeg): processo SEI, nota fiscal, fotos, termo e despacho com indicação da lotação; documentos específicos da agência também são exigidos. O portal permite guardar referências/comprovantes autorizados, mantendo o procedimento institucional fora dele.

## Validação

`node --test tests/importer.test.mjs tests/import-documents.test.mjs` usa fontes e identidades sintéticas, fetch injetado e SQLite em memória. Cobre parser, datas/zeros/entidades HTML, exclusão de dados de acesso, limites, SSRF, cookies anônimos, CAPTCHA, página vazia, prévia sem gravação, confirmação ligada ao usuário e ao prazo, escopo, edição visual, retomada após falha e saldo inalterado. DOCX usa ZIP/deflate real, CRC e casos malformados; PDF testa o pipeline com engine injetada, limites, páginas e opções. A execução do PDF.js real precisa também da conferência de navegador, incluindo o carregamento do worker. Não depende dos sistemas oficiais estarem disponíveis.

Conferência isolada em Chrome em 2026-10-31: a entrada real `import-pdf-text.ts` foi compilada pelo Vite e servida em loopback com seu worker local. Um PDF sintético de duas páginas, gerado com `pdf-lib`, foi lido pelo PDF.js real; a página mostrou `ok=true`, duas páginas e preservou o tombamento `000789`, marca e modelo. Nenhuma produção foi acessada; aba/helper encerrados e diretório temporário removido. Essa prova não substitui a navegação da interface integrada, o envio multipart ou o teste de aparelhos físicos. Tipos/lint específicos e builds Node/Worker também passaram neste worktree.

## Compatibilidade com organizações (R04)

Após a migração0008, novos projetos exigem organização explícita. A interface só oferece organizações ativas com canManage; mostra nome fixo quando há uma, e exige seleção sem padrão quando há várias. O token v2 e a proveniência registram organizationId. O servidor revalida o vínculo para prévia, gravação e replay, e atualiza o ator após criar projeto para registrar a fonte na organização correta. A organização de projeto existente não pode ser trocada por importação. Fontes duplicadas são detectadas dentro da organização, sem consultar projetos de outra equipe. Prévia antiga v1 exige regeneração. Aliases Data de fim, Data de término e Término são reconhecidos e testados, sem inferir data ausente.

## Integração patrimonial R07

Os dezesseis campos de asset-metadata passam pela prévia visual e validação. Para novo equipamento, somente valores selecionados e documentados são mapeados ao cadastro; ausências permanecem NULL e o saldo continua zero. Tombamento e série permanecem texto, com zeros iniciais. Data de aquisição é data civil. acquisitionValueCents aceita apenas centavos inteiros expressamente identificados e exige referência documental também selecionada; moeda e valores ausentes não são inferidos. Para bem existente, a importação continua criando somente uma conferência e anexos, sem sobrescrever metadados nem histórico. Responsável documentado é descrição da fonte, sem conceder contas, vínculos ou custódia jurídica. Teste percorre os dezesseis campos no domínio real e prova que nova conferência não sobrescreve o bem.
