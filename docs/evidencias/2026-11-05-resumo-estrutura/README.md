# Evidências do resumo pessoal e da estrutura institucional

Data:2026-11-05. Código do aplicativo:d631dba, idêntico ao head PR36 e275d8c. Somente QA local sintético: nenhum integrante/contato/link privado/chave real nas imagens ou no JSON. A revisão final é [este parecer](../../REVISAO-INDEPENDENTE-05NOV-DESIGN-FINAL.md), complementando [a terceira revisão](../../REVISAO-INDEPENDENTE-05NOV-DESIGN-TERCEIRA.md); reprovações anteriores permanecem no histórico.

As capturas esperam as fontes e o fim das animações finitas, com movimento reduzido. As primeiras imagens claras de desktop pegaram a transição da barra lateral/tema e não eram prova válida; foram substituídas por estas recapturas, sem alteração do produto. O parecer independente confirmou resolução do bloqueio de evidência.

- Resumo pessoal:375/390/1366px, claro/escuro,24cliques de cartões, recarga/Voltar/Avançar, sem overflow ou erroJS. Revogação simulada no transporte limpa os totais e retira links; revogações reais e estados tardios têm testes com SQLite.
- Estrutura:22estados, template editável11unidades+1nome longo sintético; criação/edição, vínculo/navegação à equipe, arquivamento bloqueado, desvinculação/arquivo/reativação e data portuguesa.44px medidos; Cancelar/Escape devolvem foco e não salvam.
- Documentos reais gerados no navegador:PDF62393B, DOCX32345B, XLSX12633B, duas consultas atuais por formato, pacotes Word/Excel reabertos sem IDs/contatos extras. O PDF de12unidades tem2páginas; a fixture curta cabe em1. Todos os seis campos são preservados.
- Cabeçalho do projeto:375/390/1366nos dois temas, título longo sem competir com Editar, sem rolagem horizontal. A frase em inglês na descrição foi inserida pelo helper local como dado sintético, nunca estática no produto nem em produção.
- Contraste da tela de equipes:40botões visíveis por tema; mínimo5,01:1no claro e7,46:1no escuro. Cor e fundo compostos medidos em estado estável, com opacidade1. Não é medição de todos os elementos do site.

## Benchmark interno

180amostras medidas,30por rota/concorrência, mais aquecimento, HTTP em loopback no Node compilado;5demandas,4responsabilidades e12unidades sintéticas. Valores emms. Não estima a capacidade de Vercel/Supabase ou um evento com grande público.

|Rota|Concorrência|p50|p95|
|---|---:|---:|---:|
|Saúde|1|3,5|5,4|
|Resumo pessoal|1|29,1|34,7|
|Estrutura|1|30,6|42,4|
|Saúde|5|24,0|35,2|
|Resumo pessoal|5|143,4|154,0|
|Estrutura|5|143,1|174,9|

[Recibos de geometria, cores e benchmark](verificacoes.json). As imagens desta pasta são uma seleção; os demais artefatos e helpers ignorados continuam na worktree de acabamento.

## Limites e refinamentos P3

Nota9é o aceite independente destes componentes no QA, semP0/P1/P2. Não certifica todas as abas, produção, aparelho físico, leitor de tela ou concorrência real no D1. Rótulo do vínculo no PDF, família do cabeçalho da tabela, posição/volume do feedback de Cancelar, duplicação contextual do projeto e texto de sessão revogada permanecem refinamentos P3 documentados nos pareceres. Não apagar o histórico para aparentar nota perfeita.
