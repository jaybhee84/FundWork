-- FundWork · COA Submissions: shared database for the Supabase project.
-- Run once: Supabase dashboard → SQL Editor → paste this whole file → Run.
-- (Or with the Supabase CLI: supabase db push.)
--
-- What it creates
--   Reference data   units, report_types, settings
--   People           members (who has access, role, offices), access_requests (registrations)
--   Submissions      submissions, submission_files, activity_log, reminder_log
--   Storage          private bucket "coa-files" (50 MB per file)
--   Security         Row Level Security on every table; all changes go through the functions below,
--                    which enforce the same rules as the app (coa/demo-source.js).
--
-- Roles: superadmin (accounts only), accountant (Division Accountant), uploader (Senior Bookkeeper), coa.
-- Passwords, email confirmation and password resets are handled by Supabase Auth, not by these tables.

-- =====================================================================
-- 1. Tables
-- =====================================================================

create table public.units (
  code text primary key,
  name text not null,
  sort int not null
);

create table public.report_types (
  code text primary key,
  sort int not null,
  frequency text not null check (frequency in ('MONTHLY','QUARTERLY','SEMIANNUAL','ANNUAL')),
  category text not null,
  due_rule text not null,
  name text not null,
  description text not null default '',
  periods text[],                       -- e.g. {S1}: only these periods are expected
  applies_to text[] not null,           -- offices that submit this report
  active boolean not null default true
);

create table public.settings (
  id boolean primary key default true check (id),   -- single row
  tracking_start date not null,
  reminder_days int not null default 10 check (reminder_days between 0 and 60),
  horizon_days int not null default 45 check (horizon_days between 1 and 400),
  ai_preaudit boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.members (
  email text primary key check (email = lower(email)),
  user_id uuid unique references auth.users(id) on delete set null,  -- null until the person signs up
  name text not null,
  role text not null check (role in ('superadmin','accountant','uploader','coa')),
  offices text[] not null default '{}',
  base text check (base in ('IU','SDO','COA')),
  unit_code text references public.units(code),
  position text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null check (email = lower(email)),
  name text not null,
  base text not null check (base in ('IU','SDO','COA')),
  unit_code text references public.units(code),
  position text not null,
  role text not null check (role in ('accountant','uploader','coa')),
  offices text[] not null,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  note text,
  requested_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz
);
create unique index access_requests_one_pending on public.access_requests (email) where status = 'pending';

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  report_code text not null references public.report_types(code),
  unit_code text not null references public.units(code),
  period_key text not null,
  period_label text not null,
  due_date date not null,                -- snapshot taken when the row is created
  status text not null default 'missing' check (status in ('missing','for_review','returned','approved','not_applicable')),
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (report_code, unit_code, period_key)
);

create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id),
  storage_path text not null unique,     -- object name in the coa-files bucket
  name text not null,
  size bigint not null check (size > 0 and size <= 52428800),
  content_type text,
  sha256 text,
  precheck jsonb,                        -- rule-based pre-check results from the app
  uploaded_by text not null,
  uploaded_by_name text not null,
  uploaded_at timestamptz not null default now(),
  superseded_at timestamptz,             -- files are never deleted, only superseded
  superseded_by text,
  supersede_reason text
);
create index submission_files_submission on public.submission_files (submission_id);
create index submission_files_sha on public.submission_files (sha256);

create table public.activity_log (
  id bigint generated always as identity primary key,
  item_key text,                         -- REPORT|UNIT|PERIOD, null for account changes
  submission_id uuid references public.submissions(id),
  action text not null,
  details jsonb not null default '{}',
  actor_email text,
  actor_name text,
  at timestamptz not null default now()
);
create index activity_log_item on public.activity_log (item_key, at desc);

create table public.reminder_log (       -- written by the daily-reminders Edge Function (service role)
  sent_on date not null,
  email text not null,
  item_count int not null,
  primary key (sent_on, email)
);

-- =====================================================================
-- 2. Helpers
-- =====================================================================

-- The signed-in person's active membership role, or null.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid() and active
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('accountant','superadmin'), false)
$$;

create or replace function public.can_upload(p_unit text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m
                 where m.user_id = auth.uid() and m.active
                   and (m.role = 'accountant' or (m.role = 'uploader' and p_unit = any (m.offices))))
$$;

-- Period from its key: 2026-09, 2026-Q3, 2026-S1, 2026. Mirrors periodFromKey in coa/schedule.js.
create or replace function public.coa_period(p_key text, out frequency text, out start_date date, out end_date date, out label text)
language plpgsql immutable as $$
declare
  months text[] := array['January','February','March','April','May','June','July','August','September','October','November','December'];
  y int; n int;
