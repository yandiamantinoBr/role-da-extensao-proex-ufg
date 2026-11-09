# Entrega 09/11/2026 · exportação, Agenda, fotos e Configurações

Branch `claude/mystifying-sanderson-7b4c51`. Quatro pontos de uso pedidos pelo Yan em 09/11/2026.

## 1. Agenda: a página descia a cada clique num dia

- **Causa:** ao abrir um dia, um efeito chamava `scrollIntoView({block:'start'})` no título da lista. Em telas largas a lista fica numa coluna `position: sticky`; rolar até um elemento fixo desloca a página, e como a lista muda de altura a cada dia, o deslocamento se acumulava até o fim. No QA, a chamada antiga levou a página de 250 px para 425 px no primeiro clique.
- **Correção:** abrir ou fechar um dia não rola nem tira o foco do dia. Quando a lista fica abaixo do mês (celular), aparece o atalho "Ver N registros do dia D", que rola só quando a pessoa pede. O status da lista anuncia o dia.
- **Prova:** `tests/calendar-panel-state.test.mjs` abre e fecha o mesmo dia quatro vezes e exige zero rolagens; outro teste impede efeitos com `scrollIntoView`. No QA em 1366 px, seis cliques mantiveram a página em 250 px; em 390 px, a posição também não mudou.

## 2. Miniatura da foto principal na lista de materiais

- `lib/portal-data.ts` traz `primary_photo_id` com a regra de `currentPrimaryPhoto` (escolha registrada da PR41 ou, antes dela, a primeira foto da galeria), via `LIST_PRIMARY_PHOTO_SQL`.
- Só quem tem `inventory.read` no projeto recebe o id, a mesma regra da rota de arquivos. Quem só cuida de empréstimos vê o equipamento sem foto.
- A lista mostra 48 px (44 px no celular), `loading="lazy"`, `decoding="async"` e um marcador neutro (ícone de pacote) sem foto ou se a imagem falhar.
- A rota de anexos permite cache privado de 10 minutos, com `Vary: Cookie`, só para imagens pedidas com `?v=list`. O logout já limpa o cache.
- **Limite:** a miniatura baixa a foto já reduzida no envio (até 1600 px). Uma variante pequena gerada no envio fica como melhoria futura.

## 3. Exportação comum XLSX · DOCX · PDF

- `components/portal/export-formats.tsx`: planilha verde, documento azul e PDF vermelho, com ícones SVG próprios, sem marca. A ordem é sempre planilha, documento e PDF. O nome acessível começa pelo texto visível ("Planilha XLSX — Baixar …"). Há modo `tiles` para cartões estreitos, extras (JSON, Imprimir) como filhos e `downloadFromServer` para arquivos do servidor. `ExportHandledError` serve para quando a tela já mostrou o erro.
- Aplicado em Relatórios (resumo diário e os três cartões de "Exportar registros completos"), na central de relatórios (barra do recorte e resumo do projeto) e em Equipes. Registros, Meu trabalho, programação, estrutura e consumo já usavam o componente e herdaram o visual.
- `/api/export` gera DOCX e PDF no servidor com o mesmo escopo e a mesma `projectAuthoritySql` do XLSX. DOCX e PDF usam rótulos e valores em português; o XLSX mantém as chaves antigas para não quebrar importações. Os nomes de arquivo saem em português.
- A fonte do PDF vem da origem configurada (`BETTER_AUTH_URL`). Sem ela, só a bancada local busca na própria origem, então um Host forjado não escolhe o destino. Erros inesperados viram aviso em português.
- **Prova:** `tests/portal-data.test.mjs` (DOCX/PDF autorizados, recusa a outro projeto e a perfil sem permissão, Host forjado, falha da biblioteca). No QA local, os nove arquivos (3 tipos × 3 formatos) foram baixados do servidor e abertos com openpyxl, python-docx e pypdf. O Word e o Excel por automação foram recusados pelo Windows nesta máquina; não foram usados.

## 4. Configurações por tarefa

| Antes | Agora |
|---|---|
| Chaves e modelos (primeiro) | **Inteligência artificial** › Chaves e modelos (último; central intacta, só mudou de posição) |
| Planilha e anexos (com o título interno "Dados e sincronização" repetido) | **Dados e cópias** › Planilha Google (sem o título repetido) |
| Backup e recuperação | **Dados e cópias** › Backup e recuperação |
| Acesso público | **Evento e participantes** › Cadastro público por celular |
| Operação e canais (só para dono da plataforma) + quadro "Integrações com estado explícito" | **Evento e participantes** › Página das dinâmicas (para quem tem `organization.manage`, a mesma regra do servidor); o quadro repetido saiu |

- No topo há um índice com os grupos do perfil. Ele abre o grupo e leva até ele, só ao clicar. Um aviso indica que nome, senha e conexões pessoais ficam em Conta, e os avisos por e-mail em Demandas.
- Quem só configura IA vê apenas "Inteligência artificial".
- **Fora do escopo, para depois:** os avisos por e-mail (no rodapé de Demandas) e as solicitações de privacidade (em Equipe) poderiam ganhar um lugar mais óbvio. Não mexi nisso para não mudar quem vê o quê.

## Verificação

- 1375/1375 testes do portal, tipos, lint (0 erros), `build` e `build:node`.
- QA local sintético na porta 5174. A 5173 estava com o QA da sessão visual, então usei uma cópia temporária do script, apagada depois. Capturas em 390 e 1366 px, nos temas claro e escuro, de Agenda, Materiais, Relatórios, central e Configurações, sem rolagem horizontal.
- Revisão independente (segurança e interface): 8/10 sem P0/P1. Os quatro P2 e os P3 de texto, cache, calendário e central foram corrigidos e testados.
