# V11: organizações, patrimônio e assistente revisado

Estado em 31/10/2026: candidato local, ainda não publicado neste registro. Autorização permanente de publicação consta em `AGENTS.md` e `REQUISITOS-E-CONTINUIDADE.md`.

## Comportamento

Organizações agora delimitam projetos e administração local. O catálogo de unidades UFG continua descritivo. Administradores locais podem gerenciar gestores dos próprios projetos; não recebem administração da plataforma. Leituras, mutações, arquivos, relatórios, agenda, importação e sincronização revalidam o escopo no servidor, inclusive em repetição idempotente e revogação concorrente.

Patrimônio individual tem cadastro manual/documental com prévia, tombamento textual, campos de origem, conservação, localização e referências. Novo equipamento começa sem saldo. Campos privados extras nos relatórios são opcionais e protegidos; dados ausentes permanecem ausentes. A importação identifica a organização explicitamente e preserva a fonte.

Assistente de estoque/registros: configurar provedores e limites por organização, delegar configuração a TI sem ampliar acesso ao estoque, preparar proposta com antes/depois, revisar e confirmar. Chaves cifradas ficam no servidor. DeepSeek e conferência opcional Jev/TypeSafe têm limites e reservas atômicas; repetição concorrente não duplica chamada paga. Áudio gravado/arquivo pode ser transcrito pela Deepgram após consentimento; a pessoa revisa o texto antes de preparar a operação. Transcrição cifrada dura uma hora para recuperar o mesmo envio; não há gravação persistida. Provedores permanecem desabilitados até configuração explícita; testes usam respostas sintéticas, sem cobrança.

## Validação do candidato

- 520/520 testes em Node 24.22.1 e Node 26.12.1; TypeScript sem erros; ESLint sem erros, três avisos preexistentes. Builds Worker e Node passaram. A montagem final recebeu pequenas correções de atualização e tema após o primeiro build; reconferir os gates antes de publicar.
- Revisão independente dos serviços de organização e IA/STT fechou falhas de replay após revogação, concorrência na reserva e persistência tardia após perda de autoridade. Modelo Drizzle reconciliado com as 12 migrações SQL, 59 tabelas e cadeia de snapshots. Geração oficial resulta em diff vazio; migrações SQL existentes permaneceram intactas. Triggers/backfills são autoritativos no SQL. Drizzle Kit 0.31.10 tem limitação ao regenerar do zero índices com expressão e vírgula; revisar SQL gerado antes de aplicar.
- Backup real V10 validado e quatro migrações novas aplicadas offline, só em memória. Valores existentes das 49 tabelas preservados, integridade OK, zero violações FK e todos os projetos associados à PROEX; nenhum arquivo em claro ou chamada de rede.
- QA HTTP sintético: servidor → autenticação → API → banco → relatório; conector simulado e backup/recuperação isolada com objeto privado passaram. Backup sintético 5.283.971 bytes, SQLite 864.256 bytes; pico de RSS do processo 271.392 KiB inclui preparação e criptografia, não é medição isolada do endpoint.
- Benchmark em loopback, processo único e dados sintéticos: evento público p50 1,18 ms/p95 1,50 ms (25 amostras); painel autenticado p50 10,08 ms/p95 12,17 ms (25); evento público 100 requisições, concorrência 10, zero erros, p50 8,96 ms/p95 11,75 ms. Não estima capacidade serverless/CONPEEX.
- CUA integrado: criar organização → reler lista; configuração de IA por organização → salvar desabilitada → reler recibo; patrimônio com prévia → confirmar → catálogo → aba patrimonial. Tombamento `00000123` preservado, saldo inicial zero. 375/414/1250 px sem overflow; console sem erros. Evidência sintética em `.sites-runtime/v11-evidence`, não enviada ao Git público.

## Proteção e operação

O código antigo interpreta concessões de organização como globais. WAF aceita somente o domínio canônico; URLs geradas V9/V10 foram verificadas como 403 e Preview não tem banco/autenticação de produção. Executar `node scripts/check-release-isolation.mjs` antes da publicação. Não voltar para código anterior à 0008 com banco atualizado.

Google Sheets real: primeiro gatilho de dados concluído em 31/10/2026 às 14:36:45.344Z, 142 linhas e zero conflitos; rotina automática de anexos confirmou uma cópia, zero falhas, às 14:53:40.406Z. Histórico de execução e recibos foram conferidos no navegador. Isso comprova aqueles instantes, não disponibilidade permanente.

## Continuidade

R17–R22 acrescentados a pedido de Yan: demandas prioritárias, checklists pós-evento, equipes com vários vínculos, inbox/sino, e-mail e WhatsApp. Agente em `v16-acompanhamento`, migração reservada 0014; público em 0012 e backup automático em 0013, ainda separados deste candidato. Não considerar esses pedidos concluídos por este documento. Conta de envio e autorização MailApp não foram ativadas; nenhum e-mail/WhatsApp real de QA.

Guardar separadamente o segredo original do servidor para reutilizar configurações de IA cifradas recuperadas de backup; o arquivo não inclui variáveis secretas da hospedagem. Transferência da chave de recuperação DPAPI para gerenciador e custódia institucional continuam pendentes na Vault.