begin
  if p_key ~ '^\d{4}-\d{2}$' then
    y := left(p_key, 4)::int; n := right(p_key, 2)::int;
    if n < 1 or n > 12 then raise exception 'Unrecognized period key: %', p_key; end if;
    frequency := 'MONTHLY'; start_date := make_date(y, n, 1);
    end_date := (start_date + interval '1 month' - interval '1 day')::date;
    label := months[n] || ' ' || y;
  elsif p_key ~ '^\d{4}-Q[1-4]$' then
    y := left(p_key, 4)::int; n := right(p_key, 1)::int;
    frequency := 'QUARTERLY'; start_date := make_date(y, (n - 1) * 3 + 1, 1);
    end_date := (start_date + interval '3 months' - interval '1 day')::date;
    label := 'Q' || n || ' ' || y || ' (' || left(months[(n - 1) * 3 + 1], 3) || '–' || left(months[(n - 1) * 3 + 3], 3) || ')';
  elsif p_key ~ '^\d{4}-S[12]$' then
    y := left(p_key, 4)::int; n := right(p_key, 1)::int;
    frequency := 'SEMIANNUAL';
    start_date := case n when 1 then make_date(y, 1, 1) else make_date(y, 7, 1) end;
    end_date := case n when 1 then make_date(y, 6, 30) else make_date(y, 12, 31) end;
    label := case n when 1 then '1st' else '2nd' end || ' Semester ' || y;
  elsif p_key ~ '^\d{4}$' then
    y := p_key::int; frequency := 'ANNUAL';
    start_date := make_date(y, 1, 1); end_date := make_date(y, 12, 31); label := 'CY ' || y;
  else
    raise exception 'Unrecognized period key: %', p_key;
  end if;
end $$;

-- Due date from a rule. Mirrors computeDueDate in coa/schedule.js.
create or replace function public.coa_due_date(p_rule text, p_end date) returns date
language plpgsql immutable as $$
declare
  kind text := split_part(p_rule, ':', 1);
  arg text := split_part(p_rule, ':', 2);
  first_of date; candidate date; best date; md text; yr int;
begin
  if kind = 'NEXT_MONTH_DAY' then
    first_of := (date_trunc('month', p_end) + interval '1 month')::date;
    return first_of + (least(arg::int, extract(day from first_of + interval '1 month' - interval '1 day')::int) - 1);
  elsif kind = 'DAYS_AFTER' then
    return p_end + arg::int;
  elsif kind = 'NEXT_DATE' then
    foreach md in array string_to_array(arg, '|') loop
      for yr in extract(year from p_end)::int .. extract(year from p_end)::int + 1 loop
        first_of := make_date(yr, split_part(md, '-', 1)::int, 1);
        candidate := first_of + (least(split_part(md, '-', 2)::int, extract(day from first_of + interval '1 month' - interval '1 day')::int) - 1);
        if candidate > p_end and (best is null or candidate < best) then best := candidate; end if;
      end loop;
    end loop;
    return best;
  end if;
  raise exception 'Unrecognized due rule: %', p_rule;
end $$;

-- Validates that an office submits a report for a period; returns the label and due date.
create or replace function public.coa_slot(p_report text, p_unit text, p_period text, out period_label text, out due_date date)
language plpgsql stable security definer set search_path = public as $$
declare r public.report_types; p record; suffix text;
begin
  select * into r from public.report_types where code = p_report and active;
  if not found then raise exception 'Unknown report: %', p_report; end if;
  if not exists (select 1 from public.units where code = p_unit) or not (p_unit = any (r.applies_to)) then
    raise exception '% does not submit %', p_unit, p_report;
  end if;
  select * into p from public.coa_period(p_period);
  if p.frequency <> r.frequency then raise exception '% is a % report; % is not a matching period', p_report, lower(r.frequency), p_period; end if;
  suffix := case when position('-' in p_period) > 0 then split_part(p_period, '-', 2) else p_period end;
  if coalesce(cardinality(r.periods), 0) > 0 and not (suffix = any (r.periods)) then
    raise exception '% is not expected for %', p_report, p.label;
  end if;
  period_label := p.label;
  due_date := public.coa_due_date(r.due_rule, p.end_date);
end $$;

