# Tutorial Empréstimos · verificação local (2026-11-17)

- QA local descartável (127.0.0.1, dados sintéticos). Contas: empréstimos (completa), responsável e gestão; 1366 claro e escuro, 390 escuro, 360×640 claro.
- O capítulo segue a regra do módulo (`loans.read`, `loans.manage` ou `loans.checkout`); Nova reserva só com `loans.manage`; a próxima ação com gestão ou retirada.
- Os passos seguem a página: filtros, Nova reserva, cartões (situação e prazo), próxima ação e Ver histórico.
- Nenhuma reserva, retirada ou devolução foi registrada. Concluir grava a conclusão; Escape fecha a lista; sem erros de página e sem rolagem lateral.
- Com todos os capítulos prontos, "Próximos assuntos" sai da janela Ajuda e tutoriais.
- Crítica independente: **9,1 aprovada**, sem P0, P1 ou P2; os acabamentos sugeridos foram aplicados antes do merge.
- Não verificado: leitor de tela real, aparelho físico, zoom de 400%.
