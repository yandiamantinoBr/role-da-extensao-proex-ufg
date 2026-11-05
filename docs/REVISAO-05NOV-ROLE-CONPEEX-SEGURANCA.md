# Revisão independente — Rolê no CONPEEX

Parecer de leitura por Claude Code restrito a Read/Glob/Grep. Nenhum teste foi executado pelo revisor; a coordenação completou depois os1.236testes e ensaio de navegador documentados na entrega. SemP0/P1/P2 pendentes. Texto original preservado abaixo, incluindo limites de acesso do revisor e refinamentosP3. Não há avaliação de design neste parecer.

I confirmed all five P2 transfer findings are closed in the current code, and I found no new P0, P1 or P2. I only read code: I didn't run the tests, so the passing counts you gave (17 transfer, 21 planning/export, 1230 full) are taken as reported. The full rerun after your last service fix is still open on your side. Layout is not scored because there are no screenshots.

## The five findings

**T1 (archived source gave a misleading 403): closed.**
- The task query now checks management with `requireActive=false` (`lib/follow-up/transfer.ts:41`). The preview's second read does the same (`:80`).
- `blockerOf` can now reach `inactive_source` (`:49`). The POST returns 409 `followup_transfer_inactive_source` (`:120`).
- Destination candidates still require an active project (`:65`, `:81`, `:121`), and so do the in-transaction checks (`:127-128`) and the 0031 insert trigger (`drizzle/0031_followup_task_transfers.sql:39-41`). So turning off the active check does not open a write path.
- Test `tests/followup-transfer.test.mjs:223-227` expects a preview with `reason:'inactive_source'` and no candidates, a POST 409, and no receipt row.

**T2 (the "people who lose access" count was too low): closed by relabelling, not by widening the count.**
- The server count is still individual assignees only (`transfer.ts:60-63`).
- The panel now says "responsáveis individuais" and adds a fixed warning that team members and the creator also need destination access (`followup-transfer-panel.tsx:123-124`). Nothing grants roles.
- There is no team-member test, which is acceptable since the count wasn't widened.

**T3 (the free-text reason is permanent and visible at the destination): closed as a documented decision.**
- Help text sits next to the field and is linked by `aria-describedby`: "O motivo fica no histórico do destino… evite dados pessoais" (`panel:126-127`).
- The history view renders the reason as escaped React text (`follow-up-panel.tsx:284`), so it can't inject HTML.
- The code comment at `transfer.ts:138` now matches what the code does.

**T4 (simultaneous requests with the same key were untested): closed.**
- Test `followup-transfer.test.mjs:229-232` runs two `Promise.all` moves with the same key. It expects one `duplicate:false` and one `duplicate:true`, both at version 3, exactly one receipt, and none left pending.
- The code path matches: the losing batch fails on `UNIQUE(actor_id,operation_hash)` or on the version check, then `receiptFor` and `replay` return the receipt (`transfer.ts:164`).

**T5 (grant/revoke audit could be filed under the old project): closed.**
- The audit row now takes its `project_id` from `followup_tasks` at transaction time via `INSERT … SELECT t.project_id … FROM followup_tasks t` (`service.ts:140`).
- The grant `INSERT` re-checks the issuer's scope against the task's current project inside the batch (`:138`). If a transfer slipped in and the issuer has no reach at the destination, the insert writes nothing and the `changes()` guard rolls the batch back.
- Test `:240-245` injects a real transfer before the revoke batch and checks the audit row lands in `project-a2`.

**Minor receipt check: closed.** The panel now checks `receipt.projectId===target` and `version===preview.version+1` (`panel:84`), and shows a toast on success (`:88`).

## Remaining items (none block publication)
1. **P3, archived organization:** an archived organization still gets a 403, not `inactive_source`. Both management checks (`authority(...,true,true)` and the extra membership check) require an active organization. That's safe, and the panel is probably hidden anyway because `canDelegateWork` needs write authority. But the `inactive_source` label, which mentions "a organização", can't appear in that case.
2. **P3, destination not in the project list:** `selectProject` still silently ignores a destination that isn't in the portal's project list (`portal-client.tsx:532`, called from `:787`). The toast now confirms the move, so the impact is only that the filter stays on the source.
3. **Product decision, not a defect:** receipts can't be updated or deleted (`0031:53-63`), so there is still no way to redact the reason for privacy erasure. Same for `fromProjectId` in the history, which destination readers can see; it is an id, not personal data.
4. **Trade-offs unchanged:** pending emails are suppressed broadly, and grants to people without destination access stay active.

I couldn't open root files outside `apps/proex-portal` (`AGENTS.md`, `docs/CONPEEX-…`), so nothing was checked against them. I also couldn't write the plan file because no write tool was available.