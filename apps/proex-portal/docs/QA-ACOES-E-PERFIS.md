# Ações de projeto e acessos · 14/11/2026

Coordenação, técnicos, bolsistas e voluntários precisam encontrar o próximo passo dentro do seu projeto. O teste usa uma ação fictícia no Sparks e dois projetos descartáveis. A autorização vem do vínculo ativo, dos poderes daquele perfil no projeto e, no caso de um leitor que responde a uma demanda, da autorização naquela demanda.

## Fluxo de uma ação

- **Articulação, apoio no dia, água e lanches.** Na ficha, abra Demandas e selecione Checklist de atividade. Escolha um modelo, acrescente as verificações, revise o texto, vincule a dinâmica se houver e atribua a frente a uma pessoa ou equipe. Use totais no planejamento de alimentação.
- **Registro da ação.** O modelo orienta a conferência das informações. Na ficha, abra Registros e fotos, crie o registro e anexe as fotos ou PDFs. O projeto selecionado também delimita o rascunho.
- **Foto e vídeo.** Use um checklist próprio para a cobertura. Os anexos privados ficam no registro do projeto. Cadastre a pasta de vídeos em Links e documentos da ficha, com permissões da equipe no Drive. Os anexos aceitos são PDF, JPEG, PNG e WebP, com até 4 MB por arquivo. O sistema ainda não oferece pasta por ação ou upload de vídeo.
- **Bolsistas.** Um leitor pode acompanhar a demanda. Para atualizar andamento ou responder ao checklist, a gestão deve atribuir a pessoa e usar Autorizar atualizações nesta demanda. Remover o vínculo ou revogar a autorização interrompe o acesso correspondente.
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

O próximo recorte funcional é vincular registro e referências privadas à ação, para localizar mídias e relato quando o projeto tem várias atividades. O armazenamento de arquivos e as permissões devem continuar compartilhando o fluxo atual de anexos e pastas, com teste de revogação no projeto e na ação. O suporte da TI é uma função organizacional. Alterações de credenciais, configurações de modelos e backup exigem suas autorizações próprias.

Ao retomar, defina o resultado por perfil, a ação que prova o caso normal e a tentativa que deve ser recusada. Abra uma alteração por frente. Execute a jornada real em dados sintéticos e repita depois de corrigir os achados de revisão. Registre o SHA, a evidência e as lacunas na Vault. [Boas práticas do Codex](https://learn.chatgpt.com/docs/learn/best-practices) · [Boas práticas do Claude Code](https://code.claude.com/docs/en/best-practices)