-- Appends to the activity log as the signed-in person. Internal: not callable from the app.
create or replace function public.coa_log(p_key text, p_submission uuid, p_action text, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.activity_log (item_key, submission_id, action, details, actor_email, actor_name)
  select p_key, p_submission, p_action, coalesce(p_details, '{}'::jsonb), m.email, m.name
  from public.members m where m.user_id = auth.uid()
$$;

create or replace function public.coa_me() returns public.members
language plpgsql stable security definer set search_path = public as $$
declare m public.members;
begin
  select * into m from public.members where user_id = auth.uid();
  if not found then raise exception 'Your account is waiting for approval or has no access'; end if;
  if not m.active then raise exception 'Your access has been turned off. Contact the Division Accountant.'; end if;
  return m;
end $$;

-- =====================================================================
-- 3. Submission actions (called with supabase.rpc)
-- =====================================================================

-- Register files already uploaded to storage under {unit}/{period}/{report}/... and send for review.
create or replace function public.register_upload(p_report text, p_unit text, p_period text, p_files jsonb)
returns public.submissions
language plpgsql security definer set search_path = public as $$
declare
  v_me public.members := public.coa_me();
  v_key text := p_report || '|' || p_unit || '|' || p_period;
  v_slot record; v_sub public.submissions; f jsonb; v_path text;
begin
  if not public.can_upload(p_unit) then raise exception 'You are not assigned to upload for %', p_unit; end if;
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) = 0 then raise exception 'Choose at least one file'; end if;
  select * into v_slot from public.coa_slot(p_report, p_unit, p_period);
  insert into public.submissions (report_code, unit_code, period_key, period_label, due_date)
  values (p_report, p_unit, p_period, v_slot.period_label, v_slot.due_date)
  on conflict (report_code, unit_code, period_key) do nothing;
  select * into v_sub from public.submissions where report_code = p_report and unit_code = p_unit and period_key = p_period for update;
  if v_sub.status = 'approved' then raise exception 'Already released to COA. Ask the Division Accountant to reopen it first'; end if;
  if v_sub.status = 'not_applicable' then raise exception 'Marked not applicable. Ask the Division Accountant to reopen it first'; end if;
  for f in select * from jsonb_array_elements(p_files) loop
    v_path := f->>'storage_path';
    if coalesce((f->'precheck'->>'blocked')::boolean, false) then raise exception 'Remove files that failed the pre-check first'; end if;
    if v_path is null or split_part(v_path, '/', 1) <> p_unit or split_part(v_path, '/', 2) <> p_period or split_part(v_path, '/', 3) <> p_report then
      raise exception 'File % is not stored under this report', f->>'name';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'coa-files' and o.name = v_path) then
      raise exception 'File % has not finished uploading', f->>'name';
    end if;
    insert into public.submission_files (submission_id, storage_path, name, size, content_type, sha256, precheck, uploaded_by, uploaded_by_name)
    values (v_sub.id, v_path, left(coalesce(f->>'name', v_path), 255), (f->>'size')::bigint, f->>'content_type', f->>'sha256', f->'precheck', v_me.email, v_me.name);
    perform public.coa_log(v_key, v_sub.id, 'upload', jsonb_build_object('file', f->>'name',
      'findings', (select count(*) from jsonb_array_elements(coalesce(f->'precheck'->'findings', '[]'::jsonb)) x where x->>'severity' = 'warn')));
  end loop;
  if v_sub.status = 'returned' then perform public.coa_log(v_key, v_sub.id, 'resubmit', '{}'); end if;
  update public.submissions set status = 'for_review', updated_at = now() where id = v_sub.id returning * into v_sub;
  return v_sub;
end $$;

-- After a return: send the remaining current files back without uploading a new one.
create or replace function public.resubmit_submission(p_id uuid) returns public.submissions
language plpgsql security definer set search_path = public as $$
declare v_me public.members := public.coa_me(); v_sub public.submissions;
begin
  select * into v_sub from public.submissions where id = p_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if not public.can_upload(v_sub.unit_code) then raise exception 'You cannot submit for this office'; end if;
  if v_sub.status <> 'returned' then raise exception 'Only returned items can be resubmitted'; end if;
  if not exists (select 1 from public.submission_files where submission_id = p_id and superseded_at is null) then raise exception 'Upload a corrected file first'; end if;
  update public.submissions set status = 'for_review', updated_at = now() where id = p_id returning * into v_sub;
  perform public.coa_log(v_sub.report_code || '|' || v_sub.unit_code || '|' || v_sub.period_key, p_id, 'resubmit', '{}');
  return v_sub;
end $$;

