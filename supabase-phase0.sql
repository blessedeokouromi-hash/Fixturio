-- ============================================================
-- Fixturio Phase 0: move user data out of the public GitHub repo
-- Run ONCE in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- Safe to re-run: every statement is guarded.
-- What this creates:
--   community_posts, community_comments, community_chat  (the Community board)
--   votes                (match votes, replaces votes.json)
--   push_subs            (push subscriptions, replaces data/push-subs.json)
--   admin_settings       (ad settings, replaces ads.json commits)
--   rate_limits          (per-IP write throttling, used by every endpoint)
-- Plus three atomic functions: vote_increment, report_bump, rate_limit_hit,
-- and save_admin_settings. Row Level Security is ON everywhere; anonymous
-- visitors may only SELECT the public tables, and all writes go through the
-- server with the service-role key, which bypasses RLS by design.
-- ============================================================

-- 1) Tables
create table if not exists public.community_posts (
  id text primary key,
  uid uuid not null,
  name text not null,
  code text not null,
  games int not null,
  odds numeric not null,
  note text default '',
  bk text default '',
  likes jsonb not null default '[]'::jsonb,
  reports int not null default 0,
  created timestamptz not null default now()
);
create table if not exists public.community_comments (
  id text primary key,
  post_id text not null references public.community_posts(id) on delete cascade,
  uid uuid not null,
  name text not null,
  text text not null,
  reports int not null default 0,
  created timestamptz not null default now()
);
create index if not exists community_comments_post_idx on public.community_comments (post_id);
create table if not exists public.community_chat (
  id text primary key,
  uid uuid not null,
  name text not null,
  text text not null,
  reports int not null default 0,
  created timestamptz not null default now()
);
create table if not exists public.votes (
  day date not null,
  fixture text not null,
  h int not null default 0,
  d int not null default 0,
  a int not null default 0,
  primary key (day, fixture)
);
create table if not exists public.push_subs (
  endpoint text primary key,
  keys jsonb not null,
  ua text default '',
  added timestamptz not null default now()
);
create table if not exists public.admin_settings (
  id int primary key default 1,
  config jsonb not null,
  updated timestamptz not null default now()
);
create table if not exists public.rate_limits (
  key text primary key,
  hits int not null default 0,
  window_start timestamptz not null default now()
);

-- 2) Row Level Security
alter table public.community_posts    enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_chat     enable row level security;
alter table public.votes              enable row level security;
alter table public.push_subs          enable row level security;
alter table public.admin_settings     enable row level security;
alter table public.rate_limits        enable row level security;

-- Public read for the data pages show; no anonymous write access at all.
drop policy if exists "public read posts"    on public.community_posts;
create policy "public read posts"    on public.community_posts    for select using (true);
drop policy if exists "public read comments" on public.community_comments;
create policy "public read comments" on public.community_comments for select using (true);
drop policy if exists "public read chat"     on public.community_chat;
create policy "public read chat"     on public.community_chat     for select using (true);
drop policy if exists "public read votes"    on public.votes;
create policy "public read votes"    on public.votes              for select using (true);
drop policy if exists "public read settings" on public.admin_settings;
create policy "public read settings" on public.admin_settings     for select using (true);
-- push_subs and rate_limits get NO policy: locked to the service role.

-- 3) Atomic write helpers (called by the server with the service-role key)
create or replace function public.vote_increment(p_day date, p_fixture text, p_choice text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.votes(day, fixture, h, d, a)
  values (p_day, p_fixture,
          case when p_choice = 'h' then 1 else 0 end,
          case when p_choice = 'd' then 1 else 0 end,
          case when p_choice = 'a' then 1 else 0 end)
  on conflict (day, fixture) do update
    set h = public.votes.h + case when p_choice = 'h' then 1 else 0 end,
        d = public.votes.d + case when p_choice = 'd' then 1 else 0 end,
        a = public.votes.a + case when p_choice = 'a' then 1 else 0 end;
end $$;

create or replace function public.report_bump(p_table text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_table = 'post' then
    update public.community_posts set reports = reports + 1 where id = p_id;
  elsif p_table = 'comment' then
    update public.community_comments set reports = reports + 1 where id = p_id;
  elsif p_table = 'chat' then
    update public.community_chat set reports = reports + 1 where id = p_id;
  end if;
end $$;

create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_secs int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hits int;
begin
  insert into public.rate_limits(key, hits, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set hits = case
          when public.rate_limits.window_start < now() - make_interval(secs => p_window_secs) then 1
          else public.rate_limits.hits + 1 end,
        window_start = case
          when public.rate_limits.window_start < now() - make_interval(secs => p_window_secs) then now()
          else public.rate_limits.window_start end
  returning hits into v_hits;
  return json_build_object('over', v_hits > p_limit);
end $$;

create or replace function public.save_admin_settings(p_config jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_settings(id, config, updated) values (1, p_config, now())
  on conflict (id) do update set config = excluded.config, updated = now();
end $$;

-- 4) Migrate the data that exists today
-- Votes: the two real vote records from votes.json.
insert into public.votes(day, fixture, h, d, a) values
  ('2026-11-23', '1584467', 1, 0, 0),
  ('2026-11-25', '1635718', 0, 0, 1)
on conflict (day, fixture) do nothing;

-- Community: community.json holds no posts or messages yet, nothing to copy.
-- Push subscriptions: intentionally NOT migrated. Every subscription on file
-- dates from before 2026-11-25 and is signed against the OLD VAPID key pair,
-- so it could not receive a notification. Visitors re-subscribe silently on
-- their next visit where permission was already granted.
-- Ad settings: seed the table with the current ads.json so /api/admin and the
-- static file agree from day one.
insert into public.admin_settings(id, config, updated) values (1, '{"enabled": true, "inFeed": false, "_docs": "Set enabled to true to turn ads on. Each src is the script URL your ad network gives you for that zone. Empty src zones do nothing. vast.url is a VAST tag URL for video pre-roll use.", "banner": {"key": "bbdbf76fe719df33e4d11ce72d6108ae", "w": 728, "h": 90, "invoke": "https://bauval.org/22/bbdbf76fe719df33e4d11ce72d6108ae"}, "native": {"src": "", "_paused": "https://bauval.org/21/6c1722f113186a0ade7349beb143a284", "_paused_reason": "native slot served adult-stream and dating creatives (Nov 26 picks page); restore by moving _paused back into src"}, "socialbar": {"src": "", "_paused": "https://bauval.org/14/1c9515d32e6dfefe5f4a8f2a679dc4ff", "_paused_reason": "paused 2026-11-23: the social bar's fake 'confirm you are not a robot' creative erodes trust; restore by moving _paused into src"}, "popunder": {"src": "", "_paused": "https://abscloud.org/1/d4b9b066ad36a0635a71374587e43b3b", "_paused_reason": "paused 2026-11-26: popunder opened a fake 'App Security Scan' scareware page in the owner's own recording; restore by moving _paused into src"}, "vast": {"url": ""}, "mobileBanner": {"key": "eb9d1e730090dbb09a47c1bd8b6115e4", "w": 320, "h": 50, "invoke": "https://bauval.org/22/eb9d1e730090dbb09a47c1bd8b6115e4"}}'::jsonb, now())
on conflict (id) do nothing;
