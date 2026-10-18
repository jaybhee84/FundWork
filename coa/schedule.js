// COA submission schedule: report catalog, periods, due dates, countdowns.
// Generated from the tested TypeScript source; loaded by the renderer (window.CoaSchedule)
// and by Node (require('./coa/schedule')). Edit carefully and rerun: node coa/test.js
var CoaSchedule = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	const MONTHS = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December"
	];
	const MONTH_ABBR = MONTHS.map((m) => m.slice(0, 3));
	function parse(date) {
		const [y, m, d] = date.split("-").map(Number);
		return new Date(Date.UTC(y, m - 1, d));
	}
	function fmt(d) {
		return d.toISOString().slice(0, 10);
	}
	function addDays(date, days) {
		const d = parse(date);
		d.setUTCDate(d.getUTCDate() + days);
		return fmt(d);
	}
	function daysBetween(from, to) {
		return Math.round((parse(to).getTime() - parse(from).getTime()) / 864e5);
	}
	function lastDayOfMonth(year, month1) {
		return new Date(Date.UTC(year, month1, 0)).getUTCDate();
	}
	function ymd(year, month1, day) {
		return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	}
	/** Today's date in the Philippines, regardless of the computer's timezone. */
	function todayManila(now = /* @__PURE__ */ new Date()) {
		return fmt(new Date(now.getTime() + 288e5));
	}
	function formatDate(date) {
		const d = parse(date);
		return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
	}
	function formatLongDate(date) {
		const d = parse(date);
		return `${[
			"Sunday",
			"Monday",
			"Tuesday",
			"Wednesday",
			"Thursday",
			"Friday",
			"Saturday"
		][d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
	}
	function periodFromKey(key) {
		let m = /^(\d{4})-(\d{2})$/.exec(key);
		if (m) {
			const y = +m[1], mo = +m[2];
			return {
				key,
				frequency: "MONTHLY",
				label: `${MONTHS[mo - 1]} ${y}`,
				start: ymd(y, mo, 1),
				end: ymd(y, mo, lastDayOfMonth(y, mo))
			};
		}
		m = /^(\d{4})-Q([1-4])$/.exec(key);
		if (m) {
			const y = +m[1], q = +m[2];
			const sm = (q - 1) * 3 + 1, em = sm + 2;
			return {
				key,
				frequency: "QUARTERLY",
				label: `Q${q} ${y} (${MONTH_ABBR[sm - 1]}–${MONTH_ABBR[em - 1]})`,
				start: ymd(y, sm, 1),
				end: ymd(y, em, lastDayOfMonth(y, em))
			};
		}
		m = /^(\d{4})-S([12])$/.exec(key);
		if (m) {
			const y = +m[1], s = +m[2];
			return {
				key,
				frequency: "SEMIANNUAL",
				label: `${s === 1 ? "1st" : "2nd"} Semester ${y}`,
				start: s === 1 ? ymd(y, 1, 1) : ymd(y, 7, 1),
				end: s === 1 ? ymd(y, 6, 30) : ymd(y, 12, 31)
			};
		}
		m = /^(\d{4})$/.exec(key);
		if (m) {
			const y = +m[1];
			return {
				key,
				frequency: "ANNUAL",
				label: `CY ${y}`,
				start: ymd(y, 1, 1),
				end: ymd(y, 12, 31)
			};
		}
		throw new Error(`Unrecognized period key: ${key}`);
	}
	function periodKeyFor(frequency, date) {
		const [y, mo] = date.split("-").map(Number);
		switch (frequency) {
			case "MONTHLY": return `${y}-${String(mo).padStart(2, "0")}`;
			case "QUARTERLY": return `${y}-Q${Math.ceil(mo / 3)}`;
			case "SEMIANNUAL": return `${y}-S${mo <= 6 ? 1 : 2}`;
			case "ANNUAL": return `${y}`;
		}
	}
	/** All periods of a frequency that overlap [from, to]. */
	function periodsBetween(frequency, from, to) {
		const out = [];
		let p = periodFromKey(periodKeyFor(frequency, from));
		while (p.start <= to) {
			out.push(p);
			p = periodFromKey(periodKeyFor(frequency, addDays(p.end, 1)));
		}
		return out;
	}
	/** "S1" / "Q3" / "09" suffix used to match ReportType.periods. */
	function periodSuffix(key) {
		return key.includes("-") ? key.split("-")[1] : key;
	}
	function computeDueDate(rule, period) {
		const [kind, arg] = rule.split(":");
		const [ey, em] = period.end.split("-").map(Number);
		switch (kind) {
			case "NEXT_MONTH_DAY": {
				const day = Number(arg);
				const y = em === 12 ? ey + 1 : ey;
				const m = em === 12 ? 1 : em + 1;
				return ymd(y, m, Math.min(day, lastDayOfMonth(y, m)));
			}
			case "DAYS_AFTER": return addDays(period.end, Number(arg));
			case "NEXT_DATE": {
				const candidates = [];
				for (const md of arg.split("|")) {
					const [m, d] = md.split("-").map(Number);
					for (const y of [ey, ey + 1]) candidates.push(ymd(y, m, Math.min(d, lastDayOfMonth(y, m))));
				}
				return candidates.filter((c) => c > period.end).sort()[0];
			}
			default: throw new Error(`Unrecognized due rule: ${rule}`);
		}
	}
	function describeDueRule(rule) {
		const [kind, arg] = rule.split(":");
		if (kind === "NEXT_MONTH_DAY") return `On or before the ${ordinal(+arg)} of the following month`;
		if (kind === "DAYS_AFTER") return `Within ${arg} days after the period ends`;
		if (kind === "NEXT_DATE") return "On or before " + arg.split("|").map((md) => {
			const [m, d] = md.split("-").map(Number);
			return `${MONTHS[m - 1]} ${d}`;
		}).join(" / ");
		return rule;
	}
	function ordinal(n) {
		const s = [
			"th",
			"st",
			"nd",
			"rd"
		], v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	}
	const DONE_STATUSES = ["approved", "not_applicable"];
	function itemKey(reportCode, unitCode, periodKey) {
		return `${reportCode}|${unitCode}|${periodKey}`;
	}
	/**
	* Every report each office is expected to submit, merged with what has
	* actually been uploaded. Items that nobody has acted on yet have no
	* database row and come back with status "missing".
	*/
	function buildChecklist(input) {
		const { reportTypes, units, submissions, today, trackingStart, reminderDays } = input;
		const unitByCode = new Map(units.map((u) => [u.code, u]));
		const reportByCode = new Map(reportTypes.map((r) => [r.code, r]));
		const rows = new Map(submissions.map((s) => [itemKey(s.reportCode, s.unitCode, s.periodKey), s]));
		const items = /* @__PURE__ */ new Map();
		const make = (report, unit, period, row) => {
			const dueDate = row?.dueDate ?? computeDueDate(report.dueRule, period);
			const status = row?.status ?? "missing";
			const done = DONE_STATUSES.includes(status);
			const daysLeft = daysBetween(today, dueDate);
			let urgency;
			if (done) urgency = "done";
			else if (daysLeft < 0) urgency = "overdue";
			else if (daysLeft === 0) urgency = "today";
			else if (daysLeft <= reminderDays) urgency = "soon";
			else urgency = "upcoming";
			const late = status === "approved" && !!row?.approvedAt && row.approvedAt.slice(0, 10) > dueDate;
			return {
				key: itemKey(report.code, unit.code, period.key),
				report,
				unit,
				period,
				dueDate,
				daysLeft,
				status,
				submission: row,
				done,
				urgency,
				late
			};
		};
		for (const report of reportTypes) {
			if (!report.active) continue;
			for (const period of periodsBetween(report.frequency, trackingStart, today)) {
				if (period.end < trackingStart) continue;
				if (report.periods && report.periods.length && !report.periods.includes(periodSuffix(period.key))) continue;
				for (const unitCode of report.appliesTo) {
					const unit = unitByCode.get(unitCode);
					if (!unit) continue;
					const key = itemKey(report.code, unit.code, period.key);
					items.set(key, make(report, unit, period, rows.get(key) ?? null));
				}
			}
		}
		for (const [key, row] of rows) {
			if (items.has(key)) continue;
			if (periodFromKey(row.periodKey).start > today) continue;
			const report = reportByCode.get(row.reportCode);
			const unit = unitByCode.get(row.unitCode);
			if (!report || !unit) continue;
			items.set(key, make(report, unit, periodFromKey(row.periodKey), row));
		}
		return [...items.values()].sort(compareItems);
	}
	function compareItems(a, b) {
		return a.dueDate.localeCompare(b.dueDate) || a.report.sort - b.report.sort || a.unit.sort - b.unit.sort;
	}
	/** Items that should appear in today's reminder: not done and due within reminderDays (or overdue). */
	function reminderItems(items, reminderDays) {
		return items.filter((i) => !i.done && i.daysLeft <= reminderDays);
	}
	function countdownLabel(item) {
		if (item.done) return "—";
		const d = item.daysLeft;
		if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
		if (d === 0) return "Due today";
		if (d === 1) return "1 day left";
		return `${d} days left`;
	}
	const STATUS_LABELS = {
		missing: "Not uploaded",
		for_review: "For review",
		returned: "Returned",
		approved: "Released to COA",
		not_applicable: "Not applicable"
	};
	const DEFAULT_UNITS = [
		{
			code: "SDO",
			name: "SDO Basilan (Division Office)",
			sort: 1
		},
		{
			code: "BNHS",
			name: "Basilan NHS",
			sort: 2
		},
		{
			code: "BEGANG",
			name: "Begang NHS",
			sort: 3
		},
		{
			code: "CONSO",
			name: "Consolidated",
			sort: 4
		}
	];
	const ALL = DEFAULT_UNITS.map((u) => u.code);
	const FUNDS = [{code:"REGULAR",name:"Regular Fund"},{code:"PROVIDENT",name:"Provident Fund"},{code:"TRUST",name:"Trust Fund"}];
	const DEFAULT_REPORT_TYPES = [
		{
			code: "MTB",
			sort: 10,
			frequency: "MONTHLY",
			category: "Monthly",
			dueRule: "NEXT_MONTH_DAY:10",
			name: "Monthly Pre-Closing Trial Balance",
			description: "Detailed pre-closing trial balance per Fund Cluster (01 Regular Agency, 02 NCBA/Special, 07 Trust)."
		},
		{
			code: "RCI",
			sort: 11,
			frequency: "MONTHLY",
			category: "Monthly",
			dueRule: "NEXT_MONTH_DAY:10",
			name: "Report of Checks Issued (RCI) / SLCIC",
			description: "Summary of checks issued against MDS and commercial bank accounts, with paid vouchers and supporting documents."
		},
		{
			code: "RADA",
			sort: 12,
			frequency: "MONTHLY",
			category: "Monthly",
			dueRule: "NEXT_MONTH_DAY:10",
			name: "Report of Advice to Debit Account Issued (RADA)",
			description: "Summary of direct bank transfers / ADA payments for payroll, suppliers, and downloads."
		},
		{
			code: "BRS",
			sort: 13,
			frequency: "MONTHLY",
			category: "Monthly",
			dueRule: "NEXT_MONTH_DAY:20",
			name: "Bank Reconciliation Statements",
			description: "Reconciliations for all operational bank accounts (MDS, LDDAP-ADA, high school / division accounts) with bank statements and paid vouchers."
		},
		{
			code: "FAR4",
			sort: 14,
			frequency: "MONTHLY",
			category: "Monthly",
			dueRule: "NEXT_MONTH_DAY:10",
			name: "FAR No. 4 – Monthly Report of Disbursements",
			description: "Actual disbursements broken down by Personnel Services, MOOE, and Capital Outlay."
		},
		{
			code: "QFS",
			sort: 20,
			frequency: "QUARTERLY",
			category: "Quarterly",
			dueRule: "DAYS_AFTER:10",
			name: "Quarterly Financial Statements",
			description: "Statement of Financial Position, Financial Performance, Changes in Net Assets/Equity, Cash Flows (Direct), and Comparison of Budget and Actual Amounts."
		},
		{
			code: "QTB",
			sort: 21,
			frequency: "QUARTERLY",
			category: "Quarterly",
			dueRule: "DAYS_AFTER:10",
			name: "Quarterly Trial Balances & Supporting Schedules",
			description: "Detailed trial balance and schedules for Accounts Receivable, Accounts Payable, SL balances, and advances to ODA/employees."
		},
		{
			code: "FAR1",
			sort: 22,
			frequency: "QUARTERLY",
			category: "Quarterly",
			dueRule: "DAYS_AFTER:30",
			name: "FAR No. 1 – SAAODB",
			description: "Statement of Appropriations, Allotments, Obligations, Disbursements and Balances. Submitted via DBM-COA URS."
		},
		{
			code: "FAR1A",
			sort: 23,
			frequency: "QUARTERLY",
			category: "Quarterly",
			dueRule: "DAYS_AFTER:30",
			name: "FAR No. 1-A – Summary by Object of Expenditures",
			description: "Summary of Appropriations, Allotments, Obligations, Disbursements and Balances by Object of Expenditures."
		},
		{
			code: "FAR1B",
			sort: 24,
			frequency: "QUARTERLY",
			category: "Quarterly",
			dueRule: "DAYS_AFTER:30",
			name: "FAR No. 1-B – Allotments and Sub-Allotments Received",
			description: "List of Allotments and Sub-Allotments Received (Sub-ARO from DepEd Central/Regional Office)."
		},
		{
			code: "FAR1C",
			sort: 25,
			frequency: "QUARTERLY",
			category: "Quarterly",
			dueRule: "DAYS_AFTER:30",
			name: "FAR No. 1-C – Off-Budget Funds",
			description: "Statement of Obligations, Disbursements, Liquidations and Unliquidated Obligations for Off-Budget Funds."
		},
		{
			code: "FAR2",
			sort: 26,
			frequency: "QUARTERLY",
			category: "Quarterly",
			dueRule: "DAYS_AFTER:30",
			name: "FAR No. 2 & 2-A",
			description: "Statement of Approved Budget, Utilizations, Disbursements and Balances (Off-Budget Funds / Trust Receipts)."
		},
		{
			code: "FAR5",
			sort: 27,
			frequency: "QUARTERLY",
			category: "Quarterly",
			dueRule: "DAYS_AFTER:30",
			name: "FAR No. 5 – Revenue and Other Receipts",
			description: "Quarterly Report of Revenue and Other Receipts."
		},
		{
			code: "UCA",
			sort: 30,
			frequency: "SEMIANNUAL",
			category: "Semi-annual",
			dueRule: "NEXT_DATE:07-15|01-15",
			name: "Status of Unliquidated Cash Advances",
			description: "Consolidated listing and aging of outstanding cash advances (disbursing officers, field officers, principals’ MOOE, travel)."
		},
		{
			code: "APAR",
			sort: 31,
			frequency: "SEMIANNUAL",
			category: "Semi-annual",
			dueRule: "NEXT_DATE:07-15",
			periods: ["S1"],
			name: "Statements of Accounts Payable & Accounts Receivable",
			description: "Aging list and details of outstanding liabilities and receivables (1st semester)."
		},
		{
			code: "YFS",
			sort: 40,
			frequency: "ANNUAL",
			category: "Annual",
			dueRule: "NEXT_DATE:01-20",
			name: "Year-End Financial Statements",
			description: "Full set of financial statements (condensed and detailed) per Fund Cluster."
		},
		{
			code: "YTB",
			sort: 41,
			frequency: "ANNUAL",
			category: "Annual",
			dueRule: "NEXT_DATE:01-20",
			name: "Pre-Closing & Post-Closing Trial Balances",
			description: "Final pre-closing and post-closing trial balances with journal entry vouchers (JEVs) attached."
		},
		{
			code: "NOTES",
			sort: 42,
			frequency: "ANNUAL",
			category: "Annual",
			dueRule: "NEXT_DATE:01-20",
			name: "Notes to Financial Statements",
			description: "Narrative disclosures: accounting policies, breakdowns of major accounts, contingent liabilities. (May be extended to Jan 31 per regional guidelines.)"
		},
		{
			code: "FAR3",
			sort: 43,
			frequency: "ANNUAL",
			category: "Annual",
			dueRule: "NEXT_DATE:01-30",
			name: "FAR No. 3 – Aging of Unpaid Obligations",
			description: "Breakdown of Accounts Payable and Due and Demandable Obligations at year-end."
		},
		{
			code: "RPCPPE",
			sort: 44,
			frequency: "ANNUAL",
			category: "Annual",
			dueRule: "NEXT_DATE:01-31",
			name: "Report on the Physical Count of PPE (RPCPPE)",
			description: "Physical inventory of school buildings, ICT equipment, learning materials, motor vehicles and machinery (with the Supply Officer)."
		},
		{
			code: "RPCI",
			sort: 45,
			frequency: "ANNUAL",
			category: "Annual",
			dueRule: "NEXT_DATE:01-31",
			name: "Report on the Physical Count of Inventories (RPCI)",
			description: "Physical inventory of office supplies, textbooks, learning modules and semi-expendable property."
		},
		{code:"FAR4_URS",sort:15,frequency:"MONTHLY",category:"Monthly",dueRule:"NEXT_MONTH_DAY:10",name:"URS-generated FAR No. 4",description:"Submit the URS-generated FAR No. 4 separately from the regular FAR No. 4."}
	].flatMap(d => FUNDS.map(f => ({...d,code:d.code+(f.code==='REGULAR'?'':'_'+f.code),fundCode:f.code,name:d.name+' - '+f.name}))).map((d) => ({
		...d,
		periods: d.periods ?? null,
		appliesTo: [...ALL],
		active: true
	}));
	/** Reports whose spreadsheet should be checked for Debit = Credit. */
	const TRIAL_BALANCE_CODES = [
		"MTB",
		"QTB",
		"YTB"
	].flatMap(code => FUNDS.map(f => code+(f.code==='REGULAR'?'':'_'+f.code)));
	/** Words in file names / sheet headers that identify each office. */
	const UNIT_ALIASES = {
		SDO: [
			"sdo",
			"division office",
			"schools division"
		],
		BNHS: [
			"basilan nhs",
			"basilan national",
			"bnhs"
		],
		BEGANG: ["begang"],
		CONSO: ["conso", "consolidated"]
	};
	exports.FUNDS = FUNDS;
	exports.DEFAULT_REPORT_TYPES = DEFAULT_REPORT_TYPES;
	exports.DEFAULT_UNITS = DEFAULT_UNITS;
	exports.DONE_STATUSES = DONE_STATUSES;
	exports.STATUS_LABELS = STATUS_LABELS;
	exports.TRIAL_BALANCE_CODES = TRIAL_BALANCE_CODES;
	exports.UNIT_ALIASES = UNIT_ALIASES;
	exports.addDays = addDays;
	exports.buildChecklist = buildChecklist;
	exports.compareItems = compareItems;
	exports.computeDueDate = computeDueDate;
	exports.countdownLabel = countdownLabel;
	exports.daysBetween = daysBetween;
	exports.describeDueRule = describeDueRule;
	exports.formatDate = formatDate;
	exports.formatLongDate = formatLongDate;
	exports.itemKey = itemKey;
	exports.periodFromKey = periodFromKey;
	exports.periodsBetween = periodsBetween;
	exports.reminderItems = reminderItems;
	exports.todayManila = todayManila;
	return exports;
})({});
if(typeof module!=='undefined')module.exports=CoaSchedule;
