-- FundWork · allowed users, no email.
-- Run after 20261018000000_coa_submissions.sql (SQL Editor → paste → Run).
--
-- How accounts work now
--   1. The Division Accountant (or the superadmin, for a Division Accountant) allows an email in FundWork:
--      name, where the person works (School IU / SDO / COA) and position. That sets the role and offices.
--   2. The person registers in FundWork with that email and chooses a password. Only allowed emails can
--      register; Supabase rejects every other sign-up.
--   3. No emails are sent. In Supabase → Authentication → Sign In / Providers → Email, turn OFF "Confirm email".
--   4. Forgot password: the Division Accountant sets a temporary password, which must be changed at sign-in.
-- School (IU) and SDO staff must use a DepEd email (@deped.gov.ph); COA personnel may use their own.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Members: name parts, password flag. Registration requests are no longer used.
-- ---------------------------------------------------------------------
alter table public.members
  add column if not exists family_name text,
  add column if not exists first_name text,
  add column if not exists middle_name text,
  add column if not exists must_change_password boolean not null default false;

drop function if exists public.approve_access(uuid);
drop function if exists public.decline_access(uuid, text);
drop function if exists public.save_member(text, text, text, text[]);
drop table if exists public.access_requests;

-- "dela cruz" → "Dela Cruz"; a one-letter middle name gets a period. Display: "Family, First Middle".
create or replace function public.coa_person_name(p_family text, p_first text, p_middle text) returns text
language sql immutable as $$
  select initcap(regexp_replace(trim(p_family), '\s+', ' ', 'g')) || ', ' || initcap(regexp_replace(trim(p_first), '\s+', ' ', 'g'))
    || coalesce(' ' || nullif(case when length(rtrim(trim(p_middle), '.')) = 1 then upper(rtrim(trim(p_middle), '.')) || '.'
                                   else initcap(regexp_replace(trim(p_middle), '\s+', ' ', 'g')) end, ''), '')
$$;

-- ---------------------------------------------------------------------
-- Registration: only allowed emails. Runs when Supabase creates the sign-in account.
-- ---------------------------------------------------------------------
create or replace function public.handle_confirmed_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m public.members;
begin
  if new.email is null then return new; end if;
  select * into m from public.members where email = lower(new.email);
  if not found then raise exception 'This email is not on the FundWork allowed list'; end if;
  if m.user_id = new.id then return new; end if;
  if m.user_id is not null then raise exception 'This email is already registered'; end if;
  if not m.active then raise exception 'This account has been turned off'; end if;
  -- The app sends the name typed on the Register screen as metadata: family_name, first_name, middle_name.
  update public.members set user_id = new.id, updated_at = now(),
    family_name = coalesce(nullif(initcap(trim(new.raw_user_meta_data->>'family_name')), ''), family_name),
    first_name = coalesce(nullif(initcap(trim(new.raw_user_meta_data->>'first_name')), ''), first_name),
    middle_name = case when nullif(trim(new.raw_user_meta_data->>'first_name'), '') is null then middle_name
                       else nullif(initcap(trim(new.raw_user_meta_data->>'middle_name')), '') end
  where email = m.email;
  update public.members set name = public.coa_person_name(family_name, first_name, middle_name)
  where email = m.email and family_name is not null and first_name is not null;
  perform public.coa_log_as(m.email, m.name, null, null, 'member_register', jsonb_build_object('email', m.email));
  return new;
end $$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_confirmed_user();

