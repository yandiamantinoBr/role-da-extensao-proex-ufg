# Parecer de aceite: programação de dinâmica e transferência de demanda

**Nota: 9/10 para o escopo visível. Pronto para aceite.** Não encontrei P0, P1 nem P2. Sobraram três P3 cosméticos e uma observação de fluxo.

Abri e examinei as 17 capturas pedidas: as 15 telas e as duas páginas do PDF (`programacao-compacta-1/2.png`). Ignorei `programacao-compacta-3.png`. Para esclarecer alguns pontos li só trechos de `campaign-planning-panel.tsx`, `campaign-planning-panel.module.css` e `task-page-summary.module.css`. Não executei nada nem alterei arquivos.

## O antigo P1 está resolvido
- **PDF:** a sessão provisória com horário mostra "Início: 18:00 (sugerido) / Fim: 19:30 (sugerido)". Quando o horário é desconhecido, aparece "A confirmar", sem nenhum horário inventado.
- **Leitura do documento:** a seção "Leitura" diz que as sessões provisórias precisam de confirmação e que o planejamento não comprova entregas nem altera estoque. Isso é coerente com "o PDF não é agenda confirmada".
- **Identificação:** a página 1 mostra dinâmica, projeto responsável e evento anfitrião.
- **Sete campos:** data, ordem, nome, início, fim, situação e observação estão presentes, agrupados em três colunas mais situação. As 15 sessões cabem em 2 páginas A4 com fonte legível.
- **Contadores:** 15 sessões, 15 provisórias, 0 confirmadas e 0 realizadas, iguais aos da interface.

Esta é uma verificação visual do PDF. A parte DOCX/XLSX depende do teste que vocês informaram, não de algo que eu tenha conferido.

## Antigos P2/P3
| Item | Situação |
|---|---|
| Grupos por dia recolhíveis, com contagem e o primeiro aberto | ✅ Visto em 390 e 1366, claro e escuro |
| "Informar horário" em sessão sem horas | ✅ No código (`campaign-planning-panel.tsx:449`) o botão abre o editor em vez de confirmar |
| Campo Situação não esticado | ✅ No editor, o select ocupa só a sua coluna; no cartão da campanha, o select "Ativo" é compacto |
| Diferença entre manter atribuição e manter acesso | ✅ O texto separa "nenhum responsável individual perderá acesso" do aviso sobre equipe/autor. O histórico diz "Atribuições e registros preservados; a visibilidade segue o acesso atual ao destino" |
| Fonte do botão de transferência | ✅ Legível em 1366 escuro. Em 390 o botão fica cortado na captura (veja os limites) |
| Números dos indicadores alinhados | ✅ Os três "0" ficam na mesma linha mesmo quando o rótulo quebra |
| Conflito no celular com menos caixas | ⚠️ Só em parte (P3-1 abaixo) |
| Transferência antes/depois coerente | ✅ Mesma demanda "Conferir calendários QA", prioridade alta e motivo idêntico. O histórico não mostra atores, o que respeita a regra |

## Achados

**P3-1. O conflito no celular ainda mostra seis cartões.** Em `390-light-conflict.png` aparecem cartões para Data, Ordem, Horário e Situação marcados "Igual", além dos dois "Diferente". Na largura de 480px foi retirada só a moldura externa (`.editor` e `.stale` em `campaign-planning-panel.module.css:163-166`). Os cartões de cada campo continuam. Para corrigir, dentro de `@container (max-width: 480px)`:
```css
.compareRow:not([data-changed]) { padding: 4px 0; border: 0; background: transparent; }
.compareRow:not([data-changed]) .compareValues { display: none; }
```
Assim os campos iguais viram uma linha "Data · Igual", e só os diferentes ficam em cartão.

**P3-2. O selo "Igual/Diferente" não fica encostado à direita no desktop.** Em `1366-light-conflict.png` ele aparece por volta de x≈925 em vez de ficar na borda direita. A causa é que `.stale p { max-width: 75ch }` (linha 57) também pega o `<p className={styles.compareField}>`. Correção: `.stale .compareField { max-width: none; }`, ou trocar o seletor da linha 57 para `.stale > p`.

**P3-3. O rótulo "Em andamento" quebra de forma diferente dos vizinhos.** Em `1366-dark-transfer-history.png` o ícone fica numa linha e o texto na de baixo, enquanto "Prazo vencido" e "Concluídas" ficam numa linha só. Os números estão alinhados, então é só aparência. Correção opcional: `.metrics dt { flex-wrap: nowrap; }` com `min-width: 0` no texto, ou um rótulo mais curto.

**Observação de fluxo (não é defeito).** "Informar horário" abre o editor ainda como "Provisória" (`editDraft`, linha 130). Ao salvar, a sessão fica "Sugerido" e precisa de um segundo clique em "Confirmar". Não há confirmação implícita, o que é seguro. Se quiserem deixar isso explícito, uma frase curta no editor resolve, algo como "Depois de salvar, use Confirmar".

**Fora do escopo, só registro.** A faixa do cartão da campanha diz "até 1 repetição(ões) quando sair Tente novamente", em fonte de cerca de 10px, e o texto do botão "Página do evento" é muito pequeno. Isso faz parte do cartão da campanha, não da programação.

## Limites do parecer
- A nota vale apenas para o que aparece nas capturas e nos trechos de código lidos. Não avalia o site como um todo, produção, banco, ACL, a cerca de fingerprint, nem se as atribuições preservadas garantem visibilidade.
- No celular, as capturas cortam os cartões de sessão, as ações deles e o botão final da transferência. Não pude ver a fonte nem o layout desses elementos em 390.
- Os 1.237 testes, os tipos, o lint, o Worker/Node, o smoke autenticado e o teste das três serializações foram executados pela coordenação, não por mim.
