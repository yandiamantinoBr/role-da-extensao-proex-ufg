# Convocações, confirmação de presença e avisos · 09/11/2026

Pedido do Yan (09/11), para ações como o UFG nos Parques: bolsistas e pessoas vinculadas preenchem um único formulário por um link de convidado e têm acesso só àquilo. Os responsáveis veem quem confirmou e quais projetos não responderam, e recebem avisos. O canal de WhatsApp fica preparado.

## Como funciona

1. **Convocação.**
   - Quem gerencia as dinâmicas de um projeto (`campaigns.manage`) cria a convocação em **Convocações → Nova convocação**.
   - Ela leva nome da ação, edição ou local de referência, endereço, data, prazo de resposta, turnos (até 12), projetos convidados (da mesma organização), recado para quem responde, aviso de finalidade (LGPD) e prazo de guarda.
2. **Link de convite.**
   - Em "Links de convite", gera-se um link com validade (2 a 60 dias pela tela; até 120 pela API) e limite de respostas (1 a 2.000).
   - O link aparece **uma vez**, porque o banco guarda só o hash.
   - Encerrar o link não apaga quem já respondeu.
3. **Convidado** (`/convocacao#c=…`):
   - Vê só os dados públicos da ação.
   - Responde nome, matrícula, projeto (da lista de convidados), sim, não ou talvez, e os turnos. Precisa marcar que leu o aviso de uso dos dados.
   - Recebe um **link pessoal** (`/convocacao#g=…`), gerado no próprio navegador com 256 bits e guardado no servidor só como hash. Com ele altera ou apaga a resposta, até de outro aparelho.
   - Esse link não abre o portal: não há conta, sessão nem papel. O convite e o link pessoal ficam no fragmento da URL (depois do `#`), que o navegador não envia ao servidor.
   - Os testes cobrem: não ver outras pessoas, não usar o link de outra pessoa, convite vencido, encerrado ou no limite, e convocação encerrada.
4. **Painel do responsável.**
   - Mostra quem vai, talvez e não vai, por projeto (com o selo "Não respondeu"), por pessoa (com filtro e busca) e por turno.
   - A lista de presença sai em PDF, XLSX ou DOCX.
   - Gestores de um projeto convidado veem só o próprio projeto. Quem lê relatórios do projeto organizador vê tudo, sem editar.
5. **Registros.**
   - Cada ação vai para `convocation_events` (imutável, sem nome nem matrícula) e para `audit`.
   - Registros → Histórico ganhou o tipo **Convocações**.
6. **LGPD.**
   - A coleta é mínima, com aviso de finalidade e prazo de guarda mostrados antes do envio.
   - A pessoa pode apagar a própria resposta.
   - O responsável apaga todos os dados dos convidados em Configurar, sem volta. Fica só o histórico com números.

## Avisos

- **Destinatários:** os responsáveis pela convocação (escolhidos em Configurar; o criador entra por padrão) e os gestores (`manager`) de cada projeto convidado, cada um sobre o próprio projeto.
- **Tipos:**

| Tipo | Quando | Padrão |
|---|---|---|
| Resumo do dia | Uma vez por dia, depois das 8h, se algum projeto não respondeu | Sino e e-mail ligados |
| Lembrete do prazo | Faltando menos de 1 dia (e-mail) ou 2 dias (sino), com projeto sem resposta | Sino e e-mail ligados |
| Cada resposta recebida | A cada confirmação nova | Só no sino |

- **Preferências:** cada pessoa escolhe em **Convocações → (convocação) → Meus avisos**. O WhatsApp aparece como "Em preparação", e o banco recusa ligá-lo.
- **Sino:** a central ganhou a aba **Convocações**, com respostas novas desde a última visita, projetos sem resposta e prazo próximo.
- **E-mail:**
  - Usa o mesmo MailApp dos avisos de demanda: consentimento em Configurações, cotas, intervalo e credencial do conector.
  - A fila própria é `convocation_email_queue`, com ids `cv-…`. O texto não leva nome de convidado, só contagens e o link.
  - **Para começar a enviar, o Yan precisa reinstalar `public/integracoes/proex-notificacoes.gs` na conta Google da organização.** Até lá, o script antigo não pede o tipo `convocation` e nada é enviado. O sino funciona desde já.

## Camada de canais

`lib/convocations/notices.ts` (`CHANNEL_STATUS`):
- `bell`: ligado.
- `email`: ligado, mas depende do consentimento e do script atualizado.
- `whatsapp`: desligado. O passo a passo para ligar está em `docs/WHATSAPP-PREPARACAO.md`.

## Dados e migração

- **Migração `0044_convocations`**, só acréscimos. Tabelas:
  - `convocations`, `convocation_shifts`, `convocation_projects`, `convocation_responsibles`;
  - `convocation_invites` (hash, validade, limite e contagem pelo gatilho);
  - `convocation_guests` e `convocation_guest_shifts`;
  - `convocation_events` (imutável), `convocation_receipts`, `convocation_notification_preferences` e `convocation_email_queue`.
- **Backup:** as tabelas ficam no mesmo SQLite com snapshot no Supabase, então entram no backup completo sem mudança.

## Testes

- `tests/convocations.test.mjs`, 8 cenários:
  - criação e permissão;
  - convite com consentimento, limite, validade e revogação;
  - isolamento do convidado;
  - escopo do painel;
  - sino e recibos;
  - fila de e-mail idempotente;
  - encerramento, apagamento e imutabilidade;
  - edição sem perder turnos ou projetos com respostas.
- `tests/follow-up-bell-state.test.mjs` passou a conhecer a aba nova.
