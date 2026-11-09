# Evidências sintéticas · catálogo de modelos e gastos · 09/11/2026

Base descartável em `127.0.0.1:5174`, sem produção. As chaves são falsas, e nenhum provedor foi chamado. O gráfico de gastos usa dados simulados no navegador, porque a base descartável não tem histórico de chamadas. A agregação real tem testes em `tests/ai-spending.test.mjs`. `verification.json` lista as vistas e registra zero erros de página.

Larguras de 1366 e 390 px, temas `light` e `dark`:
- `*-chaves-por-funcao.png`: chaves agrupadas em Conversa e fotos, Voz para texto e Decisão.
- `*-modelos.png`: catálogo por função, com provedor, nome na API, capacidades, preço, fonte e data, e as ações Editar e Apagar.
- `*-comparar.png`: escolha de 2 a 3 modelos, pergunta, custo máximo e autorização.
- `*-gastos.png`: cartões, gráfico por dia (por provedor ou por função), limite diário e exportação.

Não cobre: chamadas reais aos provedores novos, o download real dos arquivos PDF, XLSX e DOCX, nem leitor de tela.
