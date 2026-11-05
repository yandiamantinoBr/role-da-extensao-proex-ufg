# Central de IA, equipes, MCP e checklists de atividade

## Resultado e estado

[PR #34](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/34) publicada no merge `bd36d084ce475c6f43fc765b2f36ebded6594193`. Vercel `dpl_HfBiVwe913M2kuWawJc2jNjc1y3o` READY no mesmo SHA e vinculada ao domínio oficial. CI final `42037080311` aprovado; revisão funcional `a9bb470` passou **1072/1072 testes do Portal**, tipos, builds Worker/Node e smoke de autenticação; jogo também aprovado.

Conferência posterior ao deploy: saúde200, raiz307 para login, Equipes/cofre/credenciais MCP401 sem sessão e `private, no-store`, dois deploys aposentados403. O Chrome retornou `Debugger unattached`; portanto não foi realizada nova inspeção visual autenticada dessa revisão em produção. A evidência visual abaixo é sintética e identificada por fluxo.

## O que muda

- **Configurações → Chaves e modelos:** central com Chaves, Funções e acesso e Diagnóstico. Conta conserva perfil e conexão pessoal MCP. A administração de IA não fica duplicada no assistente operacional. A permissão nominal de TI permite os ajustes concedidos, sem liberar cadastro/recuperação de chaves. A rotina ChatGPT/Sites fica oculta na hospedagem independente.
- **Uso da IA:** política pessoal ou organização verificada no servidor em operações, documentos, triagem e voz, antes de reserva/transporte e ao concluir/repetir. Configurações novas começam pessoais e desligadas; JSON legado conserva seu comportamento anterior. Uma chave salva ou troca de provedor não ativa função.
- **Groq no cofre:** quarta credencial por organização e escolha explícita de transcrição. O roteamento legado existente é preservado até mudança deliberada; remoção/desativação não recorre silenciosamente à chave do ambiente. Reserva documentada por duração, mínimo de dez segundos. Sem promessa de gratuidade e sem chamada real nesta entrega.
- **Equipes:** página própria, vínculos sobrepostos, integrantes no recorte autorizado, gráfico de estados, filtro, paginação e PDF/DOCX/XLSX do conjunto autorizado. Afiliação não concede papel. Pessoas e acessos continua separada e só tem atalho para quem pode abri-la. A revisão corrigiu perda de vínculo durante leitura/exportação e preservou foco/rolagem na atualização do gráfico.
- **Checklist de atividade:** modelo editável de mesa de apresentação, passos com Sim/Não/Não se aplica e observação, versão por passo, histórico e delegação existentes. Respostas negativas de pessoa delegada exigem revisão da gestão para concluir. Não movimenta estoque, não fecha empréstimo nem inventa presença. A mestre distingue o tipo; passos/notas/histórico ficam fora das projeções portáteis.
- **MCP pessoal:** credencial própria, hash no banco, validade de até trinta dias, projetos explícitos e duas consultas somente leitura. Revalida conta, vínculo, organização e revogação antes e depois da consulta. Protocolo HTTP2026-07-28 documentado, sem OAuth/compatibilidade automática com clientes antigos; endpoint legado permanece separado. Não oferece escrita, SQL ou acesso à mestre.

## Integração e dados

Migrações0024–0026 e snapshots reconciliados em ordem, 98 tabelas de aplicação. A ampliação do CHECK de provedor reconstrói somente metadados do cofre. Testes com dados populados conferem nove colunas, PK, FK, preservação e rollback após falha; o guard continua recusando outras exclusões/renomeações. As 35 projeções da mestre continuam conferidas, sem passos de atividade ou credenciais MCP.

O auditor reproduziu uma condição de equipe sem demandas que continuava visível após remover afiliação durante a exportação. A correção repete a condição de visibilidade e o roster antes do retorno. O probe final recebeu403; atribuição, cadastro de pessoa e acesso a projeto permanecem separados.

## Evidência funcional e visual

- Bancada autenticada real, HTTP → serviços → SQLite descartável: cadastro por formulário do Sheets sem código, resposta perdida, metadados nos dois sentidos, concorrência e conflito; todas as35 projeções conferidas. Nenhuma planilha Google real foi alterada neste ensaio.
- Backup sintético de5.317.960bytes restaurado fisicamente, SQLite1.417.216bytes e um objeto privado conferido por hash; streaming163chunks. Isso não confirma restauração do backup atual de produção nem comportamento serverless.
- Checklist no navegador: modelo → rascunho → criação → três respostas com observação → quarta resposta → conclusão. Seis eventos de histórico; estoque e reservas inalterados.375/390/1366px, dois temas, alvos44px, sem excesso horizontal/erroJS.
- MCP no navegador: criar → consulta200 → ocultar segredo → confirmar revogação → mesma consulta401. Quatro capturas normais390/1366, claro/escuro; nenhuma credencial visível nas provas. A primeira captura de elemento alto foi rejeitada por corte/oclusão e substituída por viewport e geometria estáveis.
- Central de IA: oito contextos390/1366, claro/escuro, Chaves/Funções; troca de organização, salvar política, campo de chave apagado, Groq desligado até confirmação e diagnóstico sem consentimento recusado. Respostas de provedores são sintéticas; zero inferência real.
- Equipes:375/390/1366, dois temas, criar/editar, gráficos,403 limpando tela, foco/rolagem e datas inteiras; PDF3páginas e OpenXML reabertos. Página1 do PDF renderizada e revisada. A revisão visual do DOCX no Word continua pendente.

Pareceres independentes: **9,0/10** para Central de IA, Equipes, checklist e MCP nos recortes especificados. Não é nota de toda a plataforma, certificação WCAG, teste em aparelho físico ou inspeção visual de todas as páginas dos relatórios. Capturas e logs locais ficam ignorados pelo Git, com dados sintéticos.

## Limites operacionais reais

`PROEX_KEYS_SECRET` está ausente em produção. O provisionamento automático foi bloqueado pela revisão de aprovação antes da execução; nenhuma chave/arquivo foi criado e não se deve contornar por outra ferramenta. A central mostra o bloqueio ambiental sem mandar de volta à Conta. O usuário informou ter desbloqueado o Bitwarden, mas a CLI continuou bloqueada; a proteção da ferramenta também impediu abrir o aplicativo. Não foi solicitada senha no chat nem alterada a política de bloqueio.

OpenAI está em implementação separada, sem chave/modelo real; Anthropic/Gemini/NVIDIA e endpoints personalizados exigem adaptadores próprios. A central não apresenta seletores inoperantes como integrações prontas.

Sheets por equipe + projeto, edição de demandas em arquivo restrito, organograma formal editável, migração institucional e instalação Google por projeto permanecem etapas próprias na fila. O arquivo institucional do CONPEEX mantém seu link anterior; não há recibo novo de conector nativo instalado. A conexão do Chrome ficou indisponível na preparação; não foi confirmado salvamento do vínculo e não houve emissão de chave real. Nenhum convite, aviso de QA, e-mail real, dado de presença ou quantidade de material foi inventado em produção.


## Recibo Sheets posterior ao deploy - 05/11/2026

A mestre existente confirmou no Controle syncState=verified,35 tabelas e completed em2026-11-05T14:07:07.699Z (11h07 de Brasília), com o conector2026-11-04.1. O cabeçalho da projeção followup_checklists inclui kind. Leitura pelo conector Google Sheets, sem disparo manual/edição nessa rodada; IDs e detalhes privados na Vault. Confirma o recibo posterior à PR34 e a nova coluna, não o conjunto inteiro de células, o gatilho executor, escrita bidirecional em dados reais nem instalação dos novos arquivos por projeto/equipe.
