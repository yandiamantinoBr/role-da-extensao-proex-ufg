# Modelo de domínio e contratos propostos

Especificação conceitual; não é SQL executado. Ajustar ao ADR de infraestrutura e ao esquema existente. IDs e nomes abaixo são sugestões, sem cadastros reais.

## Entidades

| Grupo | Entidades | Invariantes principais |
| --- | --- | --- |
| Organização | organizations, projects, members, grants, invitations | Escopo explícito; convite não eleva papel; último responsável protegido |
| Campanha | campaigns, rule_versions, eligibility | Regras versionadas; estado controla novas participações |
| Participação | participants, participations, attempts, physical_sessions | Direito único por campanha/identidade; tentativa não é participante |
| Social | social_checks, verification_challenges | Método e horário explícitos; desconhecido não é false; challenge de uso único |
| Catálogo | items, locations, offers, offer_components | Categoria não é SKU; kit tem composição versionada |
| Estoque | stock_movements, stock_reservations, allocations, counts | Físico e reservado separados; saldo não é editado diretamente |
| Prêmio | entitlements, redemptions | Uma entrega por direito; reserva/baixa atômicas e idempotentes |
| Bens | assets, bundles, maintenance_blocks | Uma identidade por bem; compartilhamento não duplica disponibilidade |
| Empréstimos | requests, reservations, loan_lines, checkouts, returns, incidents | Sem sobreposição/capacidade excedida; atraso não libera bem |
| Arquivos | documents, access_events | Objetos privados; autorização em download; sem dado pessoal no path |
| Integração | sync_jobs, import_batches, outbox, audit_events | Reexecução idempotente; origem/revisão; sem apagar histórico |

## Contratos de operação

`startParticipation(campaign, modality, idempotencyKey)` autentica e verifica direito; servidor resolve identidade e regra, sem confiar no user_id/peso enviado pelo cliente. Para digital, retorna registro e resultado persistido. Restrição UNIQUE(campaign_id, participant_identity_id) ou equivalente impede duas participações; as tentativas adicionais pertencem ao mesmo registro conforme regra. IDs de conta e tíquete têm namespaces próprios. Vinculação entre eles exige fluxo confiável.

`getParticipation(id)` recupera estado autorizado; não sorteia. `startPhysicalSession` bloqueia o direito e reserva cobertura de cada categoria premiável possível antes de autorizar o lançamento. Capacidade equivalente deve ser demonstrada sob concorrência, inclusive quando ofertas compartilham componentes. `recordPhysicalResult(session, face, operationKey)` exige operador e bloqueio/cobertura prévios, grava observação, converte a cobertura escolhida em direito e libera as demais; revisão posterior preserva histórico e motivo. Repetição autorizada exige nova cobertura; sessão sem conclusão após possível lançamento vai para reconciliação, sem liberação automática de garantias. Testar duas sessões disputando o último Super Brinde.

`reserveEntitlement(attempt, offerOrQuota)` faz parte da transação que emite prêmio. Algoritmo precisa provar cobertura também quando duas ofertas partilham os mesmos componentes. Se faltar cobertura, não concluir tentativa premiada sem direito nem alterar resultado; bloquear novas emissões antes da campanha ficar inconsistente.

`redeem(entitlementToken, chosenOffer, operationKey)` valida escopo, estado, disponibilidade e política, realiza baixa/reserva correspondente e retorna a entrega já existente em repetição. Token opaco é capacidade sensível, nunca dado de analytics. Cancelar/expirar/estornar exige política e não deve conceder nova chance implicitamente.

`confirmReservation(assetOrQuantity, interval, operationKey)` valida disponibilidade na transação e no banco, não só por SELECT seguido de INSERT sem proteção. Intervalos e estados bloqueantes são explícitos. Para item fungível, considerar máximo simultâneo, não soma do mês. Ativos emprestados atrasados e manutenção afetam disponibilidade física.

`importBatch(source, revision, rows)` valida e oferece prévia; confirmação aplica lote uma vez, sob as mesmas permissões e invariantes da interface. Integrações usam outbox ou mecanismo equivalente quando efeitos externos não participam da transação; não prometer transação distribuída entre banco, Meta e Sheets.

## Aceite transversal

Testes de concorrência para participação, cota, último item e reserva; negação por escopo em API/arquivos; revogação efetiva; recuperação após resposta perdida; separação teste/prod; auditoria sem segredos; filtros/denominadores de métricas; dispositivo compartilhado; retorno de rede; piloto completo com dados fictícios. A arquitetura deve permitir testes de domínio sem reescrever animação/áudio.