-- Division Accountant: approve (release to COA) or return with a note.
create or replace function public.review_submission(p_id uuid, p_decision text, p_note text default null) returns public.submissions
language plpgsql security definer set search_path = public as $$
declare v_me public.members := public.coa_me(); v_sub public.submissions; v_files int; v_note text := nullif(trim(p_note), '');
begin
  if v_me.role <> 'accountant' then raise exception 'Only the Division Accountant can do this'; end if;
  select * into v_sub from public.submissions where id = p_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if v_sub.status <> 'for_review' then raise exception 'Only items waiting for review can be approved or returned'; end if;
  select count(*) into v_files from public.submission_files where submission_id = p_id and superseded_at is null;
  if p_decision = 'approve' then
    if v_files = 0 then raise exception 'Approving requires at least one current file'; end if;
    update public.submissions set status = 'approved', review_note = null, reviewed_by = v_me.email, reviewed_at = now(), approved_at = now(), updated_at = now()
    where id = p_id returning * into v_sub;
    perform public.coa_log(v_sub.report_code || '|' || v_sub.unit_code || '|' || v_sub.period_key, p_id, 'approve', jsonb_build_object('files', v_files));
  elsif p_decision = 'return' then
    if v_note is null then raise exception 'Returning requires a note for the Senior Bookkeeper'; end if;
    update public.submissions set status = 'returned', review_note = v_note, reviewed_by = v_me.email, reviewed_at = now(), updated_at = now()
    where id = p_id returning * into v_sub;
    perform public.coa_log(v_sub.report_code || '|' || v_sub.unit_code || '|' || v_sub.period_key, p_id, 'return', jsonb_build_object('note', v_note));
  else
    raise exception 'Unknown decision: %', p_decision;
  end if;
  return v_sub;
end $$;

create or replace function public.set_not_applicable(p_report text, p_unit text, p_period text, p_reason text) returns public.submissions
language plpgsql security definer set search_path = public as $$
declare v_me public.members := public.coa_me(); v_slot record; v_sub public.submissions; v_reason text := nullif(trim(p_reason), '');
begin
  if v_me.role <> 'accountant' then raise exception 'Only the Division Accountant can do this'; end if;
  if v_reason is null then raise exception 'Give a reason for marking this not applicable'; end if;
  select * into v_slot from public.coa_slot(p_report, p_unit, p_period);
  insert into public.submissions (report_code, unit_code, period_key, period_label, due_date)
  values (p_report, p_unit, p_period, v_slot.period_label, v_slot.due_date)
  on conflict (report_code, unit_code, period_key) do nothing;
  select * into v_sub from public.submissions where report_code = p_report and unit_code = p_unit and period_key = p_period for update;
  if v_sub.status = 'not_applicable' then raise exception 'Already marked not applicable'; end if;
  if v_sub.status = 'approved' then raise exception 'Reopen the released report before marking it not applicable'; end if;
  update public.submissions set status = 'not_applicable', review_note = v_reason, reviewed_by = v_me.email, reviewed_at = now(), updated_at = now()
  where id = v_sub.id returning * into v_sub;
  perform public.coa_log(p_report || '|' || p_unit || '|' || p_period, v_sub.id, 'not_applicable', jsonb_build_object('reason', v_reason));
  return v_sub;
end $$;

create or replace function public.reopen_submission(p_id uuid, p_reason text) returns public.submissions
language plpgsql security definer set search_path = public as $$
declare v_me public.members := public.coa_me(); v_sub public.submissions; v_from text; v_reason text := nullif(trim(p_reason), '');
begin
  if v_me.role <> 'accountant' then raise exception 'Only the Division Accountant can do this'; end if;
  if v_reason is null then raise exception 'Reopening requires a reason'; end if;
  select * into v_sub from public.submissions where id = p_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if v_sub.status not in ('approved','not_applicable') then raise exception 'Only released or not-applicable items can be reopened'; end if;
  v_from := v_sub.status;
  update public.submissions
  set status = case when exists (select 1 from public.submission_files where submission_id = p_id and superseded_at is null) then 'for_review' else 'missing' end,
      review_note = null, approved_at = null, updated_at = now()
  where id = p_id returning * into v_sub;
  perform public.coa_log(v_sub.report_code || '|' || v_sub.unit_code || '|' || v_sub.period_key, p_id, 'reopen', jsonb_build_object('reason', v_reason, 'from', v_from));
  return v_sub;
end $$;

-- Files are never deleted: removing one marks it superseded and keeps it in the history.
create or replace function public.remove_file(p_file_id uuid, p_reason text default null) returns public.submissions
language plpgsql security definer set search_path = public as $$
declare v_me public.members := public.coa_me(); v_file public.submission_files; v_sub public.submissions;
begin
  select * into v_file from public.submission_files where id = p_file_id for update;
  if not found then raise exception 'File not found'; end if;
  if v_file.superseded_at is not null then raise exception 'File was already removed'; end if;
  select * into v_sub from public.submissions where id = v_file.submission_id for update;
  if not public.can_upload(v_sub.unit_code) then raise exception 'You cannot change files for this office'; end if;
  if v_sub.status in ('approved','not_applicable') then raise exception 'Reopen the item before changing its files'; end if;
  update public.submission_files set superseded_at = now(), superseded_by = v_me.email, supersede_reason = nullif(trim(p_reason), '') where id = p_file_id;
  update public.submissions
  set status = case when status = 'for_review' and not exists (select 1 from public.submission_files where submission_id = v_sub.id and superseded_at is null) then 'missing' else status end,
      updated_at = now()
  where id = v_sub.id returning * into v_sub;
  perform public.coa_log(v_sub.report_code || '|' || v_sub.unit_code || '|' || v_sub.period_key, v_sub.id, 'remove', jsonb_build_object('file', v_file.name, 'reason', nullif(trim(p_reason), '')));
  return v_sub;
