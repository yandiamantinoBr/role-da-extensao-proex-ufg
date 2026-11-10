# Voluntário por ação · 10/11/2026

Pedido do Yan, aprovado em 10/11: ter um voluntário ligado a uma ação, e não ao projeto inteiro. O acesso tem data de fim. Quando vence, cai sozinho e o fim entra em Registros. O Início do voluntário não pode sugerir o que ele não consegue abrir.

## Como funciona para a equipe

1. **Convite.**
   - Em **Pessoas e acessos → Convidar uma pessoa**, a função é **Voluntário de uma ação (com prazo)**.
   - A pessoa que convida escolhe o projeto, a ação (dinâmica) e **Acesso até**. O prazo começa com o fim da ação e pode ir até 120 dias.
   - O link do convite vence junto com o acesso, ou em 7 dias, o que vier antes.
   - Pode convidar quem gerencia o projeto ou a organização, como um operador.
2. **Voluntário.**
   - Ao entrar, vê uma página própria, sem menu:
     - a ação, com projeto, local e datas;
     - "Seu acesso vai até…";
     - o **Atendimento presencial** (tíquetes e resultados, inclusive cancelar);
     - os **Brindes** (fila e código de retirada);
     - a **Conta**.
   - Não vê projetos, outras ações, materiais, agenda, demandas, pessoas nem relatórios.
   - Se a pessoa também faz parte de uma equipe, o Início do portal mostra a ação dela no topo.
3. **Fim do acesso.**
   - No horário marcado, o acesso termina:
     - toda verificação no banco relê o prazo, então até uma sessão já aberta perde o acesso na hora;
     - na primeira requisição seguinte, o portal grava `revoked_at` e o registro `volunteer.expired` (uma vez só).
   - Quem gerencia pode encerrar antes, em **Voluntários por ação → Encerrar agora** (registro `volunteer.revoke`).
4. **Registros.**
   - O Histórico ganhou o tipo **Acessos**, com três eventos:
     - "Voluntário recebeu acesso" (aparece quem convidou);
     - "Acesso de voluntário venceu" (o autor aparece como "Prazo do acesso");
     - "Acesso de voluntário encerrado".
   - Esse tipo é visível para quem gerencia acessos ou as dinâmicas do projeto.

## Desenho de segurança

- **O voluntário não é membro.** Ele fica em `campaign_volunteers`, fora de `members`. As verificações de "faz parte da equipe" (comunidade, agenda, Drive, demandas, assistente etc.) leem `members` e por isso nunca o enxergam. A regra é negar por padrão.
- **Autoridade por ação.**
  - `requireLiveCampaignCapability` e `campaignCapabilityBatch` (`lib/access.ts`) aceitam um membro com a permissão no projeto, ou um voluntário com acesso vigente àquela campanha.
  - Ao voluntário valem só `participation.operate` e `inventory.deliver`.
  - São usadas em `participation.ticket`, `participation.physical`, `prize.redeem` (campanha pela participação) e `participation.cancel`.
- **O banco garante:**
  - o recorte do convite (`invite_campaign_scopes`) só vale para convite de operador do mesmo projeto da ação;
  - o voluntário só nasce desse convite, com a mesma ação, o mesmo prazo e quem convidou;
  - depois de criado, só pode ser encerrado, uma única vez;
  - prazo, ação e pessoa não mudam, e nada se apaga (gatilhos na migração).
- **LGPD:** a anonimização encerra o acesso e apaga o e-mail guardado.

## Também corrigido

- A **Agenda** só aparece no menu para quem lê alguma categoria dela.
- Antes, um operador de evento via "Agenda" no Início e no menu, e a tela respondia "Seu acesso não permite consultar esta agenda".
- O snapshot passou a informar `calendarAvailable`.

## Dados e migração

- **Migração `0046_campaign_volunteers`**, só acréscimos. Tabelas `campaign_volunteers` e `invite_campaign_scopes`, com gatilhos de integridade e imutabilidade.
- **Backup:** sem mudança. As tabelas ficam no mesmo SQLite.

## Testes

`tests/volunteer-access.test.mjs`:
- convite recortado e validado, sem criar vínculo;
- o voluntário opera e vê só a própria ação; outra ação do mesmo projeto ou de outro projeto responde 403;
- o acesso cai no prazo, inclusive numa sessão carregada antes, e o fim entra em Registros uma única vez;
- encerramento antecipado e novo convite;
- o Início do voluntário não tem link, Agenda nem outra ação;
- o operador de evento não recebe Agenda.

## Fora do escopo

- **Voluntário ligado a uma convocação.** O pedido dizia "ação ou convocação"; ficou só a ação. Hoje a convocação não tem uma tarefa para o voluntário fazer no portal. Dar a ele a lista de respostas exporia nomes e matrículas de bolsistas. Se for preciso, dá para ligar depois a convocação à ação.
