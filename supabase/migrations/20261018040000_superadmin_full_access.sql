-- Superadmin may operate every report workflow; existing validations and logging remain.
create or replace function public.can_upload(p_unit text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m
    where m.user_id = auth.uid() and m.active
      and (m.role in ('accountant','superadmin') or (m.role = 'uploader' and p_unit = any(m.offices))))
$$;

-- Preserve the deployed workflow bodies and change only their reviewer role guard.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.review_submission(uuid,text,text)',
    'public.set_not_applicable(text,text,text,text)',
    'public.reopen_submission(uuid,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('v_me.role <> ''accountant''' in definition) = 0 then
      raise exception 'Unexpected reviewer guard in %', signature;
    end if;
    definition := replace(definition, 'v_me.role <> ''accountant''', 'v_me.role not in (''accountant'',''superadmin'')');
    definition := replace(definition, 'Only the Division Accountant can do this', 'Only the Division Accountant or superadmin can do this');
    execute definition;
  end loop;
end $$;

drop policy if exists "Managers edit report types" on public.report_types;
create policy "Managers edit report types" on public.report_types for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
drop policy if exists "Accountant edits settings" on public.settings;
create policy "Accountant edits settings" on public.settings for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "COA files: superadmin read" on storage.objects;
create policy "COA files: superadmin read" on storage.objects for select to authenticated
  using (bucket_id = 'coa-files' and public.my_role() = 'superadmin');
