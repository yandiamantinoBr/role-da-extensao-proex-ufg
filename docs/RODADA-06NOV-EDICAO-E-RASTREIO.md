# Edição no contexto, materiais e pessoas · 2026-11-06

## Brief e aceite

Servidores e bolsistas precisam abrir, editar e registrar operações na própria ficha do projeto, especialmente no celular. Os dados vêm das APIs privadas atuais; cada ação continua exigindo sua capacidade específica. Editar projeto não autoriza movimentar estoque, convidar pessoas ou administrar empréstimos.

Pronto quando:

- Ficha oferece ações visíveis de edição e materiais vinculados abrem o diálogo existente; cadastro rápido retorna ao mesmo contexto, com feedback e histórico.
- Demanda e material deixam a edição claramente acessível, mantendo versão, cancelamento, erro, foco e autorização atual.
- Novas movimentações distinguem autor do registro de origem/destino e beneficiário; unidade/projeto e processo SEI entram em contexto imutável auditável. Legado não recebe contraparte inventada.
- Consulta autorizada permite inspecionar consumo por unidade/projeto, sem confundir unidade proprietária com beneficiária; projeção informa sua janela e limitações.
- Pré-perfis privados ficam separados de conta e acesso, com fonte, revisão e histórico. Não enviar convites/avisos ou conceder função pela origem do cadastro.
- Gates, fluxos sintéticos em390/1366 nos dois temas e revisões independentes cobrem o incremento. Produção e sincronização recebem recibos próprios.

## Composição e propriedade

Basee87159d, branch `codex/edicao-e-rastreio-06nov`, worktree isolada. Coordenador: ficha/ações do projeto, integração dos componentes, QA e documentação. Agente edição: demanda/material e CSS. Agente estoque: contexto0032, APIs/lib/testes. Agente pessoas: pré-perfis0033, APIs/lib/componente/testes. Apenas coordenador gera snapshots/journal após composição.

## Invariantes e limites

- Preservar planilha de contagem em uso, IDs, versões e registros anteriores. Não lançar os números de exemplo como estoque real.
- SQLite com snapshots versionados no Supabase continua sendo a arquitetura. Migrações novas são aditivas; ledger anterior não é reescrito.
- Transferência física entre estoques exige débito/crédito atômicos próprios; não simular mudando projeto de um material.
- Unidades descritivas, estrutura institucional, equipes e organizações têm finalidades distintas; nenhuma relação descritiva concede ACL.
- Dados reais, pessoas e IDs Google ficam apenas na Vault privada. Git/QA usam dados sintéticos.
- A mestre mantém35projeções curadas. Tabela nova no banco não significa integração automática com uma planilha de projeto.
- A conta criada com convite controlado não comprova por si só a posse da caixa de e-mail. Pré-perfis não reivindicam contas automaticamente.
- Pendências anteriores (cofre, Calendar, canais Sheets e agenda provisória) continuam no checklist geral; esta rodada não representa conclusão global.

## Checkpoints

- 2026-11-06: auditorias iniciais confirmaram ações passivas nas relações da ficha, edição colapsada e divergência cliente/servidor na capacidade de editar projeto. Estoque só distinguia autor, sem contraparte por movimento. Implementação iniciada, ainda sem publicação.
