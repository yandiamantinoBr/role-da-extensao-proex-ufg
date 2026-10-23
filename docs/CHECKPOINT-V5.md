# Checkpoint de desenvolvimento — V5
n> **Atualização:** este checkpoint foi concluído e ampliado na branch `feat/proex-v6-portabilidade`. Veja `docs/ENTREGA-V6.md`.

Estado: em desenvolvimento, sem publicação desta revisão. A versão operacional continua sendo a V4, fonte Sites `ae50c4eab331f74057c60dd487167af1b9925410`, salva como versão 4. A PR #4 foi incorporada à main no merge `3a1a6697bd123d38d42b9e98f5229409fcceb4dc`, com CI aprovada. A V4 tem sincronização Google Sheets verificada nos dois sentidos: primeira exportação de 118 linhas e, depois, três descrições de buttons importadas com CAS, reexportação de 130 linhas e leitura de retorno de 27 tabelas, sem conflito.

## Pedido de 23/10/2026

- Substituir o filtro genérico “Seu contexto” por unidade e projeto. Evitar seletores duplicados nos módulos que já têm filtros locais.
- Organizar projetos por unidades/órgãos, com tipos, situação, busca e cartões alinhados.
- Separar catálogo de materiais das dinâmicas e kits de brindes; habilitar a apresentação de brindes por projeto, preservando operações existentes e permissões.
- Abrir a planilha de materiais na visualização do projeto. O espelho geral é exclusivo da administração geral; um filtro Google não concede nem restringe acesso. Documentos de um projeto podem ter links próprios, sujeitos às permissões do Drive.
- Reorganizar agenda, filtros e exportação, preservando o escopo real do ICS.
- Corrigir checkboxes/radios esticados pelas regras gerais dos campos. Melhorar o perfil e o detalhe da equipe.
- Acrescentar unidade, vínculo institucional e tipo/número opcional de matrícula/SIAPE. Esses dados privados não entram na planilha, no snapshot amplo ou em logs.

## Contratos preparados

Migração `0005` aditiva: `organizational_units`, `projects.unit_id`, `projects.prizes_enabled`, `profiles.unit_id`, `profiles.affiliation`, `profiles.registration_type` e `profiles.registration_number`. Não há seed na migração ou herança de autoridade por unidade. Unidade usa CRUD da administração geral, versão, recibos e auditoria.

O formato portátil passa a declarar 28 tabelas. Novas colunas de projetos são acrescentadas ao fim. A atualização da planilha exige preservar dados e edições pendentes, acrescentar a aba de unidades e conferir os cabeçalhos e as linhas-base. A rotina deve ser pausada somente durante essa manutenção e retomada após confirmação. Não configurar a planilha adiantada contra o código antigo.

## Como retomar com segurança

1. Leia este checkpoint, `ENTREGA-V4.md`, o manual do portal e o protocolo de sincronização. Confira commits e publicação atuais antes de escrever.
2. A branch contém código em preparação; não presuma que está completo ou que passou pela suíte final. Preserve a roleta livre e os 12 arquivos do baseline `f905f0d`.
3. Abra a fonte do Site pelo workflow oficial, preservando o project_id existente. Ao transportar mudanças deste snapshot, não copie Git, credenciais, arquivos de ambiente, banco local, runtime ou build antigo.
4. Conclua os testes de perfil/equipe, unidades, filtros, autorização, migração e sincronização; execute TypeScript, suíte completa e smoke compilado. Remova fixtures de QA antes de publicar.
5. Publique somente uma revisão verificada. Depois atualize os dados e a planilha pelos conectores autenticados, faça leitura de retorno, retome a rotina e registre a entrega V5 com o estado real.

Nenhum arquivo de credenciais, dado pessoal de produção, termo ou URL privada deve ser acrescentado ao repositório.
