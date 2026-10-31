# Backup completo criptografado e restauração isolada

O alvo principal é o portal Node na Vercel com SQLite em snapshot e objetos privados no Supabase. Este documento descreve geração manual e verificação de recuperação. O [backup diário opcional](BACKUP-AUTOMATICO.md) usa outro envelope criptográfico e depende de configuração e ensaio separados; publicar código não comprova backup de produção.

Em **Configurações → Dados e sincronização → Backup completo criptografado**, uma administração geral ativa pode baixar um arquivo `.proexbackup`. A API exige sessão, mesma origem, cabeçalho de ação e limite de três tentativas em dez minutos. A autoridade é revalidada no snapshot remoto antes da captura e depois da criptografia. Papéis limitados a projetos não podem usar o recurso. A frase de proteção é enviada somente no corpo da requisição HTTPS, sem ser gravada, ecoada ou incluída em auditoria, URLs e logs. Não há senha de produção envolvida.

## Conteúdo e consistência

- Snapshot SQLite completo: tabelas de domínio, identidade, sessões, permissões, auditoria e migrações.
- Todos os objetos privados do armazenamento atual, inclusive objetos sem referência ativa. No disco, objetos legados sem chave reversível preservam seu identificador SHA-256 de armazenamento.
- Manifesto interno com versão do formato, versão do snapshot, revisão pública do código quando disponível, migrações e hashes dos SQL conhecidos, contagens, tipos, tamanhos e SHA-256 do banco e dos objetos. Os hashes dos SQL do checkout normalizam CRLF para LF (`migrationHashMode=utf8-lf`), permitindo conferir a mesma revisão no Windows e no Linux; o banco legado registra nomes aplicados, sem atestar o hash histórico do SQL executado.

No Supabase, snapshot e objetos são lidos na mesma transação `REPEATABLE READ READ ONLY`, com consulta prévia de tamanho e timeout de consultas. A captura pode representar um instante anterior a gravações concorrentes posteriores; nunca combina snapshots de instantes diferentes nessa transação. Referências ativas a arquivos ausentes ou divergentes interrompem a operação. O adaptador local exige um único processo escritor; pare escritores locais antes do comando offline.

Não inclui variáveis externas, credenciais e recursos dos provedores nem a coleção histórica `sqlite_history`. O estado atual completo da aplicação contém seus próprios históricos, auditoria e configurações de IA cifradas no banco; reutilizá-las exige a chave externa original (`BETTER_AUTH_SECRET`) guardada separadamente. Uma mudança de provedor ou organização ainda precisa preparar infraestrutura e variáveis separadamente. A exportação portátil JSON e a planilha Google continuam sendo projeções com outro escopo.

## Criptografia e limites

AES-256-GCM, tag de 16 bytes, nonce aleatório de 12 bytes e salt aleatório de 16 bytes por arquivo. A chave usa scrypt `N=131072`, `r=8`, `p=1`. Cabeçalho e parâmetros são autenticados; a leitura aceita somente o perfil conhecido e não executa parâmetros arbitrários de KDF. Frase de 16 a 256 caracteres, sem quebras de linha, guardada separadamente do arquivo.

Limites desta ferramenta: 64 MiB para snapshot comprimido mais objetos, 64 MiB para SQLite descomprimido, 16 MiB por objeto, 10.000 objetos e 4 MiB para manifesto. Exceder interrompe sem truncamento. A resposta criptografada usa `ReadableStream`, sem `Content-Length`, e o proxy Node usa `pipe`; não devolve um `Buffer` como resposta fixa. A [orientação oficial da Vercel](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions) recomenda streaming para respostas acima de 4,5 MB. O QA local cobre um arquivo sintético acima desse tamanho; isso não comprova o comportamento do edge Vercel nem a capacidade máxima em produção. Os dados claros permanecem em memória durante a geração. Não existe garantia de apagamento forense de strings pelo coletor de memória JavaScript. Não há arquivo temporário claro na geração.

## Conferir sem gravar dados restaurados

Use Node.js 24.16 ou posterior, dependências do repositório e um terminal sem configuração de banco ou hospedagem. A ferramenta não lê `.env` nem `.dev.vars`. A frase é solicitada com entrada oculta; automações podem fornecê-la por stdin, nunca por argumento ou URL. Não coloque a frase em comandos que a imprimam ou no histórico do shell.

```text
node scripts/restore-backup.mjs --input arquivo.proexbackup --dry-run
```

O resultado apresenta somente contagens, versão e conclusão da validação. A frase errada, tag adulterada, parâmetros alterados, hash divergente, banco inválido, falha de chaves estrangeiras ou anexo ativo ausente impedem a conclusão. A validação inteira é feita em memória antes de escrever dados restaurados.

## Restaurar para ensaio isolado

```text
node scripts/restore-backup.mjs --input arquivo.proexbackup
```

O destino é uma pasta nova diretamente na pasta temporária local, com prefixo `proex-isolated-restore-`. `--destination` aceita somente um caminho absoluto novo nesse mesmo local e com esse prefixo; destinos existentes, URLs e caminhos de rede são recusados. O comando também recusa um processo configurado com variáveis de banco ou Vercel. Não há opção de restaurar em produção, conectar banco remoto ou iniciar servidor.

A pasta `data` contém a cópia de disco compatível com o adaptador local. `ISOLATED-RESTORE.json` só recebe `ready=true` depois da releitura dos arquivos gravados; `recovery-report.json` resume a verificação. Uma falha durante gravação pode deixar uma pasta isolada incompleta, que não deve ser usada. A pasta restaurada contém dados privados **descriptografados**, inclusive hashes e sessões; mantenha-a privada e não a publique. Permissões de arquivo são restritas quando suportadas pelo sistema operacional. Um ensaio da aplicação usa somente loopback, segredos locais novos e a revisão de código correspondente. Migrações desconhecidas são indicadas no relatório e exigem a revisão correspondente antes de iniciar a cópia da aplicação.

## Cópia offline de uma instalação em disco

```text
node scripts/create-backup.mjs --local-data pasta-de-dados --output arquivo-novo.proexbackup
```

Esse comando é para quem já tem acesso administrativo aos arquivos locais. Não aceita conexão Supabase, não carrega ambiente e não sobrescreve a saída. Pare escritores locais antes de capturar. A frase é recebida sem eco ou por stdin. Não gera arquivo intermediário descriptografado.

O download não substitui o ensaio de restauração. Registre data, versão, arquivo criptografado guardado fora do provedor, resultado da validação e responsável. A automação externa é opt-in, conforme [instruções próprias](BACKUP-AUTOMATICO.md); retenção continua exigindo política institucional. O workflow Cloudflare legado foi aposentado e falha explicitamente se disparado, sem executar captura.
