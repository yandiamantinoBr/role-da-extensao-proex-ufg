import { platformOwnerAuthoritySql, type PortalActor } from '../access';
import { all, one } from '../database';
import { HttpError } from '../errors';
import { onlyKeys } from './contracts';
import { digest, type CredentialKeys } from './crypto';
import type { EffortProbeReceipt, EffortProbeStatus } from './effort-probe-contract';
import { EFFORT_PROBES, effortProbeCost, effortProbeLimits, runEffortProvider, type EffortProbe } from './effort-probe-provider';
import { quotaRefusal } from './quota';
import { assistantUsageSql, loadAssistantSettings, validProviderKey } from './settings';

const ORG = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

type Options = { keys?: CredentialKeys; fetcher?: typeof fetch; signal?: AbortSignal; now?: number };

async function context(db: D1Database, actor: PortalActor | null, org: unknown, secret: string, options: Options) {
  if (!actor) throw new HttpError(401, 'Entre para testar os modelos.', 'unauthenticated');
  const owner = platformOwnerAuthoritySql(actor);
  if (!await one(db, `SELECT 1 WHERE ${owner.sql}`, owner.values)) {
    throw new HttpError(403, 'Somente a administração geral pode testar os níveis.', 'assistant_key_admin');
  }
  if (typeof org !== 'string' || !ORG.test(org)) throw new HttpError(400, 'Escolha uma organização.', 'assistant_organization');
  const settings = await loadAssistantSettings(db, secret, org, 'configuration', options.keys, actor.userId);
  return { org, actor, owner, ...settings, day: dayFormatter.format(new Date(options.now ?? Date.now())) };
}
type ProbeContext = Awaited<ReturnType<typeof context>>;

function authorityGuard(db: D1Database, ctx: ProbeContext) {
  const usage = assistantUsageSql(ctx.actor.userId);
  return db.prepare(`SELECT CASE WHEN (${ctx.owner.sql}) AND EXISTS(
    SELECT 1 FROM ai_organization_settings s JOIN organizations o ON o.id=s.organization_id
    WHERE s.organization_id=? AND s.revision=? AND o.status='active' AND ${usage.sql}
  ) THEN 1 ELSE json_extract('[]','effort_probe_authority') END`)
    .bind(...ctx.owner.values, ctx.org, ctx.revision, ...usage.values);
}

async function batch(db: D1Database, statements: D1PreparedStatement[]) {
  try { return await db.batch(statements); }
  catch (error) {
    if (String(error).includes('effort_probe_authority')) {
      throw new HttpError(409, 'Seu acesso ou a configuração mudou. Abra o diagnóstico novamente.', 'assistant_configuration_changed');
    }
    throw error;
  }
}

function pending(checkedAt: string, reservedCostMicros: number): EffortProbeReceipt {
  return { outcome: 'pending', checkedAt, elapsedMs: null, httpStatus: null, inputTokens: null,
    outputTokens: null, reasoningTokens: null, estimatedCostMicros: null, reservedCostMicros };
}

function storedReceipt(details: string): EffortProbeReceipt {
  const row = JSON.parse(details) as EffortProbeReceipt;
  return {
    outcome: row.outcome, checkedAt: row.checkedAt, elapsedMs: row.elapsedMs, httpStatus: row.httpStatus,
    inputTokens: row.inputTokens, outputTokens: row.outputTokens, reasoningTokens: row.reasoningTokens,
    estimatedCostMicros: row.estimatedCostMicros, reservedCostMicros: row.reservedCostMicros,
  };
}

function attemptId(ctx: ProbeContext, probe: EffortProbe) {
  // Same organization, probe, day and credential revision: at most one paid attempt.
  return digest(`assistant.effort.probe/v1/${ctx.org}/${ctx.day}/${ctx.revision}/${probe.id}`);
}

