# Central de IA e políticas de uso · 05/11/2026

Brief: a administração da PROEX precisa cadastrar chaves, escolher quem pode usar, ajustar funções e conferir diagnósticos em um único lugar. Os dados vêm das APIs existentes de credenciais e assistente, com sessão e autorização vivas. Nenhum valor de chave já salvo pode voltar à tela, ao registro ou à planilha.

Pronto quando: o cadastro não remete à Conta; indisponibilidade do ambiente é clara; configuração nominal de TI continua funcionando sem abrir administração global; uso privado é aplicado no servidor em todos os caminhos; não há chamadas externas implícitas; formulários e mensagens funcionam no celular e no computador, nos dois temas. O estado de publicação e as provas finais ficam no registro de entrega do coordenador.

## Onde administrar

[Configurações → Chaves e modelos](https://proex-gestao.vercel.app/?module=settings#ai-credentials) concentra o cadastro de chaves, as funções, a política de uso, os limites e o diagnóstico. A Conta fica dedicada ao perfil e ao acesso. O assistente de operações permanece em Materiais; a importação, a triagem e o áudio continuam nos seus respectivos fluxos operacionais.

1. Escolha a organização. A lista respeita as permissões atuais.
2. A administração geral cadastra ou troca a chave do provedor no cofre. Uma chave salva não ativa função alguma.
3. Escolha “Só eu” ou “Organização”, selecione o provedor de texto (DeepSeek ou OpenAI), habilite as funções desejadas e salve os limites. A troca de provedor desmarca texto e documentos para nova confirmação; não há fallback entre eles. Cada pedido operacional ainda exige seu consentimento/revisão normal.
4. Se desejar conferir autenticação, abra o diagnóstico e autorize a consulta de metadados. O resultado não comprova inferência, qualidade ou transcrição.

As áreas **Chaves**, **Funções e acesso** e **Diagnóstico** mostram um fluxo por vez. Trocar de área não inicia inferência. Os limites avançados ficam recolhidos e a ação de salvar permanece fora deles. Pessoas com concessão nominal de configuração começam em Funções e acesso e não recebem a área de cadastro de chaves.

Se faltar o segredo dedicado do cofre no servidor, os botões de cadastro/troca/remoção não aparecem. A tela explica a preparação técnica necessária em um detalhe recolhível. Não orienta colar chaves em outro módulo. Chaves legadas existentes continuam sujeitas aos ajustes e permissões; não são copiadas ou expostas por essa centralização.

## Permissões diferentes

| Permissão | Quem possui | O que autoriza |
|---|---|---|
| Gerenciar chaves | Administração geral ativa | Cadastrar, trocar, desligar, liberar e remover valores cifrados por organização |
| Configurar IA | Responsável da organização/global ou concessão nominal vigente | Ajustar funções, limites e política de uso; conferir diagnóstico |
| Delegar configuração | Responsável vigente da organização/global | Conceder ou revogar configuração para integrante ativo da mesma organização |
| Usar IA | Política de uso + permissões atuais da atividade/projeto | Pedir a função autorizada, com consentimento, cotas e revisão |

O nome da equipe “TI”, e-mail institucional e acesso a um projeto não concedem administração. Concessões antigas de configuração não viram permissão para cadastrar chaves. Um delegado vê a área de IA em Configurações, sem mestre, backup, canais ou abertura pública.

“Só eu” vincula o uso à conta canônica da pessoa que salva a configuração. “Organização” permite uso somente a integrantes que já tenham a capacidade exigida no contexto. Nenhuma das opções amplia o acesso a dados de outros projetos. A política vale para geração, documentos, triagem, transcrição, recuperação de resultados e aplicação de propostas. É verificada antes da reserva, depois de descriptografar credenciais, antes do transporte e nas barreiras de gravação/devolução. Alterar uma política aumenta a revisão; propostas antigas deixam de valer.

O JSON de configurações antigas sem política mantém o comportamento organizacional anterior. Novas configurações começam privadas e com as funções desligadas. A habilitação explícita continua exigindo chave disponível e os limites aceitos pelo servidor. Não foi necessário acrescentar tabela ou migração para essa política.

## Sheets e rotinas legadas

A planilha mestre, anexos e recuperação permanecem exclusivos da administração geral. Um membro/monitor usa a planilha específica da ficha de seu projeto, com documento e credencial próprios e projeção reduzida. Compartilhar uma aba filtrada da mestre não isola os demais projetos. Consulte [planilhas por projeto](PLANILHAS-POR-PROJETO.md).

A ação “Rotina do ChatGPT/Codex” é legada do ChatGPT Sites. No runtime próprio/Vercel, a API informa que essa rotina não se aplica e a interface a oculta. O backend legado é preservado; a sincronização do Apps Script não depende dessa ação.

## Contrato proposto para outros provedores

OpenAI possui agora um adaptador restrito de texto/documentos, com um único modelo permitido e sem ativação automática; consulte [OpenAI por organização](OPENAI-TEXTO-ORGANIZACAO.md). Anthropic, Gemini, NVIDIA e endpoints personalizados continuam sem campo genérico de chave enquanto não tiverem adaptador exercitado. O futuro cadastro precisa de uma definição tipada revisada, por exemplo:

```ts
type ProviderAdapterDefinition = {
  id: string;
  capabilities: ('text'|'document'|'decision'|'speech'|'vision')[];
  officialOrigins: readonly string[]; // HTTPS, sem redirects ou destino arbitrário
  reviewedModels: readonly string[];
  authentication: 'bearer'|'api-key'; // segredo somente no cofre
  responseContractVersion: string;
  reservation: { units: 'tokens'|'audio-seconds'; minimumUnits: number };
  metadataProbe: boolean;
  requiresHumanReview: true;
};
```

Essa definição é uma proposta, não um adaptador disponível. Cada capacidade exige: documentação oficial atual, autenticação/endpoint/modelo permitidos, parser e limites de resposta, política privada/organizacional, reserva antes do transporte, tratamento de falha sem repetição paga automática, testes de revogação/concorrência/isolamento e avaliação com exemplos sintéticos PROEX. Compatibilidade com formato OpenAI não é prova suficiente. Modelos de imagem e vídeo também precisam de limites e contratos próprios.

Credenciais pessoais independentes por usuário e liberação explícita de `credential.manage` são evoluções distintas da política de uso atual. Não devem ser implementadas por reutilização silenciosa de concessões antigas.

## Verificação desta rodada

Os testes exercitam a seleção de organização, resposta tardia, descarte após fechar, perda de acesso, configuração sem campos de segredo, ausência da administração em Conta e permissão de navegação via concessão viva. Os testes do runtime usam SQLite descartável e provedores simulados para “Só eu”/organização, legado, cotas, revogação e mudanças durante o pedido. Nenhuma chave real, chamada paga, mensagem ou alteração do Google faz parte desses testes.

Na bancada autenticada isolada em `127.0.0.1:5186`, o build Node abriu a central e salvou uma chave Groq sintética, limpando o campo. A política foi salva como organização e depois privada, e relida pela API. Trocar para Groq manteve a transcrição desligada. O diagnóstico permaneceu bloqueado sem consentimento. Nenhum pedido alcançou provedores externos; nenhum erro JavaScript foi observado. Oito capturas cobrem Chaves e Funções/acesso a 390 e 1366 px, temas claro e escuro, sem transbordamento horizontal ou botão visível menor que 44 px. Evidências locais descartáveis: `.sites-runtime/qa-central-ia-final/`, excluídas do Git.

A revisão independente de leitura das capturas estáveis marcou **9,0/10** para essas duas áreas e sua composição, sem P1/P2 visual aberto nesse escopo. Essa nota não se estende ao restante do portal e não substitui a revisão de permissões. Os dois P3 opcionais foram encurtar o nome Groq no seletor móvel e considerar um atalho adicional de salvar no topo se o uso real justificar.

Aprendizado de QA: aguarde as transições depois de alterar a largura. Uma captura a 80 ms pegou o recuo do workspace durante a animação CSS de 200 ms, simulando cobertura pela barra lateral. A recaptura a 450 ms e a geometria confirmaram, a 1366 px, `workspace.x=260`, `main.x=260`, `sidebar.right=260` e `scrollX=0`. Em 390 px a barra lateral estava oculta e o workspace ocupava os 390 px. Verificar apenas transbordamento horizontal não detecta oclusão; confira também a geometria e uma captura do viewport. A barra fixa que aparece no meio de uma imagem full-page precisa ser distinguida de um problema real de navegação.

O ambiente dessa bancada usa segredos sintéticos próprios. Isso não comprova a prontidão de produção. O coordenador constatou a ausência de `PROEX_KEYS_SECRET` em produção; a tentativa de provisionamento foi rejeitada pela revisão automática de autorização antes de executar. Não foi criado caminho alternativo para contornar essa decisão. O estado de produção continua sendo exibido como indisponível para cadastro até a configuração autorizada do ambiente. Publicação, registro na Vault e revisão final integrada ficam com o coordenador.
