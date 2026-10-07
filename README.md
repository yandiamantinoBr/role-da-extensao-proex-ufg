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

O GitHub Pages usa uma entrada estática em pages/, importando **o mesmo** app/page.tsx, estilos e lógica usados no Sites. Não existe uma segunda implementação do jogo. O workflow .github/workflows/pages.yml verifica TypeScript, gera dist-pages e publica automaticamente cada push em main.

Para editar/publicar pelo ChatGPT Sites, preserve .openai/hosting.json e siga o fluxo do plugin Sites. npm run build gera o Worker do Sites; npm run build:pages gera os arquivos estáticos do GitHub Pages.

## Sincronização

A cópia Windows está em C:\Users\yan1n\Documents\ChatGPT\PROEX\Role_da_Extensao. A tarefa **Role da Extensao - sincronizar GitHub** verifica a pasta a cada 2 minutos e ao entrar no Windows, salvando alterações locais em commits e trazendo alterações de main. Ela depende do computador ligado, do usuário conectado, da internet e da autenticação GitHub existente. SINCRONIZAR.cmd permite executar imediatamente; o registro fica em .sync/sync.log.

A tarefa vinculada ao Sites verifica a fonte GitHub a cada hora, aplica mudanças sem perder alterações concorrentes e publica no mesmo Site. GitHub Pages publica em cada push. As instruções completas para o ChatGPT estão em [docs/synchronization.md](docs/synchronization.md).

As configurações de volume, tempo e chances são preferências locais de cada navegador, não alterações no código. Não são compartilhadas entre dispositivos ou entre os dois endereços.

## Identidade e áudio

As marcas PROEX/UFG em public/brand foram obtidas das páginas institucionais da UFG. Os efeitos em lib/game-audio.ts são sintetizados com Web Audio, sem baixar músicas ou vídeos. O áudio começa após uma interação do usuário e respeita silêncio, volume e a visibilidade da página.