function attemptRows(db: D1Database, ctx: ProbeContext) {
  return all(db, `SELECT start.created_at, start.details, result.details AS result
    FROM audit start LEFT JOIN audit result ON result.entity_id=start.id AND result.organization_id=start.organization_id
      AND result.action='assistant.effort.result'
    WHERE start.organization_id=? AND start.action='assistant.effort.started'
      AND json_extract(start.details,'$.day')=? AND json_extract(start.details,'$.revision')=?`, [ctx.org, ctx.day, ctx.revision]);
}

export async function effortProbeStatus(db: D1Database, actor: PortalActor | null, org: unknown, secret: string,
  options: Options = {}): Promise<EffortProbeStatus> {
  const ctx = await context(db, actor, org, secret, options);
  const rows = await attemptRows(db, ctx);
  const receipts = new Map<string, EffortProbeReceipt>();
  for (const row of rows) {
    const start = JSON.parse(row.details) as { probeId: string; reservedCostMicros: number };
    receipts.set(start.probeId, row.result ? storedReceipt(row.result)
      : pending(String(row.created_at), start.reservedCostMicros));
  }
  await batch(db, [authorityGuard(db, ctx)]);
  return {
    organizationId: ctx.org, revision: ctx.revision, day: ctx.day,
    probes: EFFORT_PROBES.map(probe => ({
      ...probe, available: validProviderKey(ctx.credentials[probe.provider]),
      ceilingMicros: effortProbeLimits(probe, ctx.config.roleOutputTokenLimit).cost,
      receipt: receipts.get(probe.id) ?? null,
    })),
  };
}

