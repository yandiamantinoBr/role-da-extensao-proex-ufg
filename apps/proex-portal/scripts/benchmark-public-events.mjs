// Local-only benchmark: no HTTP server, production URL, credentials or external database.
// Run: npx --yes pnpm@11.25.0 exec node scripts/benchmark-public-events.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import { compile, migrations, root, trafficModules } from '../tests/support/traffic-fixture.mjs';

const requests = 100, syntheticProjects = 1000, baselineRef = 'd7b74f4';
const beforeSource = execFileSync('git', ['show', `${baselineRef}:apps/proex-portal/app/api/events/[id]/route.ts`], { cwd: root, encoding: 'utf8' });
const before = (await trafficModules(beforeSource)).event;
const after = (await trafficModules()).event;
const { SnapshotD1 } = await import(compile('platform-node/d1.ts'));
const temporary = mkdtempSync(join(tmpdir(), 'proex-public-benchmark-'));
const now = '2026-10-30T12:00:00.000Z';

async function sample(route, label) {
  let snapshot = null, commits = 0, transferredBytes = 0;
  const store = {
    async version() { return snapshot?.version ?? 0; },
    async load() { return snapshot ? { version: snapshot.version, data: snapshot.data.slice() } : null; },
    async commit(expected, data) {
      if ((snapshot?.version ?? 0) !== expected) return null;
      snapshot = { version: expected + 1, data: data.slice() }; commits++; transferredBytes += data.byteLength;
      return snapshot.version;
    },
  };
  const db = new SnapshotD1(store, migrations, join(temporary, `${label}.sqlite`), 60_000);
  try {
    const seed = [db.prepare("INSERT INTO projects(id,name,created_at) VALUES('project-fixture','Synthetic project',?)").bind(now)];
    for (let i = 0; i < syntheticProjects; i++) {
      const description = Array.from({ length: 8 }, (_, part) => createHash('sha256').update(`synthetic-project-${i}-${part}`).digest('hex')).join('');
      seed.push(db.prepare('INSERT INTO projects(id,name,description,created_at) VALUES(?,?,?,?)').bind(`benchmark-${i}`, `Synthetic project ${i}`, description, now));
    }
    seed.push(db.prepare("INSERT INTO campaigns(id,project_id,name,starts_at,ends_at,status,created_at) VALUES('event-fixture','project-fixture','Synthetic event',?,?,'active',?)").bind(now, now, now));
    await db.batch(seed);
    globalThis.__proexTraffic = { db, user: null, toolCalls: 0 };
    // One warmup for route/SQLite setup, excluded from counters and timings.
    const warm = await route.GET(new Request('https://portal.example.invalid/api/events/event-fixture'), { params: Promise.resolve({ id: 'event-fixture' }) });
    assert.equal(warm.status, 200); await warm.json();
    commits = 0; transferredBytes = 0;
    const timings = [], start = performance.now();
    for (let i = 0; i < requests; i++) {
      const requestStart = performance.now();
      const response = await route.GET(new Request('https://portal.example.invalid/api/events/event-fixture'), { params: Promise.resolve({ id: 'event-fixture' }) });
      assert.equal(response.status, 200); assert.equal((await response.json()).campaign.id, 'event-fixture');
      timings.push(performance.now() - requestStart);
    }
    const totalMs = performance.now() - start;
    timings.sort((a, b) => a - b);
    const percentile = p => Number(timings[Math.ceil(timings.length * p) - 1].toFixed(3));
    return { snapshotRawBytes: gunzipSync(snapshot.data).byteLength, snapshotCompressedBytes: snapshot.data.byteLength,
      persistedSnapshots: commits, persistedBytes: transferredBytes, totalMs: Number(totalMs.toFixed(3)), p50Ms: percentile(.5), p95Ms: percentile(.95) };
  } finally { db.close(); delete globalThis.__proexTraffic; }
}

try {
  const baseline = await sample(before, 'baseline'), optimized = await sample(after, 'optimized');
  assert.equal(baseline.persistedSnapshots, requests);
  assert.equal(optimized.persistedSnapshots, 0);
  console.log(JSON.stringify({ benchmark: 'public-event-read-snapshot-cost', baselineRef, requests, syntheticProjects,
    transport: 'actual SnapshotD1 + SQLite files + gzip; in-memory remote store, no network',
    limitation: 'Local comparative measurement, not production latency, capacity or a distributed load test.',
    baseline, optimized }, null, 2));
} finally { rmSync(temporary, { recursive: true, force: true }); }
