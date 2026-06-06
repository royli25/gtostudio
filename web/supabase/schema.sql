create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public)
values ('solutions', 'solutions', false)
on conflict (id) do nothing;

create table if not exists public.solution_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  config_hash text not null unique,
  game_type text not null,
  pot_type text not null,
  hero_position text not null,
  villain_position text not null,
  board text[] not null,
  storage_bucket text not null default 'solutions',
  storage_key text not null,
  size_bytes bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.solution_configs enable row level security;

create policy "Users can read own solution metadata"
on public.solution_configs for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own solution metadata"
on public.solution_configs for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own solution metadata"
on public.solution_configs for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can delete own solution metadata"
on public.solution_configs for delete to authenticated
using (auth.uid() = user_id);

-- Solved spot configs for the simulator (no auth required for desktop app)
create table if not exists public.solved_spots (
  id uuid primary key default gen_random_uuid(),
  board text not null,
  oop_range text not null,
  ip_range text not null,
  oop_position text not null,
  ip_position text not null,
  game_type text not null,
  pot_type text not null,
  starting_pot integer not null,
  effective_stack integer not null,
  tree_config jsonb not null default '{}'::jsonb,
  exploitability real,
  iterations integer,
  solve_time_ms integer,
  memory_usage_mb real,
  config_hash text not null unique,
  tree_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.solved_spots enable row level security;

create policy "Allow all access to solved_spots"
on public.solved_spots for all to anon, authenticated
using (true) with check (true);
