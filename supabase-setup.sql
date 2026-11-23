-- Run this once in your Supabase project: SQL Editor > New query > paste > Run
create table if not exists public.saves (
  user_id uuid primary key references auth.users on delete cascade,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.saves enable row level security;
drop policy if exists "own saves" on public.saves;
create policy "own saves" on public.saves
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
