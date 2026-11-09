# Evidências · Google Drive por pessoa · 2026-11-09

Bancada local descartável (`127.0.0.1:5173`, build de produção Node), dados 100% sintéticos: conta de QA, projeto "Rolê da Extensão (QA)", e-mail Google `…@example.test`, pastas e envios inventados. Nenhuma chamada ao Google: a conexão e as pastas foram gravadas direto no banco temporário, e a tela de "Enviado" usou uma resposta simulada no navegador. Capturas por Chrome sem janela (CDP), em 1366 px e 390 px, temas claro e escuro; abaixo, uma seleção.

| Arquivo | O que mostra |
|---|---|
| `conta-desktop-claro.png`, `conta-celular-escuro.png` | Conta › Google Drive: conta conectada, como funciona, pastas que a pessoa pode usar (liberada ou "Liberar no Google"), envios recentes com o motivo de um envio que não chegou |
| `pastas-desktop-claro.png`, `pastas-celular-escuro.png` | Configurações › Pastas do Drive: pastas em uso, arquivada e o aviso "Fora do drive compartilhado" |
| `cadastro-celular-claro.png` | Formulário de cadastro (escolher no Google, nome, finalidade, quem pode usar, projeto, unidade) |
| `envio-1-desktop-claro.png` | Diálogo de envio, etapa 1: pasta sugerida e nome do arquivo |
| `liberar-celular-escuro.png` | Primeira vez numa pasta: "Liberar no Google" como ação principal, rodapé fixo |
| `envio-2-celular-escuro.png` | Etapa 2: conferência (pasta, nome, origem, "vai sair em nome de") |
| `envio-3-desktop-claro.png` | Etapa 3: enviado, com "Abrir no Drive" |

**Verificado:** nenhum erro de página nem rolagem horizontal nas 40 capturas; foco, rótulos e etapas conferidos pela crítica independente.

**Não verificado (depende da configuração do Yan no Google Cloud):** a tela real de consentimento do Google, o seletor do Google (Picker) aberto de verdade, o envio real a um drive compartilhado e a revogação feita em myaccount.google.com. O passo a passo e o teste de aceite estão em `apps/proex-portal/docs/GOOGLE-DRIVE.md`, seção 6.
