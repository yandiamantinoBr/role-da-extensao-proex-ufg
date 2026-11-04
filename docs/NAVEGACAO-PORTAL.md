# Voltar e Avançar no Portal

## Uso

Abra um módulo pelo menu ou siga um link de uma ficha. **Voltar** retorna à tela anterior e **Avançar** abre novamente a próxima tela. O Portal conserva o projeto, a unidade, a área e o detalhe vinculados ao endereço de cada etapa. Ajustar os filtros de contexto atualiza a etapa em que você está.

Os formulários com rascunho automático guardam também a digitação feita logo antes de sair da tela. O rascunho segue vinculado à sua conta no navegador. Os campos que já eram excluídos dos rascunhos continuam fora do armazenamento local.

Ao voltar a um endereço antigo, o Portal confere os acessos disponíveis na sessão atual. Quando o módulo deixou de estar disponível, o endereço é ajustado para o Início. Os detalhes de materiais também conferem se o registro pertence ao projeto indicado.

## Verificação em 04/11/2026

Na base `3ac2a33`, **Início → Materiais → Agenda** mantinha três entradas no histórico do Chrome e **Voltar** abria a página de login anterior ao Portal. No candidato, a mesma sequência passou de três a cinco entradas e **Voltar** abriu Materiais. **Avançar** retornou à Agenda.

Com o banco descartável da bancada local, o Chrome conferiu a troca de projeto sem entrada adicional, a restauração de um rascunho digitado imediatamente antes de sair, o link Agenda da ficha e o retorno à mesma ficha. Em 375 e 390 px, o toque na marca abriu o Início e a volta pelo navegador recuperou a Agenda e o foco no conteúdo. A inspeção também cobriu o desktop de 1366 px e os temas claro e escuro. A perda de acesso a Materiais foi simulada na resposta de atualização e a entrada antiga passou a abrir o Início.

Os ensaios usaram dados sintéticos e verificaram o contexto compartilhado pelo endereço. As datas e os controles específicos que cada módulo guarda internamente seguem o comportamento próprio desses módulos. O teste de toque usou emulação do Chrome.
