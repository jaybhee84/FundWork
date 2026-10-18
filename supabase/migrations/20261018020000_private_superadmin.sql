-- FundWork · keep the superadmin account private.
-- Only the superadmin can see the superadmin's row and email. The Division Accountant and everyone else
-- never receive it from the database, activity entries by the superadmin carry no email, and error
-- messages do not reveal that the account exists.

drop policy if exists "Read own or all members" on public.members;
create policy "Read own or all members" on public.members for select to authenticated
  using (user_id = auth.uid() or (public.my_role() is not null and (role <> 'superadmin' or public.my_role() = 'superadmin')));

-- Activity written by the superadmin is attributed to "Superadmin" without an email.
create or replace function public.coa_log(p_key text, p_submission uuid, p_action text, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.activity_log (item_key, submission_id, action, details, actor_email, actor_name)
  select p_key, p_submission, p_action, coalesce(p_details, '{}'::jsonb),
         case when m.role = 'superadmin' then null else m.email end,
         case when m.role = 'superadmin' then 'Superadmin' else m.name end
  from public.members m where m.user_id = auth.uid()
$$;
revoke execute on function public.coa_log(text, uuid, text, jsonb) from public, anon, authenticated;

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
  if found and v_old.role = 'superadmin' then raise exception '%', case when v_me.role = 'superadmin' then 'The superadmin account is changed in the database only' else 'Unknown user' end; end if;
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

create or replace function public.reset_member_password(p_email text, p_temp text) returns public.members
language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.members := public.coa_me(); m public.members;
begin
  if v_me.role not in ('accountant','superadmin') then raise exception 'Only the Division Accountant or the superadmin can manage access'; end if;
  select * into m from public.members where email = lower(trim(p_email)) for update;
  if not found then raise exception 'Unknown user'; end if;
  if m.email = v_me.email then raise exception 'Change your own password in Account settings'; end if;
  if m.role = 'superadmin' then raise exception '%', case when v_me.role = 'superadmin' then 'The superadmin account is changed in the database only' else 'Unknown user' end; end if;
  if m.role = 'accountant' and v_me.role <> 'superadmin' then raise exception 'Only the superadmin can reset a Division Accountant''s password'; end if;
  if m.user_id is null then raise exception '% has not registered yet', m.name; end if;
  if length(coalesce(p_temp, '')) < 8 then raise exception 'Use at least 8 characters for the password'; end if;
  if p_temp !~ '[A-Za-z]' or p_temp !~ '[0-9]' then raise exception 'Use both letters and numbers in the password'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_temp, extensions.gen_salt('bf', 10)), updated_at = now() where id = m.user_id;
  update public.members set must_change_password = true, updated_at = now() where email = m.email returning * into m;
  perform public.coa_log(null, null, 'password_reset', jsonb_build_object('email', m.email));
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
  if m.role = 'superadmin' then raise exception '%', case when v_me.role = 'superadmin' then 'The superadmin account is changed in the database only' else 'Unknown user' end; end if;
  if m.role = 'accountant' and v_me.role <> 'superadmin' then raise exception 'Only the superadmin can change a Division Accountant'; end if;
  if m.role = 'accountant' and not p_active and (select count(*) from public.members where role = 'accountant' and active) < 2 then
    raise exception 'At least one Division Accountant must keep access';
  end if;
  update public.members set active = p_active, updated_at = now() where email = m.email returning * into m;
  perform public.coa_log(null, null, case when p_active then 'member_activate' else 'member_deactivate' end, jsonb_build_object('email', m.email));
  return m;
end $$;
