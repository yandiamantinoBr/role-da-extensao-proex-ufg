# V10 · Importação, relatórios, acesso e recuperação

Estado em31/10/2026: integração local em `v10-coordenacao`; publicação e verificação em produção ainda pendentes. Autorização de publicação vigente em AGENTS.md.

## Comportamento

- Importação assistida de texto/HTML/CSV/JSON/DOCX/PDF de projetos SIGAA e bens, fonte e proveniência, prévia, comparação e confirmação. PDF usa leitor no navegador; digitalizações sem texto exigem outro fluxo, sem fingir OCR. Cadastro de equipamento inicia sem saldo; entrada física é operação separada.
- Catálogo manual e anexos existentes preservados. Campos complementares de patrimônio e incertezas ficam no registro de conferência; não substitui inventário oficial UFG ou autorização patrimonial.
- Relatórios dos sete assuntos, incluindo saídas institucionais por projeto/material/finalidade/unidade. Conta apenas distribuições efetivas e prêmios resgatados; ajustes, consumos e reservas têm suas áreas. Filtro de período aplicado antes de agregar.
- PDF e Word reais, além de Excel/CSV/JSON/impressão, com mesmo recorte e colunas escolhidas. Documentos com até6colunas usam tabela; acima disso usam registros rotulados para legibilidade. Até2.000linhas/500.000caracteres; PDF até300páginas, erro explícito ao exceder. Não envia dados para serviço externo de conversão; fonte Noto local com licença/proveniência. Quantidades físicas diferentes não são somadas; filtro de unidade e contagem de registros são oferecidos.
- Convites com escopo específico como padrão, ampliação global explícita e conferência atômica de autoridade. Diretório público nunca concede permissão.
- Conector Sheets confere todos os valores e cabeçalhos, preserva concorrência e conflitos, relata sucesso real e distingue portátil de backup completo. ACL global restringida e cópia privada anterior à reconexão preservada; instalação/gatilhos reais continuam pendentes.
- Backup completo SQLite+objetos, captura consistente, manifesto/hash, AES-256-GCM+scrypt, limite sem truncamento; download por streaming e restauração apenas em pasta temporária nova, sem servidor ou conexão de produção. Não inclui segredos dos provedores externos. Guia em `apps/proex-portal/docs/BACKUP-COMPLETO.md`.

## Verificação

- Suíte integrada408/408 Node26.12.1; TypeScript sem erros; ESLint0erros/3avisos antigos. BuildsWorker eNode passaram.
- QA HTTP autenticado e conector simulado passaram: primeira carga, alterações, versão concorrente, conflito, linha inválida, células conferidas e preservação de edição duranteHTTP.
- Backup sintético5.278.357bytes,161chunks, semContent-Length; SQLite745.472bytes e objeto privado maior5MB recuperados isoladamente/hashes conferidos. MáximoRSS cumulativo do processo252.408KiB, incluindo preparação/criptografia. Não mede edgeVercel, capacidade de produção nem recuperação de produção.
- Exportações sintéticas PDF/DOCX com45linhas e9campos: Unicode, últimas linhas e campos conferidos com pypdf/python-docx, renderização Poppler eWordCraftCLI0.13.2. Ajustadas quebras para manter linhas/registros curtos juntos. Reader LibreOffice ausente; MCPWordCraft fechou transporte, CLI existente funcionou. Depois dos ajustes,17/17testes focados passaram. Artefatos reproduzíveis por `node scripts/qa-report-documents.mjs`, ignorados em `.sites-runtime/report-qa`.

## Continuação

Publicar e conferir fluxos novos no navegador375/414/1250px. Gerar/verificar backup real antes da migração0008organizações. Completar reconexão/gatilhos Google, isolamentoR04, IA0009/R10–R13, patrimônio estruturado, delegaçãoTI eSTTupload, público/privacidade/retensão/backup externo recorrente. Veja `REQUISITOS-E-CONTINUIDADE.md` e `ANDAMENTO.md`: incremento não fecha automaticamente todos os requisitos.
