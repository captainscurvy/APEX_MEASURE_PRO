-- =====================================================================================
-- Apex Measure Pro — Supabase schema + Row Level Security
-- UNTESTED against a live project (none exists yet). Run the whole file once in the
-- Supabase SQL editor (Dashboard -> SQL Editor -> New query -> paste -> Run), then read
-- supabase/README.md. Safe to re-run: everything is "create or replace" / "if not exists".
--
-- Trust model
--   * The browser only ever holds the public anon key + the signed-in user's JWT.
--   * Entitlement (plan/status/seats/role) is DERIVED HERE from `subscriptions`, which only the
--     Stripe webhook (service role) can write. The client never decides what a user paid for.
--   * Team rules (roles, seats, invites) are enforced here, in RLS + SECURITY DEFINER functions.
-- =====================================================================================

-- ---------- tables ----------------------------------------------------------------

-- An org = one company. Every user always belongs to exactly one org (a personal one is
-- created at signup). Subscriptions and projects hang off the org.
create table if not exists public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'My company',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- One org per user (unique user_id) keeps entitlement unambiguous.
create table if not exists public.memberships (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','admin','member','viewer')),
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id),
  unique (user_id)
);
create index if not exists memberships_org_idx on public.memberships(org_id);

-- Mirror of Stripe subscriptions. Written ONLY by the stripe-webhook function (service role).
-- org_id is null until a checkout is linked to an org (see the webhook for the linking rules).
create table if not exists public.subscriptions (
  stripe_subscription_id text primary key,
  org_id                 uuid references public.orgs(id) on delete set null,
  stripe_customer_id     text,
  plan                   text not null default 'none' check (plan in ('none','manual','laser','crew')),
  status                 text not null default 'none' check (status in ('none','trialing','active','past_due','canceled')),
  seats                  integer not null default 1 check (seats >= 0),
  current_period_end     timestamptz,
  last_event_created     bigint not null default 0,   -- Stripe event.created of the last applied event (ignore stale/out-of-order)
  updated_at             timestamptz not null default now()
);
create index if not exists subscriptions_org_idx on public.subscriptions(org_id);
create index if not exists subscriptions_customer_idx on public.subscriptions(stripe_customer_id);

-- Webhook idempotency: an event id is processed once.
create table if not exists public.stripe_events (
  id            text primary key,
  processed_at  timestamptz not null default now()
);

-- Jobs. `data` is the whole project JSON (photos live in Storage). Primary key is per-org so two
-- companies can never collide on an id. `updated_at` is the SERVER revision used for optimistic
-- concurrency (the client sends the rev it last saw; see js/backend.js pushProject).
create table if not exists public.projects (
  id          text not null,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  owner_id    uuid default auth.uid() references auth.users(id) on delete set null,
  data        jsonb not null,
  updated_at  timestamptz not null default clock_timestamp(),
  deleted_at  timestamptz,
  primary key (org_id, id),
  check (pg_column_size(data) < 5000000)
);
create index if not exists projects_org_updated_idx on public.projects(org_id, updated_at);

-- Invites are bound to an email address and expire. The code is shown to the inviter to share.
create table if not exists public.invites (
  code         text primary key,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  email        text not null,
  role         text not null check (role in ('admin','member','viewer')),
  invited_by   uuid references auth.users(id) on delete set null,
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists invites_org_idx on public.invites(org_id);

-- ---------- helper functions (SECURITY DEFINER so RLS policies can use them without recursion) ----

-- Is the current user a member of this org?
create or replace function public.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where org_id = p_org and user_id = auth.uid());
$$;

-- Is the current user an owner/admin of this org?
create or replace function public.is_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships
                 where org_id = p_org and user_id = auth.uid() and role in ('owner','admin'));
$$;

-- PRIVATE helpers (underscore): no EXECUTE for clients. They are only called from SECURITY DEFINER
-- functions/policies below, so a user can't probe another org's plan or seat counts.
drop function if exists public.org_has_team(uuid);
drop function if exists public._seats_used(uuid);
drop function if exists public._org_seats(uuid);

-- Is a subscription row "live"? active/trialing always; past_due only for 7 days after the period end
-- (payment grace — then access stops until Stripe collects or the subscription is canceled).
create or replace function public._sub_live(p_status text, p_cpe timestamptz) returns boolean
language sql immutable set search_path = public as $$
  select p_status in ('active','trialing')
      or (p_status = 'past_due' and (p_cpe is null or p_cpe + interval '7 days' > now()));
$$;

-- Does this org currently have a paid Crew (team) plan?
create or replace function public._org_has_team(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subscriptions
                 where org_id = p_org and plan = 'crew' and public._sub_live(status, current_period_end));