end $$;

-- =====================================================================
-- 4. Account actions (Division Accountant and superadmin)
-- =====================================================================

create or replace function public.approve_access(p_id uuid) returns public.members
language plpgsql security definer set search_path = public as $$
declare v_me public.members := public.coa_me(); r public.access_requests; m public.members;
begin
  if v_me.role not in ('accountant','superadmin') then raise exception 'Only the Division Accountant or the superadmin can manage access'; end if;
  select * into r from public.access_requests where id = p_id for update;
  if not found or r.status <> 'pending' then raise exception 'This registration is no longer pending'; end if;
  if r.role = 'accountant' and v_me.role <> 'superadmin' then raise exception 'Only the superadmin can approve a Division Accountant'; end if;
  if exists (select 1 from public.members where email = r.email) then raise exception 'This email already has access'; end if;
  insert into public.members (email, user_id, name, role, offices, base, unit_code, position)
  values (r.email, r.user_id, r.name, r.role, r.offices, r.base, r.unit_code, r.position) returning * into m;
  update public.access_requests set status = 'approved', reviewed_by = v_me.email, reviewed_at = now() where id = p_id;
  perform public.coa_log(null, null, 'member_approve', jsonb_build_object('email', r.email, 'role', r.role, 'offices', r.offices));
  return m;
end $$;

create or replace function public.decline_access(p_id uuid, p_reason text) returns public.access_requests
language plpgsql security definer set search_path = public as $$
declare v_me public.members := public.coa_me(); r public.access_requests; v_reason text := nullif(trim(p_reason), '');
begin
  if v_me.role not in ('accountant','superadmin') then raise exception 'Only the Division Accountant or the superadmin can manage access'; end if;
  if v_reason is null then raise exception 'Give a reason for declining'; end if;
  update public.access_requests set status = 'declined', note = v_reason, reviewed_by = v_me.email, reviewed_at = now()
  where id = p_id and status = 'pending' returning * into r;
  if not found then raise exception 'This registration is no longer pending'; end if;
  perform public.coa_log(null, null, 'member_decline', jsonb_build_object('email', r.email, 'reason', v_reason));
  return r;
end $$;

-- Add (pre-authorise an email) or edit a member. Granting or removing the accountant role is superadmin-only.
create or replace function public.save_member(p_email text, p_name text, p_role text, p_offices text[] default '{}') returns public.members
language plpgsql security definer set search_path = public as $$
declare
  v_me public.members := public.coa_me();
  v_email text := lower(trim(p_email)); v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_offices text[]; v_old public.members; m public.members;
begin
  if v_me.role not in ('accountant','superadmin') then raise exception 'Only the Division Accountant or the superadmin can manage access'; end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address'; end if;
  if length(v_name) < 3 then raise exception 'Enter the full name'; end if;
  if p_role not in ('accountant','uploader','coa') then raise exception 'Choose a role'; end if;
  select coalesce(array_agg(distinct u.code order by u.code), '{}') into v_offices from public.units u where u.code = any (coalesce(p_offices, '{}'));
  if p_role = 'uploader' and cardinality(v_offices) = 0 then raise exception 'Choose at least one office for a Senior Bookkeeper'; end if;
  if p_role <> 'uploader' then select array_agg(code order by sort) into v_offices from public.units; end if;
  select * into v_old from public.members where email = v_email for update;
  if found and v_old.role = 'superadmin' then raise exception 'The superadmin account is changed in the database only'; end if;
  if (p_role = 'accountant' or v_old.role = 'accountant') and v_me.role <> 'superadmin' then raise exception 'Only the superadmin can add or change a Division Accountant'; end if;
  if v_old.role = 'accountant' and p_role <> 'accountant'
     and (select count(*) from public.members where role = 'accountant' and active) < 2 then
    raise exception 'At least one Division Accountant must keep access';
  end if;
  insert into public.members (email, user_id, name, role, offices)
  values (v_email, (select id from auth.users where lower(email) = v_email limit 1), v_name, p_role, v_offices)
  on conflict (email) do update set name = excluded.name, role = excluded.role, offices = excluded.offices, updated_at = now()
  returning * into m;
  perform public.coa_log(null, null, case when v_old.email is null then 'member_add' else 'member_update' end,
    jsonb_build_object('email', v_email, 'role', p_role, 'offices', v_offices, 'old_role', v_old.role, 'old_offices', v_old.offices));
  return m;
