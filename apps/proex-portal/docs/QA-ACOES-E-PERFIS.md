# Ações de projeto e acessos · 14/11/2026

Coordenação, técnicos, bolsistas e voluntários precisam encontrar o próximo passo dentro do seu projeto. O teste usa uma ação fictícia no Sparks e dois projetos descartáveis. A autorização vem do vínculo ativo, dos poderes daquele perfil no projeto e, no caso de um leitor que responde a uma demanda, da autorização naquela demanda.

## Fluxo de uma ação

- **Articulação, apoio no dia, água e lanches.** Na ficha do projeto ou na Agenda, abra **Frentes** na atividade e depois **Checklist de atividade**. Escolha um modelo, acrescente as verificações e atribua a frente a uma pessoa ou equipe. Use totais no planejamento de alimentação. O checklist fica nessa atividade e também aparece como demanda do projeto.
- **Registro da ação.** O modelo orienta a conferência das informações. Na ficha, abra Registros e fotos dentro da atividade do cronograma, crie o registro e anexe as fotos ou PDFs. A atividade selecionada delimita a consulta, o formulário e o rascunho.
- **Foto e vídeo.** Use um checklist próprio para a cobertura. Em Registros e fotos, anexe arquivos PDF, JPEG, PNG ou WebP de até 4 MB. Em Vídeos da atividade, a gestão vincula uma pasta cadastrada pela administração para o mesmo projeto com o público Só gestão. Organize os vídeos na pasta pelo Google Drive, que aplica o compartilhamento da conta aberta no navegador.
- **Bolsistas.** Um leitor pode acompanhar a demanda. Para atualizar andamento ou responder ao checklist, a gestão atribui a pessoa e usa Autorizar atualizações nesta demanda. Em checklists ligados ao cronograma, pode também autorizar a cobertura. Essa opção permite criar registros naquele compromisso e anexar aos registros próprios. Retirar a cobertura mantém o acompanhamento. Quem perde o vínculo ou a atribuição precisa de nova autorização de cobertura após retornar.
- **Operação de dinâmica.** Quando o trabalho é atender e entregar brindes em uma única ação, o convite de voluntário delimita esse acesso e estabelece seu término. A descrição do convite distingue esse perfil das funções de projeto.

## Aceite reproduzível

```powershell
npx --yes pnpm@11.25.0 build:node
node scripts/qa-local.mjs --roles-smoke --invite-smoke --smoke
```

A bancada usa porta local 5173, SQLite descartável e convites fictícios. A matriz verifica o responsável, o gestor, o leitor, Materiais, Empréstimos, operador em outro projeto e o voluntário. Os controles negativos cobrem vínculo a recurso oculto e inexistente, resposta antes da autorização, leitura ou escrita de outro projeto, tentativa de anexar pelo leitor e uso da sessão depois de revogar o vínculo.

Uma alteração só de título preserva os vínculos que o editor não tem autorização para consultar. As opções de materiais, dinâmicas e empréstimos são lidas na mesma transação. Novos vínculos são conferidos na transação que salva a demanda. Os identificadores de vínculos já existentes em demandas e históricos continuam no retorno das consultas autorizadas à própria demanda. Há uso desses identificadores em conferências, transferências e histórico. Auditar os consumidores antes de alterar esse contrato.

No navegador, verificar 390 e 1366 px, temas claro e escuro, com a ficha, Documentos, convite e checklist. Criar registro, recarregar Documentos, voltar à ficha e fechar/reabrir um checklist que contém linhas de um modelo. O ensaio por HTTP salva e relê um PNG privado, byte a byte. Câmera física e Drive autenticado ficam como aceites separados.

## Continuidade

O vínculo à atividade do cronograma preserva os mesmos acessos ao registro do projeto. A migração SQLite 0047 acrescenta uma referência opcional e valida o projeto e a categoria no banco. Registros antigos seguem válidos. A atividade pode ser renomeada ou cancelada, com o vínculo preservado. A sincronização da administração expõe somente o identificador da atividade, além da projeção que já existia para Registros. Anexos continuam privados.

A migração SQLite 0048 guarda um vínculo por atividade. A seleção e a abertura revalidam a gestão no projeto e a pasta ativa da mesma organização. Em teste com Drive simulado, confirme o vínculo em duas atividades e tente abrir de outra organização, de outro projeto, como leitor e após revogar o acesso. O aceite com Drive real usa duas contas Google, uma com acesso à pasta e outra com a leitura revogada. O suporte da TI é uma função organizacional. Alterações de credenciais, configurações de modelos e backup exigem suas autorizações próprias.

A migração 0049 permite o vínculo do checklist ao compromisso. Ela preserva checklists anteriores e as permissões da demanda. Quem tem acesso à agenda deste projeto pode ver as frentes do compromisso. Criar um checklist vinculado exige gestão no projeto e atividade aberta a novos checklists. Quando a atividade é cancelada, os checklists existentes continuam disponíveis para registrar o que aconteceu. Cada pessoa segue precisando de permissão própria para responder ou concluir.

Ao retomar, defina o resultado por perfil, a ação que prova o caso normal e a tentativa que deve ser recusada. Abra uma alteração por frente. Execute a jornada real em dados sintéticos e repita depois de corrigir os achados de revisão. Registre o SHA, a evidência e as lacunas na Vault. [Boas práticas do Codex](https://learn.chatgpt.com/docs/learn/best-practices) · [Boas práticas do Claude Code](https://code.claude.com/docs/en/best-practices)