-- Log helper for actions that happen before anyone is signed in (registration).
create or replace function public.coa_log_as(p_email text, p_name text, p_key text, p_submission uuid, p_action text, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.activity_log (item_key, submission_id, action, details, actor_email, actor_name)
  values (p_key, p_submission, p_action, coalesce(p_details, '{}'::jsonb), p_email, p_name)
$$;

-- Lets the Register screen say "not on the allowed list" before trying to sign up.
-- Returns true only for an allowed, active email that has not registered yet.
create or replace function public.can_register(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = lower(trim(p_email)) and active and user_id is null)
$$;

-- ---------------------------------------------------------------------
-- Allow (or edit) a user. Where they work and their position decide the role and offices.
-- ---------------------------------------------------------------------
create or replace function public.save_member(p_email text, p_family_name text, p_first_name text, p_middle_name text,
                                              p_base text, p_unit_code text, p_position text) returns public.members
language plpgsql security definer set search_path = public as $$
declare
  v_me public.members := public.coa_me();
  v_email text := lower(trim(p_email));
  v_family text := initcap(regexp_replace(trim(coalesce(p_family_name, '')), '\s+', ' ', 'g'));
  v_first text := initcap(regexp_replace(trim(coalesce(p_first_name, '')), '\s+', ' ', 'g'));
  v_middle text := nullif(initcap(regexp_replace(trim(coalesce(p_middle_name, '')), '\s+', ' ', 'g')), '');
  v_unit text := case when p_base = 'IU' then p_unit_code end;
  v_role text; v_offices text[]; v_old public.members; m public.members;
begin
  if v_me.role not in ('accountant','superadmin') then raise exception 'Only the Division Accountant or the superadmin can manage access'; end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address'; end if;
  if v_family = '' then raise exception 'Enter the family name'; end if;
  if v_first = '' then raise exception 'Enter the first name'; end if;
  if p_base = 'IU' then
    if v_unit is null or v_unit in ('SDO','CONSO') or not exists (select 1 from public.units where code = v_unit) then raise exception 'Choose the school'; end if;
    if p_position is distinct from 'Senior Bookkeeper' then raise exception 'Choose the position'; end if;
    v_role := 'uploader'; v_offices := array[v_unit];
  elsif p_base = 'SDO' then
    if p_position = 'Accountant' then v_role := 'accountant'; select array_agg(code order by sort) into v_offices from public.units;
    elsif p_position = 'Senior Bookkeeper' then v_role := 'uploader'; v_offices := array['SDO','CONSO'];
    else raise exception 'Choose the position'; end if;
  elsif p_base = 'COA' then
    if p_position is null or p_position not in ('Auditor','Audit Team Leader','State Auditor') then raise exception 'Choose the position'; end if;
    v_role := 'coa'; select array_agg(code order by sort) into v_offices from public.units;
  else
    raise exception 'Choose where they work: School (IU), SDO or COA';
  end if;
  select * into v_old from public.members where email = v_email for update;
  if found and v_old.role = 'superadmin' then raise exception 'The superadmin account is changed in the database only'; end if;
  if (v_role = 'accountant' or v_old.role = 'accountant') and v_me.role <> 'superadmin' then
    raise exception 'Only the superadmin can allow or change a Division Accountant';
  end if;
  if v_old.role = 'accountant' and v_role <> 'accountant' and (select count(*) from public.members where role = 'accountant' and active) < 2 then
    raise exception 'At least one Division Accountant must keep access';
  end if;
  insert into public.members (email, user_id, name, family_name, first_name, middle_name, role, offices, base, unit_code, position)
  values (v_email, (select id from auth.users where lower(email) = v_email limit 1), public.coa_person_name(v_family, v_first, v_middle),
          v_family, v_first, v_middle, v_role, v_offices, p_base, v_unit, p_position)
  on conflict (email) do update set name = excluded.name, family_name = excluded.family_name, first_name = excluded.first_name,
    middle_name = excluded.middle_name, role = excluded.role, offices = excluded.offices, base = excluded.base,
    unit_code = excluded.unit_code, position = excluded.position, updated_at = now()
  returning * into m;
  perform public.coa_log(null, null, case when v_old.email is null then 'member_add' else 'member_update' end,
    jsonb_build_object('email', v_email, 'role', v_role, 'offices', v_offices, 'old_role', v_old.role, 'old_offices', v_old.offices));
  return m;
end $$;

-- ---------------------------------------------------------------------
-- Forgot password: temporary password set by the Division Accountant / superadmin.
-- ---------------------------------------------------------------------
create or replace function public.reset_member_password(p_email text, p_temp text) returns public.members
language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.members := public.coa_me(); m public.members;
begin
  if v_me.role not in ('accountant','superadmin') then raise exception 'Only the Division Accountant or the superadmin can manage access'; end if;
  select * into m from public.members where email = lower(trim(p_email)) for update;
  if not found then raise exception 'Unknown user'; end if;
  if m.email = v_me.email then raise exception 'Change your own password in Account settings'; end if;
  if m.role = 'superadmin' then raise exception 'The superadmin password is changed in the database only'; end if;
  if m.role = 'accountant' and v_me.role <> 'superadmin' then raise exception 'Only the superadmin can reset a Division Accountant''s password'; end if;
  if m.user_id is null then raise exception '% has not registered yet', m.name; end if;
  if length(coalesce(p_temp, '')) < 8 then raise exception 'Use at least 8 characters for the password'; end if;
  if p_temp !~ '[A-Za-z]' or p_temp !~ '[0-9]' then raise exception 'Use both letters and numbers in the password'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_temp, extensions.gen_salt('bf', 10)), updated_at = now() where id = m.user_id;
  update public.members set must_change_password = true, updated_at = now() where email = m.email returning * into m;
  perform public.coa_log(null, null, 'password_reset', jsonb_build_object('email', m.email));
  return m;
end $$;

-- Called by the app right after the person sets their own password (supabase.auth.updateUser).
create or replace function public.password_changed() returns void
language sql security definer set search_path = public as $$
  update public.members set must_change_password = false, updated_at = now() where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- School (IU) and SDO staff must use a DepEd email; COA personnel may use their own.
-- ---------------------------------------------------------------------
create or replace function public.require_deped_email() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role in ('accountant','uploader') and new.email not like '%@deped.gov.ph'
     and (tg_op = 'INSERT' or old.role not in ('accountant','uploader')) then
    raise exception 'School (IU) and SDO staff must use a DepEd email (@deped.gov.ph)';
  end if;
  return new;
end $$;
drop trigger if exists members_deped_email on public.members;
create trigger members_deped_email before insert or update of role, email on public.members
  for each row execute function public.require_deped_email();

-- ---------------------------------------------------------------------
-- Superadmin "View as": read-only access to submissions, files and activity so each role's
-- screens can be previewed. Writes still go only through the functions, which refuse the superadmin.
-- ---------------------------------------------------------------------
drop policy if exists "Superadmin reads submissions" on public.submissions;
create policy "Superadmin reads submissions" on public.submissions for select to authenticated using (public.my_role() = 'superadmin');
drop policy if exists "Superadmin reads files" on public.submission_files;
create policy "Superadmin reads files" on public.submission_files for select to authenticated using (public.my_role() = 'superadmin');
drop policy if exists "Superadmin reads activity" on public.activity_log;
create policy "Superadmin reads activity" on public.activity_log for select to authenticated using (public.my_role() = 'superadmin');

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
revoke execute on function public.coa_person_name(text, text, text), public.coa_log_as(text, text, text, uuid, text, jsonb),
  public.require_deped_email(), public.handle_confirmed_user() from public, anon, authenticated;
revoke execute on function public.save_member(text, text, text, text, text, text, text), public.reset_member_password(text, text),
  public.password_changed(), public.can_register(text) from public;
grant execute on function public.save_member(text, text, text, text, text, text, text), public.reset_member_password(text, text),
  public.password_changed() to authenticated;
grant execute on function public.can_register(text) to anon, authenticated;
