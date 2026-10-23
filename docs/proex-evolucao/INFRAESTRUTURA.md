# Infraestrutura e dependências da PROEX

Levantamento de 20/10/2026, somente leitura. Nenhum projeto exclusivo PROEX/Rolê foi encontrado nos recursos Supabase e Vercel acessíveis. Os serviços institucionais fora dessas conexões não foram inspecionados. Não foram consultados segredos nem modificados recursos alheios. A arquitetura está em [ADR 0001](ADRS/0001-arquitetura-e-ambientes.md).

## Configuração a definir

Os nomes abaixo são propostas de contrato, sem valores. Parte da configuração pode residir no painel do provedor, em vez de variáveis do aplicativo. Confirmar nomes efetivos na implementação; não criar arquivos contendo credenciais a partir desta tabela.

| Nome proposto | Finalidade e local | Responsável proposto |
| --- | --- | --- |
| `PROEX_APP_URL` | Origem oficial e retornos autorizados | Responsável técnico e gestor institucional |
| `PROEX_AUTH_PROVIDER` | Provedor escolhido para o portal | Responsável técnico |
| `NEXT_PUBLIC_SUPABASE_URL` | Endpoint público, se Supabase for escolhido | Responsável técnico |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública limitada por políticas | Responsável técnico |
| `SUPABASE_SECRET_KEY` | Operações privilegiadas estritamente no servidor | Administrador do serviço |
| `DATABASE_URL` | Conexão de manutenção/migrações, protegida | Administrador do banco |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Aplicativo OAuth e configuração no provedor | Administrador institucional de identidade |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Envio transacional autenticado | Administrador institucional de e-mail |

Valores privilegiados nunca vão ao navegador, GitHub, logs ou documentação. Os ambientes terão credenciais distintas. Domínio, conta proprietária, região, guarda, backups e suplência administrativa continuam sem definição. Google OAuth, SMTP e envio de convites não foram configurados ou testados.

O SMTP padrão do Supabase tem restrições de destinatário e não é destinado à produção. Login por código/link e convites para o público exigem envio próprio compatível. A documentação recomenda configurar SMTP e controles de abuso; a conexão de e-mail disponível ao autor no chat não substitui essa infraestrutura. Fonte oficial: [Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Custos de referência

Valores públicos em USD, consultados em 20/10/2026; não representam a fatura atual nem contratação. Não foi feita conversão cambial. Uso excedente, impostos, SMTP, domínio e recursos opcionais podem acrescentar custos.

| Cenário condicional | Referência oficial e limitação |
| --- | --- |
| Supabase Free para experimento | US$0; pausa após uma semana de inatividade, limite de dois projetos ativos, sem backup automático. Elegibilidade não verificada. |
| Supabase Pro dedicado | A partir de US$25/mês, primeiro projeto incluído; adicionais a partir de US$10/mês. Consumo e configuração alteram o total. |
| Vercel Pro para portal compatível | Referência de US$20/mês; assentos e uso podem alterar o total. Compatibilidade do aplicativo ainda precisa ser validada. |

Fontes: [Supabase Pricing](https://supabase.com/pricing) e [Vercel Pricing](https://vercel.com/pricing). O [Vercel Hobby](https://vercel.com/docs/plans/hobby) é restrito a uso pessoal não comercial; não presumir adequação ao serviço institucional. O menor esforço nesta fase é concluir código e testes independentes de provedor, sem contratar serviços. Antes de homologação, identificar infraestrutura autorizada e comparar seu custo e responsabilidade operacional com as alternativas acima.
