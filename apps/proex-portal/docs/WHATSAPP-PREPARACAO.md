# WhatsApp para avisos da PROEX: preparação · 09/11/2026

Esta é a preparação para que, no futuro, o portal mande avisos por WhatsApp, por exemplo "3 pessoas do seu projeto ainda não confirmaram presença". **Nada foi contratado, criado ou aceito.** No portal, o canal existe e fica desligado até haver um número oficial.

As fontes oficiais da Meta foram lidas em 09/11/2026. Os preços e as regras mudam com frequência: confira de novo antes de contratar. O que não foi possível confirmar em fonte oficial está marcado como "não confirmado".

## O essencial

- **Plataforma:** WhatsApp Business Platform, pela Cloud API da Meta. Mensagens automáticas exigem a API, não o aplicativo WhatsApp Business.
- **Órgão público:**
  - A política diz que a Meta permite governos, "and require access through a Solution Provider", isto é, por um parceiro autorizado (whatsappbusiness.com/policy/, atualizada em 23/09/2026).
  - Não há fonte oficial dizendo se uma universidade federal conta como "government entity". **Não confirmado.** A TI ou a procuradoria da UFG devem confirmar antes de contratar.
- **Número oficial:**
  - Precisa ser da instituição e dedicado, sem uso em outro WhatsApp.
  - Precisa receber o código por ligação ou SMS. Número fixo funciona, com o código por ligação.
  - É obrigatório criar um PIN de verificação em duas etapas.
  - O nome de exibição é obrigatório e é verificado quando a conta sobe de limite.
- **Modelos de mensagem:**
  - Fora da janela de 24 horas, só se envia modelo aprovado. Um aviso que parte da PROEX sempre usa modelo.
  - A categoria certa é **utilidade** (alerta de serviço), em `pt_BR`.
  - A revisão leva até 24 horas e o envio só funciona com o status `APPROVED`.
- **Consentimento (opt-in):**
  - A pessoa precisa dar o número e autorizar mensagens, com o nome de quem envia.
  - Pedidos para parar de receber precisam ser atendidos.
  - O portal deve guardar data, texto aceito e versão de cada autorização.
- **Custo no Brasil** (tabela oficial válida desde 01/10/2026; cobrança por mensagem entregue desde 01/07/2025):

| Categoria | R$ por mensagem | US$ por mensagem |
|---|---|---|
| Utilidade | 0,0350 | 0,0068 |
| Marketing | 0,3217 | 0,0625 |

  - Exemplo: 1.000 avisos de utilidade por mês custam cerca de **R$ 35**.
  - Desde 01/10/2026, mensagens de utilidade são cobradas mesmo dentro da janela de 24 horas.
  - A cobrança em reais existe desde 01/07/2026.
  - A taxa do parceiro e eventual taxa de plataforma: **não confirmadas**.
- **Limites:**
  - Começa com 250 destinatários por dia fora da janela.
  - Com a empresa verificada, sobe para 2.000 e depois cresce automaticamente.
  - Bloqueios e denúncias reduzem a qualidade e o limite.

## Quem faz o quê

Na PROEX ou na UFG, nesta ordem:

1. Confirmar com a TI ou a procuradoria se a UFG conta como órgão público para a Meta.
2. Escolher um parceiro autorizado, por contratação pública.
3. Um administrador cria ou usa o portfólio empresarial (Meta Business) da UFG e verifica a empresa. Os documentos aceitos, inclusive o CNPJ, ficam **não confirmados**, porque a página de ajuda não carregou.
4. Separar um número dedicado e definir o nome de exibição (ex.: "PROEX UFG").
5. Cadastrar a forma de pagamento, ou usar o crédito do parceiro.

No portal, o desenvolvedor faz depois:

6. Recolher o consentimento dos gestores, com data, texto e versão, e permitir desligar a qualquer momento.
7. Criar o modelo de utilidade em `pt_BR`, por exemplo: "Convocação {{acao}}: {{n}} projeto(s) ainda sem resposta. Acompanhe: {{link}}". Esperar a aprovação.
8. Guardar o token de usuário do sistema só no servidor, como segredo, com o nome `WHATSAPP_ACCESS_TOKEN` e nunca o valor no repositório. Guardar também o ID do número.
9. Implementar o envio com `POST /<PHONE_NUMBER_ID>/messages` e o webhook de status e respostas, registrando a entrega. A Meta avisa que o ID do número na URL será trocado pelo ID da conta até 2028.
10. Ligar o canal `whatsapp` na camada de canais. A trava fica em `lib/convocations/notices.ts`, `CHANNEL_STATUS.whatsapp.enabled`, e na restrição do banco `channel!='whatsapp' OR enabled=0`. Tirar a trava exige uma migração nova e testes com dados sintéticos.

## Riscos e alternativas

- **Parceiro obrigatório:** é o maior risco, porque traz contrato e custo que ficaram não confirmados.
- **Reclassificação:** a Meta pode tratar o modelo como marketing, que custa cerca de 9 vezes mais. Mantenha o texto estritamente informativo.
- **LGPD:** é preciso ter base legal, aviso de privacidade, coletar só o necessário e poder apagar dados. A política do WhatsApp proíbe usar os dados para outro fim.
- **Alternativas:** o sino do portal e o e-mail (MailApp) continuam como canais principais e sem custo por mensagem. O WhatsApp entraria só para quem autorizar.

## Fontes (lidas em 09/11/2026)

- developers.facebook.com/documentation/business-messaging/whatsapp/ (get-started, account-model-evolution, business-phone-numbers/phone-numbers, display-names, templates/overview, templates/template-categorization, templates/supported-languages, messages/send-messages, getting-opt-in, access-tokens, webhooks/overview, messaging-limits, pricing)
- whatsappbusiness.com/policy/ (atualizada em 23/09/2026)
- Tabela oficial de tarifas por país, em PDF, válida desde 01/10/2026