end $$;

create or replace function public.set_member_active(p_email text, p_active boolean) returns public.members
language plpgsql security definer set search_path = public as $$
declare v_me public.members := public.coa_me(); m public.members;
begin
  if v_me.role not in ('accountant','superadmin') then raise exception 'Only the Division Accountant or the superadmin can manage access'; end if;
  select * into m from public.members where email = lower(trim(p_email)) for update;
  if not found then raise exception 'Unknown member'; end if;
  if m.email = v_me.email then raise exception 'You cannot turn off your own access'; end if;
  if m.role = 'superadmin' then raise exception 'The superadmin account is changed in the database only'; end if;
  if m.role = 'accountant' and v_me.role <> 'superadmin' then raise exception 'Only the superadmin can change a Division Accountant'; end if;
  if m.role = 'accountant' and not p_active and (select count(*) from public.members where role = 'accountant' and active) < 2 then
    raise exception 'At least one Division Accountant must keep access';
  end if;
  update public.members set active = p_active, updated_at = now() where email = m.email returning * into m;
  perform public.coa_log(null, null, case when p_active then 'member_activate' else 'member_deactivate' end, jsonb_build_object('email', m.email));
  return m;
end $$;

-- =====================================================================
-- 5. Registration: when someone confirms their email, file their access request
-- =====================================================================
-- The app signs people up with supabase.auth.signUp({ email, password, options: { data: { name, base, unit_code, position } } }).
-- Emails already added by the accountant/superadmin are linked straight to their member row.

create or replace function public.handle_confirmed_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_email text := lower(new.email);
  v_base text := meta->>'base';
  v_unit text := meta->>'unit_code';
  v_pos text := meta->>'position';
  v_role text; v_offices text[];
begin
  if new.email_confirmed_at is null or v_email is null then return new; end if;
  update public.members set user_id = new.id, updated_at = now() where email = v_email and user_id is null;
  if exists (select 1 from public.members where email = v_email) then return new; end if;
  if exists (select 1 from public.access_requests where email = v_email and status = 'pending') then return new; end if;
  if v_base is null or v_base not in ('IU','SDO','COA') then return new; end if;
  if v_base = 'IU' then
    if v_unit is null or v_unit in ('SDO','CONSO') or not exists (select 1 from public.units where code = v_unit) then return new; end if;
    if v_pos is distinct from 'Senior Bookkeeper' then return new; end if;
    v_role := 'uploader'; v_offices := array[v_unit];
  elsif v_base = 'SDO' then
    v_unit := null;
    if v_pos = 'Accountant' then v_role := 'accountant'; select array_agg(code order by sort) into v_offices from public.units;
    elsif v_pos = 'Senior Bookkeeper' then v_role := 'uploader'; v_offices := array['SDO','CONSO'];
    else return new; end if;
  else
    v_unit := null;
    if v_pos is null or v_pos not in ('Auditor','Audit Team Leader','State Auditor') then return new; end if;
    v_role := 'coa'; select array_agg(code order by sort) into v_offices from public.units;
  end if;
  insert into public.access_requests (user_id, email, name, base, unit_code, position, role, offices)
  values (new.id, v_email, left(coalesce(nullif(trim(meta->>'name'), ''), v_email), 120), v_base, v_unit, v_pos, v_role, v_offices);
  return new;
end $$;

create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.handle_confirmed_user();

-- =====================================================================
-- 6. Row Level Security
-- =====================================================================

alter table public.units enable row level security;
alter table public.report_types enable row level security;
alter table public.settings enable row level security;
alter table public.members enable row level security;
alter table public.access_requests enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_files enable row level security;
alter table public.activity_log enable row level security;
alter table public.reminder_log enable row level security;   -- no policies: service role only

create policy "Members read units" on public.units for select to authenticated using (public.my_role() is not null);
create policy "Members read report types" on public.report_types for select to authenticated using (public.my_role() is not null);
create policy "Managers edit report types" on public.report_types for update to authenticated using (public.my_role() = 'accountant') with check (public.my_role() = 'accountant');
create policy "Members read settings" on public.settings for select to authenticated using (public.my_role() is not null);
create policy "Accountant edits settings" on public.settings for update to authenticated using (public.my_role() = 'accountant') with check (public.my_role() = 'accountant');

create policy "Read own or all members" on public.members for select to authenticated
  using (user_id = auth.uid() or public.my_role() is not null);
create policy "Read own or all registrations" on public.access_requests for select to authenticated
  using (user_id = auth.uid() or public.is_manager());

