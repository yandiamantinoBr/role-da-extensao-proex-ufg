# Mapa de adaptadores de IA por capacidade

Estado técnico de 05/11/2026. Este mapa separa código ensaiado de conexão externa real. A inclusão de Groq por organização ainda depende da publicação e da configuração institucional descritas no [runbook](GROQ-COFRE-ORGANIZACAO.md). O objetivo “usar qualquer API” é progressivo: cadastrar uma chave só é suficiente quando há um adaptador validado para a função e para o contrato daquele provedor.

| Capacidade | Adaptador existente | Fronteira e limite | Próximo aceite real |
| --- | --- | --- | --- |
| Proposta estruturada de operação | DeepSeek Flash | JSON fechado, fonte literal do pedido, um intento, contexto de até 100 materiais; sem SQL, permissões ou navegação arbitrária | Conexão autorizada e conjunto factual de pedidos em português, com custo e erro medidos |
| Conferência de decisão | TypeSafe JEV | Resposta/versão validadas, limiares de confiança e abstenção; não é escritor de domínio | Medir falsas aprovações, ambiguidades e custo da versão configurada |
| Interpretação documental | DeepSeek e extração já implementada | Prévia com proveniência; documento é dado, não instrução; não confirma cadastro/estoque automaticamente | Ensaios representativos SIGAA/patrimônio com revisão humana e campos ausentes explícitos |
| Transcrição de voz | Deepgram Nova-3 e Groq Whisper Turbo | Áudio validado local/servidor, consentimento, duração/tamanho, cota; texto revisável, sem executar o comando | Microfones/codecs reais, português institucional, nomes próprios, números/quantidades e prazo |
| Diagnóstico de credencial/modelo | Quatro provedores acima | Metadados autenticados, endpoints fechados, revisão/cota própria, nenhuma inferência | Consulta real autorizada; não confundir sucesso de catálogo com sucesso de inferência |
| Novos provedores/modelos | Ainda não implementados: NVIDIA, OpenAI, Anthropic e outros | Uma chave compatível com HTTP/OpenAI não prova o mesmo esquema, modalidade, preço, retenção ou tool calling | Escolher capacidade e modelo, criar adaptador, validar saída/custo/privacidade e só depois disponibilizar |
| Orquestração externa e MCP | `/mcp` e conectores de sincronização existentes, com evolução de autenticação/escopo em frente própria | MCP organiza ferramentas; não substitui adaptadores nem concede privilégio. Apps Script por projeto é um conector restrito separado | Cliente real autenticado, duas organizações, revogação, metadados de protocolo, quotas e negação de ações fora do escopo |
| Canva/Drive/Instagram/WhatsApp | Referências e recursos manuais existentes; plugins da ferramenta de desenvolvimento não são integrações automáticas do site | Nunca herdar contas/chaves da máquina do agente para os usuários do Portal | Definir conta institucional, OAuth/permissões, recursos observados, prévia e confirmação de compartilhamento/publicação |

## Contrato para adicionar um adaptador

1. Declare **a capacidade**, endpoint HTTPS permitido, modelo/revisão, formatos de entrada/saída, limites de tamanho/tempo e preço/unidade/mínimo. Verifique fontes oficiais na data. Suporte de texto não implica imagem, áudio, vídeo, decisão ou ferramentas.
2. Use credencial cifrada e vinculada à organização, com criação/rotação/desativação auditadas. Nunca aceite segredo em rótulos, descrição, endpoint ou prompt. Falta de chave deve produzir estado explícito, sem trocar de provedor silenciosamente.
3. Preserve sessão canônica, escopo do projeto, conta/concessão vigentes e versão da configuração antes e depois do transporte e na transação que aplicará o resultado. A resposta do modelo não concede papel, acesso ou autoridade.
4. Faça reserva antes do transporte, em unidade inteira auditável. Conte requisições/tokens/segundos conforme a modalidade. Mantenha recibo e chave estável; o mesmo envio recupera o resultado. Tentativa incerta não gera retry pago implícito. Registre reserva e consumo confirmado separadamente quando disponíveis.
5. Valide bytes e esquema, limites da resposta, modelo retornado e trechos de origem. Recuse campos/IDs inventados, acesso cruzado, saída truncada, chave refletida e instruções nos documentos. Redirecionamentos e destinos arbitrários ficam bloqueados.
6. Mostre prévia simples com origem, antes/depois, quantidade, unidade, projeto e pendências. Propostas de alteração exigem confirmação específica. Use os serviços de domínio já existentes com CAS/idempotência; nunca execute SQL ou código emitido pelo modelo.
7. Exercite fixtures em português para negativas, número/tamanho/troca de unidade, projeto homônimo, texto pessoal, ambiguidade e documento incompleto. Inclua duas organizações, revogação no meio do pedido, corrida de versão, timeout, perda da resposta, quota concorrente e resposta hostil.
8. Separe a avaliação de contrato com transporte falso da prova externa real e da avaliação de qualidade/custo. Faça primeiro um piloto opt-in pequeno, com limites explícitos e evidência registrada na Vault e no repositório. Não prometa “gratuito” a partir de uma cota promocional.

Os próximos adaptadores devem se encaixar nesse contrato. Um gateway universal de URLs/modelos/chaves sem contratos e avaliações retiraria as garantias que os usuários precisam para alterar estoque, projetos e documentos institucionais.
