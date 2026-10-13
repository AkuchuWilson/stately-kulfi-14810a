-- BrightPath Academy: secure accounts, progress and entitlements
-- Run once in Supabase: SQL Editor > New query > paste > Run.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text, organisation text,
  created_at timestamptz not null default now()
);

create table if not exists public.progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.entitlements (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('programme','plan')),
  key text not null,              -- foundations, floor, fit, pathway, cfs, manager, master, member, enterprise, bpg
  seats int,
  status text not null default 'active' check (status in ('active','canceled')),
  stripe_ref text,                -- subscription id or payment intent id
  source text not null default 'stripe',
  created_at timestamptz not null default now()
);
create index if not exists entitlements_user_idx on public.entitlements(user_id);
create index if not exists entitlements_ref_idx on public.entitlements(stripe_ref);

alter table public.profiles enable row level security;
alter table public.progress enable row level security;
alter table public.entitlements enable row level security;

-- Learners can read and write only their own profile and progress.
create policy "own profile read" on public.profiles for select using (auth.uid() = id);
create policy "own profile write" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
create policy "own progress read" on public.progress for select using (auth.uid() = user_id);
create policy "own progress write" on public.progress for insert with check (auth.uid() = user_id);
create policy "own progress update" on public.progress for update using (auth.uid() = user_id);

-- Learners can only READ their entitlements. Only the server (Stripe webhook) can create them.
create policy "own entitlements read" on public.entitlements for select using (auth.uid() = user_id);

-- To give a BrightPath Global team member full access manually:
-- insert into public.entitlements (user_id, kind, key, source)
-- select id, 'plan', 'bpg', 'manual' from auth.users where email = 'name@example.com';