-- Staff see every submission; COA sees only released ones. The superadmin manages accounts only.
create policy "Staff read submissions" on public.submissions for select to authenticated
  using (public.my_role() in ('accountant','uploader') or (public.my_role() = 'coa' and status = 'approved'));
create policy "Staff read files" on public.submission_files for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id
                 and (public.my_role() in ('accountant','uploader')
                      or (public.my_role() = 'coa' and s.status = 'approved' and superseded_at is null))));
create policy "Staff read activity" on public.activity_log for select to authenticated
  using (public.my_role() in ('accountant','uploader') or (item_key is null and public.my_role() = 'superadmin'));

-- Writes happen only through the functions above.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
grant update (tracking_start, reminder_days, horizon_days, ai_preaudit, updated_at) on public.settings to authenticated;
grant update (applies_to, active) on public.report_types to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_role(), public.is_manager(), public.can_upload(text),
  public.coa_period(text), public.coa_due_date(text, date), public.coa_slot(text, text, text),
  public.register_upload(text, text, text, jsonb), public.resubmit_submission(uuid),
  public.review_submission(uuid, text, text), public.set_not_applicable(text, text, text, text),
  public.reopen_submission(uuid, text), public.remove_file(uuid, text),
  public.approve_access(uuid), public.decline_access(uuid, text),
  public.save_member(text, text, text, text[]), public.set_member_active(text, boolean)
  to authenticated;
revoke execute on function public.coa_log(text, uuid, text, jsonb), public.coa_me(), public.handle_confirmed_user() from authenticated;
-- coa_me() is called inside the security-definer functions above, which run as the owner.

-- =====================================================================
-- 7. Storage: private bucket, upload by assigned office, COA reads released files only
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('coa-files', 'coa-files', false, 52428800)
on conflict (id) do nothing;

-- Object names: {unit}/{period}/{report}/{random}/{file name}
create policy "COA files: upload for assigned office" on storage.objects for insert to authenticated
  with check (bucket_id = 'coa-files' and public.can_upload((storage.foldername(name))[1]));
create policy "COA files: staff read" on storage.objects for select to authenticated
  using (bucket_id = 'coa-files' and public.my_role() in ('accountant','uploader'));
create policy "COA files: COA reads released files" on storage.objects for select to authenticated
  using (bucket_id = 'coa-files' and public.my_role() = 'coa'
         and exists (select 1 from public.submission_files f join public.submissions s on s.id = f.submission_id
                     where f.storage_path = objects.name and f.superseded_at is null and s.status = 'approved'));
-- No update or delete policies: uploaded files cannot be overwritten or deleted from the app.

-- =====================================================================
-- 8. Reference data
-- =====================================================================

insert into public.units (code, name, sort) values
  ('SDO', 'SDO Basilan (Division Office)', 1),
  ('BNHS', 'Basilan NHS', 2),
  ('BEGANG', 'Begang NHS', 3),
  ('CONSO', 'Consolidated', 4);

