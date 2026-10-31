# Entrega V7 — classificação da extensão e organização dos formulários

Registro retrospectivo em 30/10/2026, baseado no commit local `248b503` (`V7: classificação da extensão UFG, unidades, rascunhos, foto e layout`). Este documento registra código entregue; não é um novo comprovante de deploy ou de sincronização da planilha.

## O que consta no commit

- Catálogo de unidades da UFG e classificação da extensão, com formulário de projetos e migração aditiva `0007_v7_ufg_classification.sql`.
- Filtros e apresentação por unidade, área e projeto; ajustes em projetos, equipe, início e agenda.
- Rascunhos nos formulários e ajustes na foto do perfil e no painel de identidade.
- Documentação da extensão na UFG em `apps/proex-portal/docs/EXTENSAO-UFG.md` e atualização do manual e da sincronização.
- Atualização de testes de equipe, autenticação, dados do portal e sincronização.

## Evidência e limites

O conteúdo foi conferido por `git show --stat 248b503`. Os testes alterados no commit não comprovam, por si só, a execução da suíte. Este registro não atribui resultados de testes nem uma data de publicação não presentes nessa evidência. Para uma nova entrega, execute as verificações no README do portal e registre o commit testado.

A hospedagem atual está descrita em [HOSPEDAGEM-VERCEL.md](../apps/proex-portal/docs/HOSPEDAGEM-VERCEL.md). A planilha depende do conector e deve ser conferida no histórico de execuções e conflitos.
