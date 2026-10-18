// COA schedule checks. Run: node coa/test.js
const assert = require('node:assert/strict')
const C = require('./schedule')

const due = (rule, key) => C.computeDueDate(rule, C.periodFromKey(key))

// Due dates from "Reports to be submitted to COA"
assert.equal(due('NEXT_MONTH_DAY:10', '2026-09'), '2026-10-10')
assert.equal(due('NEXT_MONTH_DAY:20', '2026-09'), '2026-10-20')
assert.equal(due('NEXT_MONTH_DAY:10', '2026-12'), '2027-01-10')
assert.equal(due('DAYS_AFTER:10', '2026-Q3'), '2026-10-10')
assert.equal(due('DAYS_AFTER:30', '2026-Q3'), '2026-10-30')
assert.equal(due('DAYS_AFTER:30', '2026-Q4'), '2027-01-30')
assert.equal(due('NEXT_DATE:07-15|01-15', '2026-S1'), '2026-07-15')
assert.equal(due('NEXT_DATE:07-15|01-15', '2026-S2'), '2027-01-15')
assert.equal(due('NEXT_DATE:01-20', '2026'), '2027-01-20')
assert.equal(due('NEXT_DATE:01-31', '2026'), '2027-01-31')

// Periods
assert.equal(C.periodFromKey('2024-02').end, '2024-02-29')
assert.equal(C.periodFromKey('2026-Q3').label, 'Q3 2026 (Jul–Sep)')
assert.deepEqual(C.periodsBetween('MONTHLY', '2026-11-15', '2027-01-03').map((p) => p.key), ['2026-11', '2026-12', '2027-01'])

// Checklist: every office, every expected report, merged with uploads
const base = {
  reportTypes: C.DEFAULT_REPORT_TYPES, units: C.DEFAULT_UNITS,
  today: '2026-10-18', trackingStart: '2026-09-01', horizonDays: 45, reminderDays: 10,
}
const items = C.buildChecklist({ ...base, submissions: [] })
const byKey = new Map(items.map((i) => [i.key, i]))
for (const u of ['SDO', 'BNHS', 'BEGANG', 'CONSO']) {
  for (const k of [`MTB|${u}|2026-09`, `BRS|${u}|2026-09`, `QFS|${u}|2026-Q3`, `FAR1|${u}|2026-Q3`, `MTB|${u}|2026-10`]) {
    assert(byKey.has(k), `expected ${k}`)
  }
}
assert(![...byKey.keys()].some((k) => k.endsWith('|2026-08')), 'nothing before tracking start')
assert(![...byKey.keys()].some((k) => k.startsWith('APAR|')), 'AP/AR is 1st semester only')
assert.equal(byKey.get('MTB|SDO|2026-09').urgency, 'overdue')
assert.equal(C.countdownLabel(byKey.get('MTB|SDO|2026-09')), '8 days overdue')
assert.equal(byKey.get('BRS|SDO|2026-09').daysLeft, 2)
assert.equal(byKey.get('FAR1|SDO|2026-Q3').urgency, 'upcoming')

// Approval stops the countdown; late approval is flagged
const approved = {
  id: '1', reportCode: 'MTB', unitCode: 'SDO', periodKey: '2026-09', periodLabel: 'September 2026',
  dueDate: '2026-10-10', status: 'approved', reviewNote: null, reviewedBy: 'x',
  reviewedAt: '2026-10-12T01:00:00Z', approvedAt: '2026-10-12T01:00:00Z', updatedAt: '2026-10-12T01:00:00Z',
}
const after = C.buildChecklist({ ...base, submissions: [approved] })
const mtb = after.find((i) => i.key === 'MTB|SDO|2026-09')
assert(mtb.done && mtb.late)
const reminders = C.reminderItems(after, 10)
assert(!reminders.some((i) => i.key === mtb.key))
assert(reminders.every((i) => !i.done && i.daysLeft <= 10))

// Philippine date regardless of PC timezone
assert.equal(C.todayManila(new Date('2026-10-17T16:30:00Z')), '2026-10-18')

// Backlog and fund isolation: approval of one fund never completes another.
const backlog = C.buildChecklist({...base, trackingStart:'2026-01-01', submissions:[]})
for (const code of ['MTB','MTB_PROVIDENT','MTB_TRUST','FAR4','FAR4_URS']) {
  assert(backlog.some(i => i.key === `${code}|SDO|2026-01`), `January entry for ${code}`)
}
assert(backlog.every(i => i.period.start <= base.today), 'no future reporting periods')
assert.deepEqual([...new Set(backlog.filter(i => i.report.code === 'MTB').map(i => i.period.key))].sort(),
  Array.from({length:10}, (_,i) => `2026-${String(i+1).padStart(2,'0')}`))
const earlyMonth = C.buildChecklist({...base, today:'2026-10-01', horizonDays:1, submissions:[]})
assert(earlyMonth.some(i => i.key === 'MTB|SDO|2026-10'), 'current month available regardless of due date')
const futureRow = {...approved, periodKey:'2026-12'}
assert(!C.buildChecklist({...base, submissions:[futureRow]}).some(i => i.period.key === '2026-12'))
const separated = C.buildChecklist({...base, trackingStart:'2026-01-01', submissions:[approved]})
assert(separated.find(i => i.key === 'MTB|SDO|2026-09').done)
assert.equal(separated.find(i => i.key === 'MTB_TRUST|SDO|2026-09').status, 'missing')
assert(C.TRIAL_BALANCE_CODES.includes('MTB_PROVIDENT'))
assert.equal(new Set(C.DEFAULT_REPORT_TYPES.map(r=>r.code)).size, C.DEFAULT_REPORT_TYPES.length)
console.log('COA schedule checks passed')

require('./test-submissions')