insert into public.report_types (code, sort, frequency, category, due_rule, name, description, periods, applies_to) values
  ('MTB', 10, 'MONTHLY', 'Monthly', 'NEXT_MONTH_DAY:10', 'Monthly Pre-Closing Trial Balance', 'Detailed pre-closing trial balance per Fund Cluster (01 Regular Agency, 02 NCBA/Special, 07 Trust).', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('RCI', 11, 'MONTHLY', 'Monthly', 'NEXT_MONTH_DAY:10', 'Report of Checks Issued (RCI) / SLCIC', 'Summary of checks issued against MDS and commercial bank accounts, with paid vouchers and supporting documents.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('RADA', 12, 'MONTHLY', 'Monthly', 'NEXT_MONTH_DAY:10', 'Report of Advice to Debit Account Issued (RADA)', 'Summary of direct bank transfers / ADA payments for payroll, suppliers, and downloads.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('BRS', 13, 'MONTHLY', 'Monthly', 'NEXT_MONTH_DAY:20', 'Bank Reconciliation Statements', 'Reconciliations for all operational bank accounts (MDS, LDDAP-ADA, high school / division accounts) with bank statements and paid vouchers.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('FAR4', 14, 'MONTHLY', 'Monthly', 'NEXT_MONTH_DAY:10', 'FAR No. 4 – Monthly Report of Disbursements', 'Actual disbursements broken down by Personnel Services, MOOE, and Capital Outlay.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('QFS', 20, 'QUARTERLY', 'Quarterly', 'DAYS_AFTER:10', 'Quarterly Financial Statements', 'Statement of Financial Position, Financial Performance, Changes in Net Assets/Equity, Cash Flows (Direct), and Comparison of Budget and Actual Amounts.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('QTB', 21, 'QUARTERLY', 'Quarterly', 'DAYS_AFTER:10', 'Quarterly Trial Balances & Supporting Schedules', 'Detailed trial balance and schedules for Accounts Receivable, Accounts Payable, SL balances, and advances to ODA/employees.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('FAR1', 22, 'QUARTERLY', 'Quarterly', 'DAYS_AFTER:30', 'FAR No. 1 – SAAODB', 'Statement of Appropriations, Allotments, Obligations, Disbursements and Balances. Submitted via DBM-COA URS.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('FAR1A', 23, 'QUARTERLY', 'Quarterly', 'DAYS_AFTER:30', 'FAR No. 1-A – Summary by Object of Expenditures', 'Summary of Appropriations, Allotments, Obligations, Disbursements and Balances by Object of Expenditures.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('FAR1B', 24, 'QUARTERLY', 'Quarterly', 'DAYS_AFTER:30', 'FAR No. 1-B – Allotments and Sub-Allotments Received', 'List of Allotments and Sub-Allotments Received (Sub-ARO from DepEd Central/Regional Office).', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('FAR1C', 25, 'QUARTERLY', 'Quarterly', 'DAYS_AFTER:30', 'FAR No. 1-C – Off-Budget Funds', 'Statement of Obligations, Disbursements, Liquidations and Unliquidated Obligations for Off-Budget Funds.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('FAR2', 26, 'QUARTERLY', 'Quarterly', 'DAYS_AFTER:30', 'FAR No. 2 & 2-A', 'Statement of Approved Budget, Utilizations, Disbursements and Balances (Off-Budget Funds / Trust Receipts).', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('FAR5', 27, 'QUARTERLY', 'Quarterly', 'DAYS_AFTER:30', 'FAR No. 5 – Revenue and Other Receipts', 'Quarterly Report of Revenue and Other Receipts.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('UCA', 30, 'SEMIANNUAL', 'Semi-annual', 'NEXT_DATE:07-15|01-15', 'Status of Unliquidated Cash Advances', 'Consolidated listing and aging of outstanding cash advances (disbursing officers, field officers, principals’ MOOE, travel).', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('APAR', 31, 'SEMIANNUAL', 'Semi-annual', 'NEXT_DATE:07-15', 'Statements of Accounts Payable & Accounts Receivable', 'Aging list and details of outstanding liabilities and receivables (1st semester).', array['S1'], array['SDO','BNHS','BEGANG','CONSO']),
  ('YFS', 40, 'ANNUAL', 'Annual', 'NEXT_DATE:01-20', 'Year-End Financial Statements', 'Full set of financial statements (condensed and detailed) per Fund Cluster.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('YTB', 41, 'ANNUAL', 'Annual', 'NEXT_DATE:01-20', 'Pre-Closing & Post-Closing Trial Balances', 'Final pre-closing and post-closing trial balances with journal entry vouchers (JEVs) attached.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('NOTES', 42, 'ANNUAL', 'Annual', 'NEXT_DATE:01-20', 'Notes to Financial Statements', 'Narrative disclosures: accounting policies, breakdowns of major accounts, contingent liabilities. (May be extended to Jan 31 per regional guidelines.)', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('FAR3', 43, 'ANNUAL', 'Annual', 'NEXT_DATE:01-30', 'FAR No. 3 – Aging of Unpaid Obligations', 'Breakdown of Accounts Payable and Due and Demandable Obligations at year-end.', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('RPCPPE', 44, 'ANNUAL', 'Annual', 'NEXT_DATE:01-31', 'Report on the Physical Count of PPE (RPCPPE)', 'Physical inventory of school buildings, ICT equipment, learning materials, motor vehicles and machinery (with the Supply Officer).', null, array['SDO','BNHS','BEGANG','CONSO']),
  ('RPCI', 45, 'ANNUAL', 'Annual', 'NEXT_DATE:01-31', 'Report on the Physical Count of Inventories (RPCI)', 'Physical inventory of office supplies, textbooks, learning modules and semi-expendable property.', null, array['SDO','BNHS','BEGANG','CONSO']);

-- Track from the first day of last month (Manila). The Division Accountant can change this later.
insert into public.settings (tracking_start)
values ((date_trunc('month', now() at time zone 'Asia/Manila') - interval '1 month')::date);

-- =====================================================================
-- 9. After running: create the first accounts (replace the emails, then run these two lines)
-- =====================================================================
-- insert into public.members (email, name, role, offices) values ('superadmin.email@deped.gov.ph', 'Superadmin', 'superadmin', '{}');
-- insert into public.members (email, name, role, offices) values ('accountant.email@deped.gov.ph', 'Division Accountant', 'accountant', array['SDO','BNHS','BEGANG','CONSO']);
-- Then each person registers in FundWork with that email; confirming the email links the account.