export async function runEffortProbe(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>,
  secret: string, options: Options = {}): Promise<EffortProbeStatus> {
  onlyKeys(input, ['organizationId', 'probeId', 'expectedRevision', 'expectedDay', 'acceptedCostMicros', 'consent']);
  if (input.consent !== true) throw new HttpError(400, 'Confirme a chamada de teste com dados fictícios.', 'assistant_consent');
  const probe = EFFORT_PROBES.find(option => option.id === input.probeId);
  if (!probe) throw new HttpError(400, 'Escolha um nível disponível neste modelo.', 'assistant_effort_probe');
  if (options.signal?.aborted) throw new HttpError(499, 'O teste foi cancelado.', 'assistant_effort_cancelled');

  const ctx = await context(db, actor, input.organizationId, secret, options);
  if (ctx.revision !== input.expectedRevision) {
    throw new HttpError(409, 'A configuração mudou. Atualize o diagnóstico.', 'assistant_configuration_changed');
  }
  if (ctx.day !== input.expectedDay) {
    throw new HttpError(409, 'O dia mudou. Atualize o diagnóstico antes de testar.', 'assistant_effort_day_changed');
  }
  const key = ctx.credentials[probe.provider];
  if (!validProviderKey(key)) throw new HttpError(409, 'Cadastre ou habilite a chave desse provedor no cofre.', 'assistant_credentials');
  const limits = effortProbeLimits(probe, ctx.config.roleOutputTokenLimit);
  if (ctx.config.roleInputTokenCeiling > 0 && limits.input > ctx.config.roleInputTokenCeiling) {
    throw new HttpError(409, 'A reserva do teste não cabe no limite de entrada.', 'assistant_effort_input_limit');
  }
  if (limits.cost !== input.acceptedCostMicros) {
    throw new HttpError(409, 'O custo previsto mudou. Atualize o diagnóstico.', 'role_cost_changed');
  }

  const id = await attemptId(ctx, probe), at = new Date(options.now ?? Date.now()).toISOString();
  const timeoutMs = Math.min(ctx.config.timeoutMs, 20_000);
  const reservedTokens = limits.input + limits.output;
  // Claim and charge together. An existing claim returns its receipt without dispatching again.
  const statements = [
    authorityGuard(db, ctx),
    db.prepare('INSERT INTO ai_organization_usage(organization_id,day) VALUES(?,?) ON CONFLICT(organization_id,day) DO NOTHING')
      .bind(ctx.org, ctx.day),
    db.prepare(`INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at)
      SELECT ?,?,?,'assistant.effort.started',?,?,? FROM ai_organization_usage
      WHERE organization_id=? AND day=? AND reserved_usd_micros+?<=? AND reserved_tokens+?<=?
        AND reserved_ms+?<=? AND calls+1<=? ON CONFLICT(id) DO NOTHING`)
      .bind(id, ctx.actor.userId, ctx.org, id, JSON.stringify({
        probeId: probe.id, day: ctx.day, revision: ctx.revision, reservedCostMicros: limits.cost,
      }), at, ctx.org, ctx.day, limits.cost, ctx.config.dailyUsdMicros, reservedTokens, ctx.config.dailyTokens,
      timeoutMs, ctx.config.dailyMs, ctx.config.dailyCalls),
    db.prepare(`UPDATE ai_organization_usage SET reserved_usd_micros=reserved_usd_micros+?,
      reserved_tokens=reserved_tokens+?,reserved_ms=reserved_ms+?,calls=calls+1
      WHERE organization_id=? AND day=? AND changes()=1`).bind(limits.cost, reservedTokens, timeoutMs, ctx.org, ctx.day),
  ];
  const claimed = await batch(db, statements);
  if (claimed[2].meta.changes !== 1) {
    if (await one(db, "SELECT 1 FROM audit WHERE id=? AND organization_id=? AND action='assistant.effort.started'", [id, ctx.org])) {
      return effortProbeStatus(db, actor, ctx.org, secret, options);
    }
    throw await quotaRefusal(db, ctx.actor, ctx.org, ctx.day, ctx.config, {
      cost: limits.cost, tokens: reservedTokens, ms: timeoutMs, calls: 1,
    });
  }

  await batch(db, [authorityGuard(db, ctx)]);
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const started = Date.now();
  let result: Awaited<ReturnType<typeof runEffortProvider>>;
  try {
    signal.throwIfAborted();
    result = await runEffortProvider(probe, key, limits, signal, options.fetcher);
  } catch {
    result = { outcome: deadline.aborted ? 'timeout' : signal.aborted ? 'cancelled' : 'unavailable',
      httpStatus: null, inputTokens: null, outputTokens: null, reasoningTokens: null };
  }
  const reported = result.inputTokens === null || result.outputTokens === null ? null : {
    tokens: result.inputTokens + result.outputTokens,
    cost: effortProbeCost(probe.provider, result.inputTokens, result.outputTokens),
  };
  const receipt: EffortProbeReceipt = {
    ...result, elapsedMs: Math.max(0, Date.now() - started), checkedAt: new Date(options.now ?? Date.now()).toISOString(),
    estimatedCostMicros: reported?.cost ?? null, reservedCostMicros: limits.cost,
  };
  const details = {
    ...receipt, probeId: probe.id, provider: probe.provider, model: probe.model, level: probe.level,
    usdMicros: receipt.estimatedCostMicros, reservedUsdMicros: receipt.reservedCostMicros,
  };
  await batch(db, [
    authorityGuard(db, ctx),
    db.prepare(`INSERT INTO audit(id,actor_id,organization_id,action,entity_id,details,created_at)
      VALUES(?,?,?,'assistant.effort.result',?,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(`${id}.result`, ctx.actor.userId, ctx.org, id, JSON.stringify(details), receipt.checkedAt),
    db.prepare(`UPDATE ai_organization_usage SET reserved_usd_micros=MAX(0,reserved_usd_micros+?),
      reserved_tokens=MAX(0,reserved_tokens+?),reserved_ms=MAX(0,reserved_ms+?)
      WHERE organization_id=? AND day=? AND changes()=1`)
      .bind(reported ? reported.cost - limits.cost : 0, reported ? reported.tokens - reservedTokens : 0,
        reported ? receipt.elapsedMs! - timeoutMs : 0, ctx.org, ctx.day),
  ]);
  return effortProbeStatus(db, actor, ctx.org, secret, options);
}
