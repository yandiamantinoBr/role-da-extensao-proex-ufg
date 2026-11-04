# Login institucional Google · desenho e verificação V25

## Situação em 2026-11-04

O portal usa Better Auth 1.7.7 com senha. A sessão só chega ao portal após resolver um alias explícito para o usuário canônico. O convite atual determina o papel e o projeto no banco. O endpoint HTTP de autenticação permite somente operações selecionadas de sessão e senha. Google continua indisponível nesta revisão. [Implementação da sessão](../apps/proex-portal/lib/session.ts) · [Lista de operações HTTP](../apps/proex-portal/app/api/auth/%5B...all%5D/route.ts)

O VGP permite usar o Google do convite e também prevê a criação inicial de administrador por e-mail configurado. O piloto PROEX preserva a separação entre comprovar identidade e receber uma concessão. [Vozes da Gestão Pública](https://vgp-site.vercel.app/)

## Contrato do piloto

- A equipe concede o acesso pelos fluxos atuais. A vinculação começa na conta ativa, após confirmação da senha vigente e comprovação pelo Google do mesmo endereço institucional. Responsáveis legados são elegíveis somente com conta e concessão de equipe vigentes. Convidados externos continuam com o fluxo existente.
- Aceitar somente `email_verified === true`, `hd` igual ao domínio institucional configurado e endereço verificado no mesmo domínio e idêntico ao do cadastro. Vincular pelo `sub` estável. E-mail, domínio, perfil Google e o simples retorno do OAuth nunca criam papel, organização ou permissão.
- Usar uma rota de início com origem fixa e defesa CSRF. O estado de uso único precisa ligar o propósito de vinculação à sessão local que confirmou a senha, com prazo curto, PKCE e verificação de retorno. No callback, confirmar a mesma sessão e verificar criptograficamente assinatura, emissor, audiência e expiração do token. Se o fluxo usar nonce, exigir o valor emitido pelo servidor.
- Gravar o vínculo e o recibo no mesmo lote que confirma a sessão local ainda vigente, a conta ativa, a concessão atual e a exclusividade do identificador. Uma corrida entre contas ou revogação interrompe o vínculo. O recibo contém apenas a ação e a identidade canônica de auditoria.
- Preferir credencial Google separada, com alias exclusivo para o cadastro canônico, sem alias de senha. Essa separação impede que uma revisão anterior interprete sua sessão como sessão por senha. Testar ainda segredo e namespace de cookie separados, revogação seletiva e rejeição de cookies trocados. Desvincular, desabilitar o recurso e anonimizar devem encerrar o acesso Google. A sessão de senha continua utilizável conforme sua política atual.
- Solicitar apenas identidade e e-mail. Evitar persistir access token, refresh token ou ID token. Desativar provisionamento e associação implícita pelo Better Auth, limitar as rotas aos fluxos próprios e responder com mensagens recuperáveis e sanitizadas. O piloto começa com configuração de servidor desligada.
- O aceite direto de um convite pelo Google pode ser avaliado depois. Requer prova adicional de atomicidade entre identidade validada, consumo do convite e concessão de equipe. O convite com senha permanece como entrada inicial no piloto.

## Prova sintética do pacote fixado

Um probe em Node 26 carregou o Better Auth real com armazenamento em memória. O transporte HTTP foi interceptado para os dois endpoints permitidos. Um par RSA efêmero assinou dois tokens, um válido e outro com audiência e emissor incorretos. O probe percorreu a rota de início e o callback com cookies reais do pacote.

1. A autorização padrão emitiu PKCE S256. O callback rejeitou estado incorreto e ausência do cookie.
2. Após um vínculo sintético prévio, o callback Google padrão aceitou o token devolvido pelo endpoint simulado mesmo com audiência e emissor incorretos. A autorização não enviou nonce e o callback padrão não buscou as chaves públicas nesse cenário.
3. A configuração padrão guardou os três tipos de token sintéticos no registro da conta durante o login.
4. O verificador Google exportado pelo próprio pacote rejeitou o token incorreto e aceitou o válido. Usado como fronteira explícita de perfil no callback, impediu a sessão no primeiro caso e permitiu o fluxo sintético no segundo.

A prova simula a resposta do endpoint oficial e compara controles disponíveis. Ela não demonstra interceptação do transporte Google nem uma exposição do Portal PROEX. As rotas Google do portal continuam fechadas. [OpenID Connect do Google](https://developers.google.com/identity/openid-connect/openid-connect) · [Google no Better Auth](https://better-auth.com/docs/authentication/google) · [Usuários e contas no Better Auth](https://better-auth.com/docs/concepts/users-accounts)

## Próximo aceite

O caminho completo ainda precisa de um ensaio com SQLite migrado e a interface real. Cobrir início, callback, origem inválida, estado expirado ou repetido, outro navegador, troca de conta durante o OAuth, senha incorreta, domínio exato, token não verificado, emissor/audiência, colisão de `sub`, concorrência, revogação em cada etapa, logout e rollback. Conferir as mesmas permissões e limites dos projetos com e sem Google, além da ausência de tokens e dados do provedor em banco, logs e exportações. Testar também login por senha e convidados externos.

Provisionamento OAuth, credenciais do domínio, consentimento institucional, validação em Vercel e revisão independente ficam depois das provas locais. Separar o teste sintético de um futuro teste consentido do provedor. Este registro não alterou autenticação, permissões, configurações de ambiente nem recursos externos.
