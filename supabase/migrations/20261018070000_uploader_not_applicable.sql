-- Assigned IU and SDO uploaders may record non-applicable reports with a reason.
create or replace function public.set_not_applicable(p_report text, p_unit text, p_period text, p_reason text) returns public.submissions
language plpgsql security definer set search_path = public as $$
declare v_me public.members := public.coa_me(); v_slot record; v_sub public.submissions; v_reason text := nullif(trim(p_reason), '');
begin
  if not public.can_upload(p_unit) then raise exception 'You cannot mark reports not applicable for this office'; end if;
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
