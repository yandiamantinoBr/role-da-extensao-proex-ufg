-- Armazenamento do portal PROEX no alvo Node/Vercel (platform-node/store.ts).
-- O banco do portal é um SQLite gravado inteiro a cada transação, com controle de
-- versão; anexos ficam em proex.objects. O esquema "proex" não é exposto pela API REST.
create schema if not exists proex;
revoke all on schema proex from public, anon, authenticated;
create table if not exists proex.sqlite_snapshot (
  id smallint primary key check (id = 1),
  version bigint not null check (version > 0),
  data bytea not null,
  updated_at timestamptz not null default now()
);
create table if not exists proex.sqlite_history (
  version bigint primary key,
  data bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists sqlite_history_created_idx on proex.sqlite_history (created_at);
create table if not exists proex.objects (
  key text primary key,
  content_type text not null,
  size integer not null check (size >= 0),
  data bytea not null,
  created_at timestamptz not null default now()
);
alter table proex.sqlite_snapshot enable row level security;
alter table proex.sqlite_history enable row level security;
alter table proex.objects enable row level security;
revoke all on all tables in schema proex from public, anon, authenticated;
