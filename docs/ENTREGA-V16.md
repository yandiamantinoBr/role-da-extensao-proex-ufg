# V16 · assinatura da agenda

Em 31/10/2026, Yan informou que o atalho de assinatura no Google Calendar exibia “Unable to add calendar. Check the URL.”. A URL privada fornecida não integra este repositório ou as provas públicas.

## Mudança

- O botão abre a tela oficial **Do URL**. A interface explica copiar o link privado, colá-lo nessa tela e confirmar **Adicionar agenda**. O botão não promete concluir a assinatura e seu endereço externo não contém o bearer.
- O feed passivo não emite mais `METHOD:PUBLISH`, mantendo correspondência com seu MIME `text/calendar`. Uma agenda sem eventos contém somente um componente de fuso UTC válido; não cria um compromisso fictício.
- A resposta revalida assinatura, conta e autoridade antes de liberar a projeção. Registros associados a empréstimos também exigem autorização atual de leitura de empréstimos. Testes simulam revogação durante a consulta.
- Não há migração, mudança de formato da planilha ou alteração da persistência SQLite/Supabase.

## Evidência e limites

Antes da publicação desta correção, a coordenação usou a assinatura existente pelo fluxo oficial do Google. A conta do usuário mostrou **PROEX · Projetos e eventos** e **Calendar created. Fetching events in the background**; a opção de tornar o calendário público permaneceu desmarcada. Isso comprova criação pelo fluxo oficial. Não demonstra que os defeitos de formato eram a causa da rejeição do atalho anterior, nem garante prazo das próximas atualizações pelo Google.

O download de diagnóstico foi bloqueado pela revisão automática do navegador porque a origem da operação não pôde ser identificada. A operação não foi contornada. A confirmação operacional usa a interface do Google e o valor original da página.

Fonte funcional integrada: `12d5b54` (candidato original `10e9b08`). Testes locais completos Node 24: **838 aprovados, zero falhas**. Tipos, builds Worker/Node e lint passaram; lint mantém três avisos anteriores e nenhum erro. A revisão independente aprovou 21 testes do candidato e 14 probes próprios em Node 24 e 26, sem novo P1/P2 no escopo. Publicação e CI remoto serão registrados após conclusão. Provas de navegador ficam somente no diretório local ignorado.

A consulta real da categoria **Projetos e eventos**, em todos os projetos autorizados, de **31/10/2025 a 31/10/2027**, retornou **zero registros**. A ausência de compromissos dessa assinatura em novembro é compatível com a fonte consultada. Enriquecer datas exige documento oficial ou confirmação responsável; a correção não inventa eventos de teste em produção. A cadência de futuras consultas do Google continua fora do controle do portal.

## Continuidade dos avisos R21

A confirmação específica do usuário para a conta provisória, rotina de dez minutos, credencial restrita de trinta dias e piloto próprio foi recebida. Conta efetiva e conexão privada foram confirmadas em projeto separado. Uma primeira credencial sem cópia confirmada foi revogada antes de sua substituição equivalente; somente uma permanece ativa. Nenhum valor foi registrado neste documento.

O servidor de envio permanece desligado neste checkpoint. Antes do piloto, falta limitar o processamento ao próprio emissor: os limites de volume atuais não garantem o destinatário. O agente de avisos prepara essa proteção e feedback da cópia. Não confundir autorização, conexão, instalação de gatilho, aceitação pelo MailApp e entrega na caixa de entrada.

Referências técnicas: [Google Calendar — assinar de URL](https://support.google.com/calendar/answer/37100), [RFC 5545 §3.6](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.6), [MIME §8.1](https://www.rfc-editor.org/rfc/rfc5545.html#section-8.1). Histórico do candidato em [CALENDARIO-PRIVADO-CONTINUIDADE.md](CALENDARIO-PRIVADO-CONTINUIDADE.md).