$$;

-- May the current user WRITE jobs/photos in this org? owner/admin/member (never viewer) AND team plan.
create or replace function public.can_write(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public._org_has_team(p_org) and exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = auth.uid() and role in ('owner','admin','member'));
$$;

-- Org id from a storage object path "<orgId>/<projectId>/<photoId>"; null if malformed.
create or replace function public.org_of_path(p_name text) returns uuid
language plpgsql immutable set search_path = public as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;

-- Paid seats in use = non-viewer members + pending non-viewer invites (viewers are free).
create or replace function public._seats_used(p_org uuid) returns integer
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.memberships where org_id = p_org and role <> 'viewer')::int
       + (select count(*) from public.invites
          where org_id = p_org and accepted_at is null and expires_at > now() and role <> 'viewer')::int;
$$;

-- Seats bought for the org's team plan (0 if none).
create or replace function public._org_seats(p_org uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select seats from public.subscriptions
                   where org_id = p_org and plan = 'crew' and public._sub_live(status, current_period_end)
                   order by current_period_end desc nulls last limit 1), 0);
$$;

-- ---------- signup trigger: every new user gets a personal org --------------------------------

create or replace function public.ensure_personal_org(p_user uuid, p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.memberships where user_id = p_user;
  if v_org is not null then return v_org; end if;
  insert into public.orgs (name, created_by)
    values (coalesce(nullif(split_part(coalesce(p_email,''), '@', 1), ''), 'My') || '''s company', p_user)
    returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, p_user, 'owner');
  return v_org;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_personal_org(new.id, new.email);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users that signed up before this schema was installed get their personal org now.
select public.ensure_personal_org(u.id, u.email) from auth.users u
  where not exists (select 1 from public.memberships m where m.user_id = u.id);

-- ---------- projects: server owns org/owner/revision ---------------------------------------------

-- Clients may not move a job to another org, change its owner, or set their own revision.
-- Soft delete: when deleted_at is set the job data is wiped to a tombstone ({"id": ...}) so deleted
-- customer data does not linger, and the job's photo rows in Storage are removed.
-- NOTE on photos: deleting rows from storage.objects removes the objects from the API immediately, but
-- Supabase may keep the underlying file bytes in its S3 bucket until its own cleanup runs. If you need
-- guaranteed byte-level purge, also run the Storage API delete from a scheduled Edge Function (see README).
create or replace function public.projects_guard() returns trigger
language plpgsql security definer set search_path = public, storage as $$
declare v_prefix text;
begin
  if tg_op = 'UPDATE' then
    new.id := old.id; new.org_id := old.org_id; new.owner_id := old.owner_id;
  end if;
  new.updated_at := clock_timestamp();   -- the optimistic-concurrency revision
  if new.deleted_at is not null then
    new.data := jsonb_build_object('id', new.id);
    v_prefix := new.org_id::text || '/' || new.id || '/';
    delete from storage.objects where bucket_id = 'photos' and left(name, length(v_prefix)) = v_prefix;
  end if;
  return new;
end $$;
drop trigger if exists projects_guard_trg on public.projects;
create trigger projects_guard_trg before insert or update on public.projects
  for each row execute function public.projects_guard();

-- Consent log: which Terms/Privacy version a user accepted, and when (server-side proof).
create table if not exists public.consents (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  terms_version    text not null,
  privacy_version  text not null,
  accepted_at      timestamptz not null default now(),
  user_agent       text
);
create index if not exists consents_user_idx on public.consents(user_id, accepted_at desc);

-- ---------- Row Level Security ----------------------------------------------------------------

alter table public.orgs          enable row level security;
alter table public.memberships   enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
alter table public.projects      enable row level security;
alter table public.invites       enable row level security;
alter table public.consents      enable row level security;

-- Start from nothing, then grant exactly what's needed. (service_role bypasses RLS by design.)
revoke all on public.orgs, public.memberships, public.subscriptions, public.stripe_events,
              public.projects, public.invites, public.consents from anon, authenticated;
grant select, insert on public.consents to authenticated;
grant select on public.orgs, public.memberships, public.invites to authenticated;
-- subscriptions: column-level grant — the Stripe customer id is NOT readable by any client role
-- (members/viewers must not see billing identifiers); only the service role (webhook) reads it.
grant select (stripe_subscription_id, org_id, plan, status, seats, current_period_end, updated_at)
  on public.subscriptions to authenticated;
grant select, insert, update on public.projects to authenticated;   -- no DELETE: jobs are soft-deleted (deleted_at)
grant update (name) on public.orgs to authenticated;

-- orgs: members can see their org.
drop policy if exists orgs_select on public.orgs;
create policy orgs_select on public.orgs for select to authenticated
  using (public.is_member(id));
-- orgs: owner/admin may rename their org (only the name column is granted above).
drop policy if exists orgs_update on public.orgs;
create policy orgs_update on public.orgs for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));

-- memberships: members can see who else is in their org (roles only; emails come from list_members()).
-- No client INSERT/UPDATE/DELETE: membership changes go through the RPCs below.
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (public.is_member(org_id));

-- subscriptions: readable by org members (so the app can show the plan). NO insert/update/delete
-- policy exists and the privileges are revoked, so ONLY the service role (Stripe webhook) can write.
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (org_id is not null and public.is_member(org_id));

-- stripe_events: no policies at all → invisible to clients; only the service role touches it.

-- projects: every member (including viewers) reads their org's jobs, including soft-deleted
-- tombstones (devices need them to sync deletions).
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (public.is_member(org_id));
-- projects: owner/admin/member may create jobs in their org while the team plan is active.
-- Viewers and expired/non-team orgs are refused. owner_id must be the caller.
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated
  with check (public.can_write(org_id) and owner_id = auth.uid());
-- projects: same rule for edits and soft deletes (the guard trigger pins org_id/owner_id).
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated
  using (public.can_write(org_id)) with check (public.can_write(org_id));

-- consents: a user may read and add only their own consent records (append-only: no update/delete).
drop policy if exists consents_select on public.consents;
create policy consents_select on public.consents for select to authenticated using (user_id = auth.uid());
drop policy if exists consents_insert on public.consents;
create policy consents_insert on public.consents for insert to authenticated with check (user_id = auth.uid());

-- invites: only owners/admins of the org may see pending invites. Creation/acceptance via RPC only.
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select to authenticated
  using (public.is_admin(org_id));

-- ---------- entitlement ---------------------------------------------------------------------------

-- The ONE source of truth the app reads. Derived server-side from membership + subscriptions.
-- Returns { plan, status, currentPeriodEnd, seats, orgId, role } (see js/backend.js getEntitlement).
-- If an org has several subscription rows (old canceled + new active) the best one wins.
create or replace function public.get_entitlement() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m record; s record;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select * into m from public.memberships where user_id = auth.uid();
  if not found then
    return jsonb_build_object('plan','none','status','none','currentPeriodEnd',null,'seats',0,'orgId',null,'role',null);
  end if;
  -- Best live plan wins: crew > laser > manual, then the latest period end. If nothing is live,
  -- report the most recent row (e.g. canceled) so the app can say why.
  select * into s from public.subscriptions
    where org_id = m.org_id
    order by public._sub_live(status, current_period_end) desc,
             (plan = 'crew') desc, (plan = 'laser') desc,
             current_period_end desc nulls last, updated_at desc
    limit 1;
  if not found then
    return jsonb_build_object('plan','none','status','none','currentPeriodEnd',null,'seats',0,'orgId',m.org_id,'role',m.role);
  end if;
  return jsonb_build_object('plan', s.plan, 'status', s.status, 'currentPeriodEnd', s.current_period_end,
                            'seats', s.seats, 'orgId', m.org_id, 'role', m.role);
end $$;

-- ---------- team RPCs (the only way memberships/invites change) --------------------------------------
-- Errors use PostgREST custom codes: PT403 → HTTP 403 (client maps to code "forbidden").

create or replace function public.list_members() returns table (user_id uuid, email text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  -- any member may see the roster of their own org (emails included, from auth.users)
  select m.user_id, u.email::text, m.role, m.created_at
  from public.memberships m join auth.users u on u.id = m.user_id
  where m.org_id = (select org_id from public.memberships where user_id = auth.uid())
  order by (m.role = 'owner') desc, m.created_at;
$$;

create or replace function public.list_invites() returns table (code text, email text, role text, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  select m.org_id into v_org from public.memberships m where m.user_id = auth.uid() and m.role in ('owner','admin');
  if v_org is null then raise exception 'not-admin' using errcode = 'PT403'; end if;
  return query select i.code, i.email, i.role, i.expires_at from public.invites i
    where i.org_id = v_org and i.accepted_at is null and i.expires_at > now() order by i.created_at desc;
end $$;

create or replace function public.create_invite(p_email text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m record; v_code text; v_exp timestamptz := now() + interval '7 days'; v_email text := lower(trim(p_email));
begin
  select * into m from public.memberships where user_id = auth.uid();
  if m.role is null or m.role not in ('owner','admin') then raise exception 'not-admin' using errcode = 'PT403'; end if;
  if p_role not in ('admin','member','viewer') then raise exception 'bad-role' using errcode = 'PT400'; end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'bad-email' using errcode = 'PT400'; end if;
  if p_role = 'admin' and m.role <> 'owner' then raise exception 'owner-only' using errcode = 'PT403'; end if;
  perform 1 from public.orgs where id = m.org_id for update;   -- serialise concurrent invites (seat race)
  if not public._org_has_team(m.org_id) then raise exception 'plan-required' using errcode = 'PT403'; end if;
  -- a re-invite replaces the previous pending one (so it doesn't count twice against seats)
  delete from public.invites where org_id = m.org_id and email = v_email and accepted_at is null;
  if p_role <> 'viewer' and public._seats_used(m.org_id) + 1 > public._org_seats(m.org_id) then
    raise exception 'seat-limit' using errcode = 'PT403';
  end if;
  -- 12 hex chars from a random UUID, shown as XXXX-XXXX-XXXX (48 bits; also bound to the invitee's email)
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  v_code := substr(v_code,1,4) || '-' || substr(v_code,5,4) || '-' || substr(v_code,9,4);
  insert into public.invites (code, org_id, email, role, invited_by, expires_at)
    values (v_code, m.org_id, v_email, p_role, auth.uid(), v_exp);
  return jsonb_build_object('code', v_code, 'expiresAt', v_exp);
end $$;

create or replace function public.revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.invites i
   where i.code = upper(trim(p_code)) and i.accepted_at is null
     and exists (select 1 from public.memberships m where m.org_id = i.org_id and m.user_id = auth.uid() and m.role in ('owner','admin'));
end $$;

-- Accepting: the invite must be unexpired, unused, and addressed to THIS signed-in email.
-- The user leaves their personal org (deleted if empty and subscription-free) and joins the inviting org.
-- Refuses if the user has their own active subscription (they must cancel it first — no silent loss).
create or replace function public.accept_invite(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i record; old_org uuid; v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into i from public.invites
    where code = upper(trim(p_code)) and accepted_at is null and expires_at > now() for update;
  if not found then raise exception 'invalid-invite' using errcode = 'PT403'; end if;
  if lower(i.email) <> v_email then raise exception 'email-mismatch' using errcode = 'PT403'; end if;
  perform 1 from public.orgs where id = i.org_id for update;   -- serialise seat accounting
  select org_id into old_org from public.memberships where user_id = auth.uid();
  if old_org = i.org_id then
    update public.invites set accepted_at = now() where code = i.code;
    return jsonb_build_object('orgId', i.org_id, 'role', (select role from public.memberships where user_id = auth.uid()));
  end if;
  -- an owner who still has teammates must hand over ownership before leaving (no orphaned companies)
  if old_org is not null and exists (select 1 from public.memberships where org_id = old_org and user_id = auth.uid() and role = 'owner')
     and exists (select 1 from public.memberships where org_id = old_org and user_id <> auth.uid()) then
    raise exception 'transfer-ownership-first' using errcode = 'PT403';
  end if;
  if old_org is not null and exists (select 1 from public.subscriptions
        where org_id = old_org and public._sub_live(status, current_period_end)) then
    raise exception 'cancel-plan-first' using errcode = 'PT403';
  end if;
  -- a paid seat must still be free (the plan may have shrunk since the invite was sent)
  if i.role <> 'viewer' and (select count(*) from public.memberships where org_id = i.org_id and role <> 'viewer') + 1
       > public._org_seats(i.org_id) then
    raise exception 'seat-limit' using errcode = 'PT403';
  end if;
  delete from public.memberships where user_id = auth.uid();
  insert into public.memberships (org_id, user_id, role) values (i.org_id, auth.uid(), i.role);
  update public.invites set accepted_at = now() where code = i.code;
  if old_org is not null
     and not exists (select 1 from public.memberships where org_id = old_org)
     and not exists (select 1 from public.subscriptions where org_id = old_org) then
    delete from public.orgs where id = old_org;
  end if;
  return jsonb_build_object('orgId', i.org_id, 'role', i.role);
end $$;

-- Remove a member (or leave: p_user = yourself). The owner can never be removed. Owners remove anyone
-- else; admins remove members/viewers only. The removed person gets a fresh personal org; jobs they
-- created stay with the company.
create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me record; t record; v_email text;
begin
  select * into me from public.memberships where user_id = auth.uid();
  select * into t from public.memberships where user_id = p_user;
  if me.org_id is null or t.org_id is null or me.org_id <> t.org_id then raise exception 'not-on-team' using errcode = 'PT403'; end if;
  if t.role = 'owner' then raise exception 'owner' using errcode = 'PT403'; end if;
  if p_user <> auth.uid() and not (me.role = 'owner' or (me.role = 'admin' and t.role in ('member','viewer'))) then
    raise exception 'not-allowed' using errcode = 'PT403';
  end if;
  delete from public.memberships where user_id = p_user;
  perform public.ensure_personal_org(p_user, (select email from auth.users where id = p_user));
end $$;

-- Change a member's role. Owner: any non-owner → admin/member/viewer. Admin: member<->viewer only.
-- Promoting a viewer to a paid role needs a free seat.
create or replace function public.set_member_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare me record; t record;
begin
  if p_role not in ('admin','member','viewer') then raise exception 'bad-role' using errcode = 'PT400'; end if;
  select * into me from public.memberships where user_id = auth.uid();
  select * into t from public.memberships where user_id = p_user;
  if me.org_id is null or t.org_id is null or me.org_id <> t.org_id then raise exception 'not-on-team' using errcode = 'PT403'; end if;
  if me.role not in ('owner','admin') then raise exception 'not-admin' using errcode = 'PT403'; end if;
  if t.role = 'owner' then raise exception 'owner' using errcode = 'PT403'; end if;
  if me.role = 'admin' and (p_role = 'admin' or t.role = 'admin') then raise exception 'owner-only' using errcode = 'PT403'; end if;
  perform 1 from public.orgs where id = me.org_id for update;   -- serialise concurrent role changes (seat race)
  if t.role = 'viewer' and p_role <> 'viewer' and public._seats_used(me.org_id) + 1 > public._org_seats(me.org_id) then
    raise exception 'seat-limit' using errcode = 'PT403';
  end if;
  update public.memberships set role = p_role where user_id = p_user;
end $$;

-- Record that the signed-in user accepted these document versions (called by the app after sign-in).
create or replace function public.record_consent(p_terms text, p_privacy text) returns void
language plpgsql security definer set search_path = public as $$
declare v_ua text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if coalesce(trim(p_terms),'') = '' or coalesce(trim(p_privacy),'') = '' then raise exception 'bad-version' using errcode = 'PT400'; end if;
  begin
    v_ua := left(current_setting('request.headers', true)::json ->> 'user-agent', 300);
  exception when others then v_ua := null;
  end;
  insert into public.consents (user_id, terms_version, privacy_version, user_agent)
    values (auth.uid(), left(p_terms, 64), left(p_privacy, 64), v_ua);
end $$;

-- Webhook helper (service role only): is this email an owner/admin of the org? Used to honour a
-- checkout's client_reference_id only when the payer really belongs to that org.
create or replace function public.org_admin_has_email(p_org uuid, p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
                 where m.org_id = p_org and m.role in ('owner','admin') and lower(u.email) = lower(p_email));
$$;

-- Used by the Stripe webhook (service role only) to link a subscription to the right org when the
-- checkout carried no client_reference_id: the org whose OWNER has this email.
create or replace function public.org_id_for_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select m.org_id from public.memberships m join auth.users u on u.id = m.user_id
  where lower(u.email) = lower(p_email) and m.role = 'owner' limit 1;
$$;

-- ---------- function privileges ---------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default; lock everything down, then open only what's intended.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.get_entitlement(), public.list_members(), public.list_invites(),
  public.create_invite(text, text), public.revoke_invite(text), public.accept_invite(text),
  public.remove_member(uuid), public.set_member_role(uuid, text), public.record_consent(text, text) to authenticated;
-- RLS helper functions are called from policies as the invoking role, so it needs EXECUTE on them.
grant execute on function public.is_member(uuid), public.is_admin(uuid),
  public.can_write(uuid), public.org_of_path(text) to authenticated;
grant execute on function public.org_id_for_email(text), public.org_admin_has_email(uuid, text), public.ensure_personal_org(uuid, text) to service_role;

-- ---------- Storage: private "photos" bucket ----------------------------------------------------------
-- Object path convention: <orgId>/<projectId>/<photoId>   (see js/backend.js putPhoto/getPhoto)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('photos', 'photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set public = false, file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Read: any member of the org named in the first path segment (viewers included).
drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_member(public.org_of_path(name)));
-- Upload: owner/admin/member of that org while the team plan is active.
drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.can_write(public.org_of_path(name)));
-- Overwrite (x-upsert): same rule.
drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.can_write(public.org_of_path(name)))
  with check (bucket_id = 'photos' and public.can_write(public.org_of_path(name)));
-- Delete: owner/admin only (cleanup tooling); members and viewers cannot delete photos.
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin(public.org_of_path(name)));
