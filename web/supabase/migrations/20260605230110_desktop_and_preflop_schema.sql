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

drop policy if exists "Public solution metadata is readable"
on public.solution_configs;

drop policy if exists "Users can read own solution metadata"
on public.solution_configs;

drop policy if exists "Users can insert own solution metadata"
on public.solution_configs;

drop policy if exists "Users can update own solution metadata"
on public.solution_configs;

drop policy if exists "Users can delete own solution metadata"
on public.solution_configs;

create policy "Users can read own solution metadata"
on public.solution_configs
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own solution metadata"
on public.solution_configs
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own solution metadata"
on public.solution_configs
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own solution metadata"
on public.solution_configs
for delete
to authenticated
using (auth.uid() = user_id);

create table if not exists public.preflop_libraries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  game_type text not null,
  players integer not null check (players between 2 and 10),
  stack_bb numeric(8, 2) not null check (stack_bb > 0),
  rake text not null default 'none',
  ante text not null default 'none',
  version text not null,
  source_kind text not null check (source_kind in ('seed', 'solver', 'licensed', 'imported')),
  metadata jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.preflop_spots (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.preflop_libraries(id) on delete cascade,
  slug text not null,
  name text not null,
  position text not null,
  facing_action text not null,
  action_sequence text[] not null default '{}'::text[],
  pot_state text not null,
  effective_stack_bb numeric(8, 2) not null check (effective_stack_bb > 0),
  actions text[] not null,
  strategy_json jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (library_id, slug)
);

create index if not exists preflop_spots_library_id_idx
on public.preflop_spots (library_id);

alter table public.preflop_libraries enable row level security;
alter table public.preflop_spots enable row level security;

drop policy if exists "Published preflop libraries are readable"
on public.preflop_libraries;

drop policy if exists "Published preflop spots are readable"
on public.preflop_spots;

create policy "Published preflop libraries are readable"
on public.preflop_libraries
for select
to anon, authenticated
using (published = true);

create policy "Published preflop spots are readable"
on public.preflop_spots
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.preflop_libraries library
    where library.id = preflop_spots.library_id
      and library.published = true
  )
);
