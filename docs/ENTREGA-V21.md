# V21 · Comunicação, prazos e exportação de projetos

Em **Projetos → detalhe → Links e documentos**, as referências de Comunicação separam arte no Canva, publicação no site e publicação no Instagram. Cada entrada pertence a um projeto. Um mesmo design Canva pode ter entradas com notas diferentes de páginas e dimensões. A tela usa o histórico e as permissões de edição existentes. A migração aditiva 0018 preserva os links antigos e as 35 projeções do Sheets.

Em **Demandas**, a distribuição por estado e prioridade mostra o que está na página filtrada. A linha do tempo usa os prazos cadastrados e abre o detalhe autorizado. Tarefas sem data continuam na lista. Uma visualização de Gantt dependerá de início e fim reais. A matriz urgência/importância depende de classificação de importância própria.

O detalhe do projeto oferece **Baixar resumo do projeto** em XLSX, DOCX e PDF, com o mesmo recorte e a mesma permissão da central de relatórios. O servidor precisa devolver uma única linha com o identificador selecionado para o download prosseguir.

O adaptador Groq Whisper V3 Turbo pode ser configurado no servidor para uma organização piloto. A interface identifica o provedor antes do envio e exige novo consentimento quando ele muda. O servidor valida WAV, aplica cotas e impede reenvios da mesma operação entre provedores. A ativação e o teste em uma conta Groq real permanecem pendentes. [Operação do Assistente](../apps/proex-portal/docs/ASSISTENTE-IA.md).

## Fluxo editorial e integrações

- Registrar arte, edição/página, responsável e estágio editorial em contexto de projeto. Para comunicação externa, manter referência da peça, legenda/alt text, canal, público, revisão e recibo. A edição do design e a publicação são ações distintas.
- No piloto de Canva, começar pela conta institucional e por um design ou modelo confirmado. A automação precisa de autorização OAuth de escopo mínimo, seleção da versão e revisão de rascunho. Conferir arquivo/página e destinatários antes de enviar. [Canva Connect](https://www.canva.dev/docs/connect/).
- O assistente deve produzir uma proposta estruturada com origem, alvo, mudanças e destinatários, reaplicar permissões na confirmação e gravar um recibo idempotente. Atualizar planilhas pelo conector e recorte autorizados, com comparação da versão. Mudanças em código seguem branch, diff e checks. Dados e texto de documentos entram como conteúdo, sem conceder instruções ou permissões.
- Avisos de revisão podem usar equipes, consentimento e cotas existentes. Enquetes, envio externo e publicação em Instagram ou CMS dependem de integração e aprovação de canal. Prévia WhatsApp de item privado usa apenas metadados genéricos e link autenticado. [Meta para desenvolvedores](https://developers.facebook.com/docs/).
- Prototipar mídia NVIDIA separadamente. Comparar Groq e Deepgram em áudio pt-BR consentido e avaliar acertos de siglas, tempo, custo e retenção. Configuração de provedores fica no servidor. [Groq Speech to Text](https://console.groq.com/docs/speech-to-text), [NVIDIA Speech AI](https://docs.nvidia.com/nim/speech/latest/).

## Verificação em 04/11/2026

A [PR #22](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/22) integrou `dcac2edfd633e599c538ad8a929b50bc002b39fa`, Vercel READY. CI aprovou 884 testes do portal e 33 do jogo, tipos, builds Worker/Node e smoke de autenticação. Revisão independente de Groq e exportação direta sem bloqueadores. O host canônico respondeu 200 e os hosts históricos isolados 403.

A bancada sintética passou em 375 e 1250 px sem rolagem horizontal. A marca mediu 77 × 44 px e levou de Demandas ao Início, com foco em MAIN e scroll no topo. A linha de prazos exibiu um registro sintético datado. No benchmark local de 25 amostras por recorte, o GET público teve p95 4,64 ms e o painel autenticado teve p95 41,33 ms. O teste em loopback mede o processo local com dados sintéticos.

Em produção, o gráfico do CONPEEX mostrou nove abertas, três de prioridade alta e seis de prioridade média. A referência pública da UFG foi salva como **Publicação no site** e apareceu no histórico como versão 1. O XLSX baixado pelo atalho foi reaberto e contém o CONPEEX, sem linhas de outros projetos. DOCX e PDF passaram nos testes de geração. [Evento oficial da UFG](https://ufg.br/e/39456-23-congresso-de-pesquisa-ensino-e-extensao-conpeex).

Uma busca restrita à conta Canva Proex encontrou a arte candidata do Espaço Extensão. O uso em Comunicação exige um endereço persistente com audiência confirmada. O catálogo é de referências manuais. A exportação direta DOCX/XLSX/PDF já está disponível; a criação nativa recorrente de Google Docs/Sheets e a autorização do Drive ficam em uma integração própria.
