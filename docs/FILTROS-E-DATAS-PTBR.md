# Filtros compactos e datas brasileiras — 05/11/2026

## Objetivo e critérios

Para quem consulta projetos, agenda, registros, demandas e relatórios no celular ou computador. A pessoa deve filtrar sem espaços vazios e digitar/escolher uma data brasileira sem depender do idioma do navegador. Nenhum novo dado ou permissão de acesso é introduzido.

Pronto quando: os filtros continuam únicos e funcionais; a expansão não cria um bloco vazio; datas aparecem em `dd/mm/aaaa`; o calendário fala português; a API e os rascunhos recebem a data civil ISO; limites, campos obrigatórios, teclado, reset e edição legada continuam válidos.

## Implementação

- `scope-filters.module.css`: projeto na primeira linha, refinamento em uma linha própria e opções expandidas com largura inteira no celular ou duas colunas no computador. Controle nativo `details`, ícones, foco e redução de movimento preservados. Limpar filtros tem rótulo acessível mesmo quando apresenta só o ícone.
- `DateField`: texto brasileiro e calendário DayPicker com locale `ptBR` explícito, abertura em Popover Radix, setas, rótulos de dias, Escape e retorno do foco. Reutiliza dependências já presentes. Aceita também oito dígitos para o teclado numérico do celular.
- O campo visível não tem `name`; um único campo oculto mantém o ISO para `FormData`. `onValueChange` recebe ISO. A validação nativa é atualizada de forma síncrona antes de uma possível submissão no mesmo evento.
- O autosave aceita somente campos ocultos marcados explicitamente como data. Continua excluindo segredos, dados de contato e outros campos ocultos. Restauração e descarte notificam campos controlados e não controlados.
- Substituídos todos os campos `type="date"` existentes: relatórios antigos, agenda, registros, patrimônio, demanda, ficha de projeto e cronograma de projeto. Horários `datetime-local` mantêm seu contrato anterior.

## Evidências

- Suite completa: **956 testes passaram**, zero falhas. O harness de organizações ganhou um adaptador de calendário para continuar testando a API/escopo real sem carregar primitivas DOM no seu ambiente virtual.
- `check:types`: passou. `lint`: zero erros; dois avisos anteriores de imagem em `team-panel.tsx` e `team-person-detail.tsx`.
- `build:node`: passou.
- Testes de parser: datas impossíveis, ano bissexto, limites inclusivos, formato brasileiro e conversões em `America/Sao_Paulo`, `Pacific/Kiritimati` e `America/Los_Angeles`.
- Navegador Chromium sintético, locale **en-US**, fuso de Brasília: digitação/seleção, validação imediata + `requestSubmit`, `FormData` ISO, controle externo, rascunho/restauração/descarte, exclusão de segredos, reset, teclado e retorno do foco passaram.
- Geometria e capturas em **375, 390 e 1366 px**, temas claro e escuro: sem overflow horizontal, calendário dentro da janela, dias com alvo de pelo menos 44 × 44 px e refinamentos sem espaço vazio. Revisão independente do agente coordenador: **9/10 neste recorte**, após corrigir largura móvel e pluralização.

Artefatos locais (ignorados pelo Git): `apps/proex-portal/.sites-runtime/dates-qa/report.json`, `scope-{largura}-{tema}.png`, `calendar-{largura}-{tema}.png`, `check.mjs` e página sintética na mesma pasta. Usam componentes reais e JSX do filtro extraído do portal, sem produção, contas reais ou segredos.

## Aprendizados e limites

1. `lang="pt-BR"` sozinho não força o idioma do calendário nativo do navegador. Uma escolha visual própria deve definir locale e preservar um valor civil canônico independente da apresentação.
2. Não converter uma data civil por `new Date(iso).toLocaleDateString()`: isso pode mover o dia. O editor converte pelos componentes locais e envia ISO, sem inventar horário.
3. Um refinamento alto na mesma linha do projeto faz o grid reservar espaço em branco. Colocar seus campos em uma linha própria resolve a causa e preserva controles nativos.
4. Trocar um input por um componente exige testar `FormData`, reset e autosave, além da aparência. Campos ocultos genéricos continuam fora dos rascunhos.
5. Capturas após alternar tema devem esperar a transição CSS terminar; um quadro intermediário não representa o contraste final.

Esta rodada não fez push/deploy e não comprova comportamento em produção, iOS/Safari ou leitor de tela real. O coordenador integra os commits, repete os gates conjuntos e registra a entrega na Vault.
