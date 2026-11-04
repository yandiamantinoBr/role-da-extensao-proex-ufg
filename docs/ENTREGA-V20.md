# V20 · Início, navegação móvel e Meu trabalho

O Início prioriza o resumo do recorte selecionado. As barras mostram a proporção entre registros existentes, com números e rótulos correspondentes. Os sinais de devolução em atraso, saldo baixo e dinâmica em preparação têm texto e ícone. Os atalhos preservam a personalização local. As colunas respondem à largura disponível e os efeitos respeitam a preferência de movimento reduzido.

A marca PROEX no celular volta ao Início com alvo de 44 px, mantém o recorte de projeto e leva o foco ao conteúdo. A referência visual de navegação foi o [Vozes da Gestão Pública](https://vgp-site.vercel.app/).

Em Meu trabalho, **Baixar para Obsidian (.md)** gera uma cópia local das páginas exibidas. Inclui título, estado, prioridade, prazo quando cadastrado e links protegidos pelo portal. O arquivo omite descrições, responsáveis e destinos restritos. Nenhum diretório da Vault é consultado ou enviado.

## Operação do 23º CONPEEX

No projeto já cadastrado, foram confirmadas nove demandas abertas em produção. Há quatro de preparação e uma para cada lote diário, de 9 a 13/11/2026. A conferência física e os calendários foram atribuídos ao operador que informou que faria a preparação. As entradas e saídas de estoque dependem das quantidades físicas confirmadas. Os lotes diários são acompanhamento operacional. O Drive institucional foi identificado como **Equipe PROEC**. Em Eventos/Programas/Projetos → CONPEEX → 2026, foi criado um Google Sheet nativo para a contagem e os cinco lotes. A conta institucional abriu a planilha e o portal confirmou o vínculo em Links e documentos. A planilha é de trabalho da equipe e fica separada da sincronização canônica.

## Próximos aceites de integração

- Validar o destino institucional Equipe Proex, o papel da conta e a permissão de criar arquivos no local escolhido. O mestre administrativo do Sheets e as cópias de segurança têm audiência própria. Para a equipe, usar um recorte do projeto com os dados necessários. Vincular o Google Doc ou Sheet em Links e documentos.
- Para exportação nativa, separar a autenticação de usuário da autorização por arquivo no Drive. Verificar destino e audiência, releitura, vínculo e duplicatas. Um leitor do Docs consegue ver as tabelas incorporadas mesmo sem acesso à planilha de origem. [Ajuda do Google Docs](https://support.google.com/docs/answer/7009814).
- Para login institucional, vincular a identidade Google verificada a uma conta já autorizada, com controle de papéis e revogação. [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
- A exportação Markdown é uma cópia pontual. Uma integração contínua com Obsidian deve selecionar notas e respeitar a sessão e o escopo de cada pessoa.

## Publicação e verificação

Em 04/11/2026, a PR #21 integrou a V20 em `e4b528cc1374a2c4ecb2f4fcccd1158eaba7d08c`, READY na Vercel. O CI aprovou 874 testes do portal e 33 do jogo. No Chrome de produção, o resumo ficou acima dos atalhos. O download Markdown real incluiu as duas demandas atribuídas do CONPEEX e os links protegidos, sem os corpos. A alteração de viewport não foi aplicada no navegador de produção. O teste de componente confirmou o clique da marca, retorno ao topo e preservação do contexto.
