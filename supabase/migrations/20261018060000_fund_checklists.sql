-- Preserve existing report codes, submissions, files, and activity as Regular Fund.
-- Separate report codes keep the existing upload/review RPCs and storage paths isolated.
alter table public.report_types add column fund_code text not null default 'REGULAR'
  check (fund_code in ('REGULAR','PROVIDENT','TRUST'));

insert into public.report_types
  (code, sort, frequency, category, due_rule, name, description, periods, applies_to)
select 'FAR4_URS', 15, frequency, category, due_rule,
  'URS-generated FAR No. 4',
  'Submit the URS-generated FAR No. 4 separately from the regular FAR No. 4.',
  periods, applies_to from public.report_types where code = 'FAR4';

insert into public.report_types
  (code, sort, frequency, category, due_rule, name, description, periods, applies_to, active, fund_code)
select r.code || '_' || f.code, r.sort, r.frequency, r.category, r.due_rule,
  r.name || ' — ' || f.name, r.description, r.periods, r.applies_to, r.active, f.code
from public.report_types r
cross join (values ('PROVIDENT','Provident Fund'), ('TRUST','Trust Fund')) f(code, name)
where r.fund_code = 'REGULAR';

update public.report_types set name = name || ' — Regular Fund' where fund_code = 'REGULAR';
update public.settings set tracking_start = '2026-01-01', updated_at = now();

-- Enforce the current-period limit for API clients as well as the checklist.
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
  if p.start_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'Future reporting periods are not available for upload';
  end if;
  suffix := case when position('-' in p_period) > 0 then split_part(p_period, '-', 2) else p_period end;
  if coalesce(cardinality(r.periods), 0) > 0 and not (suffix = any (r.periods)) then
    raise exception '% is not expected for %', p_report, p.label;
  end if;
  period_label := p.label;
  due_date := public.coa_due_date(r.due_rule, p.end_date);
end $$;
