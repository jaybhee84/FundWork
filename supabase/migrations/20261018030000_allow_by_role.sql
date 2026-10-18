-- FundWork · the superadmin can allow a user with just an email and a role.
-- The name is optional when allowing: the person types it at registration, and changing a role later keeps it.

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
  -- Names are optional when allowing (the person types them at registration); give both or neither.
  if (v_family = '') <> (v_first = '') then raise exception '%', case when v_family = '' then 'Enter the family name' else 'Enter the first name' end; end if;
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
  values (v_email, (select id from auth.users where lower(email) = v_email limit 1),
          case when v_family = '' then v_email else public.coa_person_name(v_family, v_first, v_middle) end,
          nullif(v_family, ''), nullif(v_first, ''), v_middle, v_role, v_offices, p_base, v_unit, p_position)
  -- Editing without names (superadmin role change) keeps the name the person registered with.
  on conflict (email) do update set name = case when v_family = '' then members.name else excluded.name end,
    family_name = case when v_family = '' then members.family_name else excluded.family_name end,
    first_name = case when v_family = '' then members.first_name else excluded.first_name end,
    middle_name = case when v_family = '' then members.middle_name else excluded.middle_name end, role = excluded.role, offices = excluded.offices, base = excluded.base,
    unit_code = excluded.unit_code, position = excluded.position, updated_at = now()
  returning * into m;
  perform public.coa_log(null, null, case when v_old.email is null then 'member_add' else 'member_update' end,
    jsonb_build_object('email', v_email, 'role', v_role, 'offices', v_offices, 'old_role', v_old.role, 'old_offices', v_old.offices));
  return m;
end $$;
