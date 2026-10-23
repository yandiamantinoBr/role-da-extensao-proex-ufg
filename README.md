# Rolê da Extensão · PROEX UFG 😎

Roleta e Super Dado com a mesma dinâmica: **3 faces de Brinde, 1 Tente novamente, 1 Não foi dessa vez e 1 Super Brinde**. O sorteio usa a aleatoriedade segura do navegador.

- Roleta e dado com animações completas e duração configurável.
- Sons originais produzidos no navegador, sincronizados com os movimentos; controle de volume e silêncio.
- Chuva de confetes para Brinde e Super Brinde, controlada pela opção do usuário.
- Chances iguais por padrão e pesos personalizados opcionais, com percentuais visíveis.
- Tela cheia, teclado (espaço), celular e configurações salvas por aparelho.

## Abrir

- **GitHub Pages:** https://yandiamantinobr.github.io/role-da-extensao-proex-ufg/
- **ChatGPT Sites:** https://role-da-extensao-ufg.yandiamantinobr.chatgpt.site/
- **Código:** https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg

No Windows, dê dois cliques em **INICIAR_SITE.cmd**. Ele instala as dependências na primeira execução e abre a versão local no navegador. Requer Node.js 22.13 ou superior; o servidor fica aberto enquanto a janela do terminal estiver aberta. A aplicação deve ser servida por HTTP, pois o sorteio seguro e os módulos JavaScript não funcionam corretamente abrindo o HTML por file://.

## Desenvolvimento

```sh
npx --yes pnpm@11.25.0 install --frozen-lockfile
npm run dev:pages
npm run build:pages
```

O GitHub Pages usa uma entrada estática em github-pages/, importando **o mesmo** app/page.tsx, estilos e lógica usados no Sites. Não existe uma segunda implementação do jogo. O workflow .github/workflows/pages.yml verifica TypeScript, gera dist-pages e publica automaticamente cada push em main.

## Evolução administrativa da PROEX

A evolução está documentada em [docs/proex-evolucao](docs/proex-evolucao/README.md). O portal em [apps/proex-portal](apps/proex-portal/README.md) tem autenticação, banco, arquivos privados e implantação próprios. O jogo livre permanece independente e ilimitado. A V3 tem publicação registrada; a **V4 foi publicada com sucesso**, versão 4, fonte Sites `ae50c4eab331f74057c60dd487167af1b9925410`. Pré-cadastro e sincronização inicial Drive/Sheets foram concluídos em produção; a rotina periódica está ativa, sem atualização instantânea. Consulte [ENTREGA-V4.md](docs/ENTREGA-V4.md) e a [ADR 0004](docs/proex-evolucao/ADRS/0004-monorepo-catalogo-e-integracao-v4.md).

O monorepo preserva um único histórico público: raiz/Pages para o jogo, `apps/proex-portal` para a gestão. Execute os comandos a partir da aplicação correta; publicar uma não publica a outra. A branch `feat/proex-v4` parte de main observado em `ff27166`, após as PRs #1, #2 e #3. O núcleo anterior de permissões continua independente; o portal operacional tem seus próprios serviços e verificações.

Para verificar a branch com Node.js 24 e as dependências do lockfile:

```sh
npm run check:legacy
npm run check:types
npm test
npm run build:pages
```

`check:legacy` compara 12 arquivos centrais e de identidade com a referência registrada; mudanças intencionais no jogo exigem revisão e atualização explícita desse baseline. O workflow de verificação de PRs executa esses checks sem publicar. O estado, as limitações e o próximo passo estão em [ESTADO_ATUAL.md](docs/proex-evolucao/ESTADO_ATUAL.md).

Para editar/publicar pelo ChatGPT Sites, preserve .openai/hosting.json e siga o fluxo do plugin Sites. npm run build gera o Worker do Sites; npm run build:pages gera os arquivos estáticos do GitHub Pages.

## Sincronização

Os procedimentos anteriores de cópia Windows/GitHub/Sites estão em [docs/synchronization.md](docs/synchronization.md) e permanecem históricos. Sua documentação não comprova tarefas ativas, e esta evolução não as reativa. GitHub Pages mantém seu fluxo próprio de publicação; a gestão PROEX possui outro deploy.

A V4 oferece integração portátil com Drive/Sheets, recibos e conflitos. A execução inicial real concluiu em 23/10/2026 às 14:14:59 UTC: 118 linhas exportadas e leitura de retorno das 27 tabelas verificada, zero alterações importadas e zero conflitos. A rotina periódica está ativa; não é sincronização instantânea. Não havia edições externas pendentes, portanto não se afirma um round-trip de alteração no Sheets. URLs privadas, credenciais e dados operacionais não pertencem ao repositório.

As configurações de volume, tempo e chances são preferências locais de cada navegador, não alterações no código. Não são compartilhadas entre dispositivos ou entre os dois endereços.

## Identidade e áudio

As marcas PROEX/UFG em public/brand foram obtidas das páginas institucionais da UFG. Os efeitos em lib/game-audio.ts são sintetizados com Web Audio, sem baixar músicas ou vídeos. O áudio começa após uma interação do usuário e respeita silêncio, volume e a visibilidade da página.
