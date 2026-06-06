-- Solved spot configs: stores what was solved + results metadata.
-- The actual game tree lives in the Tauri solver memory (re-solved from config on demand).
-- No auth required for now — single-user desktop app.

create table if not exists public.solved_spots (
  id uuid primary key default gen_random_uuid(),

  -- Spot identity
  board text not null,                -- e.g. "Qs Jh 2h"
  oop_range text not null,
  ip_range text not null,
  oop_position text not null,         -- e.g. "UTG"
  ip_position text not null,          -- e.g. "BTN"
  game_type text not null,            -- e.g. "6-max"
  pot_type text not null,             -- e.g. "Single raised pot"
  starting_pot integer not null,
  effective_stack integer not null,

  -- Tree config
  tree_config jsonb not null default '{}'::jsonb,  -- bet/raise sizes, thresholds

  -- Solve results
  exploitability real,
  iterations integer,
  solve_time_ms integer,
  memory_usage_mb real,

  -- Dedup key: hash of (board + ranges + positions + tree_config)
  config_hash text not null unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Allow anon access for single-user desktop app (tighten with auth later)
alter table public.solved_spots enable row level security;

create policy "Allow all access to solved_spots"
on public.solved_spots
for all
to anon, authenticated
using (true)
with check (true);
