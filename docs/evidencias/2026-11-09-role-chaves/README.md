# Evidências sintéticas · Rolê e central de chaves · 09/11/2026

As capturas vêm de uma base descartável em `127.0.0.1:5174`, sem produção e sem contas reais. As chaves usadas (`sk-test-only-…QA01`, `gsk_test_only_…QA02`) são falsas. Nenhuma chamada foi feita a provedor: a resposta do chat foi simulada no navegador, só para mostrar o desenho da conversa. `verification.json` lista as vistas e registra zero erros de página.

Larguras de 1366 e 390 px, temas `light` e `dark`:

- `*-chaves.png`: passos 1-2-3, cartões com recomendado, preço, dica mascarada e o botão **Testar**.
- `*-chaves-historico.png`: limite por dia e **Histórico das chaves**, que mostra só as dicas.
- `*-funcoes-role.png`: bloco do Rolê em "Funções e acesso", com interruptor, modelo e imagens.
- `*-inicio-botao.png`: botão flutuante com o rosto do Rolê (no celular, acima da barra inferior).
- `*-role-boas-vindas.png`: mascote, apresentação e sugestões.
- `*-role-custo.png`: custo máximo previsto antes de enviar.
- `*-role-conversa.png`: resposta (simulada) com custo real e teto, e a operação sugerida com o botão "Ver custo para preparar".

Não cobre: a chamada real a DeepSeek, Groq ou TypeSafe, porque não há chave real neste ambiente. Também não cobre a gravação de áudio no aparelho físico nem leitor de tela. O primeiro teste real de cada provedor fica no histórico da central em produção, depois que o Yan colar as chaves.
