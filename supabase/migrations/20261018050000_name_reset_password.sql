-- Derive the temporary password from the registered name on the server.
-- Keep the existing signature for older clients; p_temp is ignored.
create or replace function public.reset_member_password(p_email text, p_temp text) returns public.members
language plpgsql security definer set search_path = public, extensions as $$
declare v_me public.members := public.coa_me(); m public.members; v_temp text;
begin
  if v_me.role not in ('accountant','superadmin') then raise exception 'Only the Division Accountant or the superadmin can manage access'; end if;
  select * into m from public.members where email = lower(trim(p_email)) for update;
  if not found then raise exception 'Unknown user'; end if;
  if m.email = v_me.email then raise exception 'Change your own password in Account settings'; end if;
  if m.role = 'superadmin' then raise exception '%', case when v_me.role = 'superadmin' then 'The superadmin account is changed in the database only' else 'Unknown user' end; end if;
  if m.role = 'accountant' and v_me.role <> 'superadmin' then raise exception 'Only the superadmin can reset a Division Accountant''s password'; end if;
  if m.user_id is null then raise exception '% has not registered yet', m.name; end if;
  if nullif(trim(m.family_name), '') is null or nullif(trim(m.first_name), '') is null then
    raise exception 'This account needs a family name and first name before resetting its password';
  end if;
  v_temp := initcap(regexp_replace(trim(m.family_name), '\s+', ' ', 'g')) || '_' || upper(left(trim(m.first_name), 1));
  update auth.users set encrypted_password = extensions.crypt(v_temp, extensions.gen_salt('bf', 10)), updated_at = now() where id = m.user_id;
  update public.members set must_change_password = true, updated_at = now() where email = m.email returning * into m;
  perform public.coa_log(null, null, 'password_reset', jsonb_build_object('email', m.email));
  return m;
end $$;

