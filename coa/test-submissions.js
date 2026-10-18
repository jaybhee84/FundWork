// Pre-check and submission workflow checks. Run via: node coa/test.js
const assert = require('node:assert/strict')
const S = require('./schedule')
const P = require('./precheck')
const D = require('./demo-source')

const today = '2026-10-18'
const items = S.buildChecklist({ reportTypes: S.DEFAULT_REPORT_TYPES, units: S.DEFAULT_UNITS, submissions: [], today, trackingStart: '2026-09-01', horizonDays: 45, reminderDays: 10 })
const item = (k) => items.find((i) => i.key === k)
const mtb = item('MTB|BNHS|2026-09'), rci = item('RCI|SDO|2026-09'), qfs = item('QFS|SDO|2026-Q3')
const codes = (r) => r.findings.map((f) => f.code)
const run = (o) => P.precheck({ today, units: S.DEFAULT_UNITS, existingFiles: [], ...o })

// Amounts are parsed to integer centavos
assert.equal(P.amount(1234.56), 123456)
assert.equal(P.amount('1,234.56'), 123456)
assert.equal(P.amount('(500.00)'), -50000)
assert.equal(P.amount('-'), 0)
assert.equal(P.amount(0.1 + 0.2), 30)
assert.throws(() => P.amount('abc'))
assert.equal(P.peso(-123456789), '-1,234,567.89')

// Blocking checks
assert(run({ file: { name: 'a.pdf', size: 0 }, item: rci }).blocked)
assert(run({ file: { name: 'a.pdf', size: P.MAX_BYTES + 1 }, item: rci }).blocked)
assert(!run({ file: { name: 'a.pdf', size: P.MAX_BYTES }, item: rci }).blocked)

// File type, duplicates, lateness
assert(codes(run({ file: { name: 'rci.exe', size: 10 }, item: rci })).includes('FILE_TYPE'))
const dup = run({ file: { name: 'x.pdf', size: 10, sha256: 'abc' }, item: rci, existingFiles: [{ sha256: 'abc', name: 'old.pdf', itemKey: 'RCI|BNHS|2026-09', label: 'RCI · Basilan NHS · September 2026' }] })
assert(codes(dup).includes('DUPLICATE') && dup.findings.find((f) => f.code === 'DUPLICATE').detail.includes('Basilan NHS'))
assert(codes(run({ file: { name: 'x.pdf', size: 10, sha256: 'abc' }, item: rci, existingFiles: [{ sha256: 'abc', name: 'old.pdf', itemKey: rci.key, label: '' }] })).includes('DUPLICATE_SAME_ITEM'))
assert(codes(run({ file: { name: 'x.pdf', size: 10 }, item: rci })).includes('LATE')) // due Oct 10
assert(!codes(run({ file: { name: 'x.pdf', size: 10 }, item: qfs, today: '2026-10-05' })).includes('LATE'))

// Office and period in the file name
assert(codes(run({ file: { name: 'RCI_Begang_Sep2026.pdf', size: 10 }, item: rci })).includes('OFFICE_MISMATCH'))
assert(!codes(run({ file: { name: 'RCI_SDO_Sep2026.pdf', size: 10 }, item: rci })).includes('OFFICE_MISMATCH'))
assert(codes(run({ file: { name: 'RCI_BeNHS_Sep2026.pdf', size: 10 }, item: rci })).includes('OFFICE_MISMATCH'), 'BeNHS = Begang NHS')
assert(codes(run({ file: { name: 'RCI SDO October 2026.pdf', size: 10 }, item: rci })).includes('PERIOD_MISMATCH'))
assert(codes(run({ file: { name: 'RCI SDO Sept 2025.pdf', size: 10 }, item: rci })).includes('YEAR_MISMATCH'))
assert.deepEqual(codes(run({ file: { name: 'RCI SDO September 2026.pdf', size: 10 }, item: rci, today: '2026-10-09' })), [])
assert(codes(run({ file: { name: 'QFS SDO Q2 2026.xlsx', size: 10 }, item: qfs })).includes('PERIOD_MISMATCH'))
assert(!codes(run({ file: { name: 'QFS SDO Q3 2026 (Jul-Sep).xlsx', size: 10 }, item: qfs })).includes('PERIOD_MISMATCH'))

// Sheet header: a school's TB naming the Schools Division is fine; naming another school is not
const header = (office, month) => [[`Schools Division of Basilan`], [office], [`Pre-closing Trial Balance`], [`As of ${month} 30, 2026`], [], ['Account Code', 'Account Title', 'Debit', 'Credit']]
const tb = (rows) => [{ name: 'TB', rows }]
const okTb = tb([...header('Basilan National High School', 'September'), ['10101010', 'Cash', 1000.1, ''], ['30101010', 'Equity', '', '1,000.10'], ['', 'TOTAL', 1000.1, 1000.1]])
let r = run({ file: { name: 'MTB.xlsx', size: 10 }, item: mtb, sheets: okTb })
assert(!codes(r).includes('OFFICE_MISMATCH') && !codes(r).includes('PERIOD_MISMATCH'), JSON.stringify(r))
assert(codes(r).includes('TB_BALANCED'))
r = run({ file: { name: 'MTB.xlsx', size: 10 }, item: mtb, sheets: tb([...header('Begang National High School', 'August'), ['1', 'Cash', 5, ''], ['2', 'Equity', '', 5]]) })
assert(codes(r).includes('OFFICE_MISMATCH') && codes(r).includes('PERIOD_MISMATCH'))

// Letterhead alone is not an office claim
const conso = item('MTB|CONSO|2026-09')
assert(!codes(run({ file: { name: 'MTB.xlsx', size: 10 }, item: conso, sheets: tb([['Schools Division of Basilan'], ['Pre-closing Trial Balance']]) })).includes('OFFICE_MISMATCH'))
r = run({ file: { name: 'MTB.xlsx', size: 10 }, item: conso, sheets: tb([['Schools Division of Basilan'], ['Begang National High School']]) })
assert(r.findings.find((f) => f.code === 'OFFICE_MISMATCH').detail.startsWith('It mentions Begang NHS,'))
assert(codes(run({ file: { name: 'MTB SDO.xlsx', size: 10 }, item: conso })).includes('OFFICE_MISMATCH'))

// Trial balance footing
r = run({ file: { name: 'MTB.csv', size: 10 }, item: mtb, sheets: tb([['Debit', 'Credit'], [100.25, ''], ['', 100]]) })
assert(codes(r).includes('TB_UNBALANCED') && r.findings.find((f) => f.code === 'TB_UNBALANCED').detail.includes('Difference 0.25'))
r = run({ file: { name: 'MTB.xlsx', size: 10 }, item: mtb, sheets: tb([['Code', 'Debit', 'Credit'], ['1', 100, ''], ['2', '', 100], ['Total', 100, 90]]) })
assert(codes(r).includes('TB_TOTAL_MISMATCH') && codes(r).includes('TB_BALANCED'))
// Subtotals per section and a grand total both foot
r = run({ file: { name: 'MTB.xlsx', size: 10 }, item: mtb, sheets: tb([['Code', 'Debit', 'Credit'], ['1', 60, ''], ['Sub-total', 60, 0], ['2', 40, ''], ['3', '', 100], ['Subtotal', 40, 100], ['GRAND TOTAL', 100, 100]]) })
assert(!codes(r).includes('TB_TOTAL_MISMATCH'), JSON.stringify(r.findings))
assert(codes(run({ file: { name: 'MTB.xlsx', size: 10 }, item: mtb, sheets: tb([['Account', 'Amount'], ['Cash', 5]]) })).includes('TB_NO_HEADER'))
assert(codes(run({ file: { name: 'MTB.xlsx', size: 10 }, item: mtb, sheets: null, readError: 'Corrupt file' })).includes('UNREADABLE'))
assert(codes(run({ file: { name: 'MTB.pdf', size: 10 }, item: mtb })).includes('TB_NOT_CHECKED'))
r = run({ file: { name: 'MTB.xlsx', size: 10 }, item: mtb, sheets: tb([['Debit', 'Credit'], [10, ''], ['n/a', 10]]) })
assert(codes(r).includes('TB_BAD_CELLS'))

// Workflow rules
;(async () => {
  let t = 0
  const src = D.createDemoSource({ today, seed: false, now: () => new Date(Date.UTC(2026, 9, 18, 0, 0, t++)).toISOString() })
  for (const k of D.INTERFACE) assert.equal(typeof src[k], 'function', `interface: ${k}`)
  const slot = { reportCode: 'MTB', unitCode: 'BNHS', periodKey: '2026-09' }, key = 'MTB|BNHS|2026-09'
  const file = { name: 'MTB.xlsx', size: 10, sha256: 'h1', precheck: { findings: [], blocked: false } }
  const status = async () => (await src.listSubmissions()).find((s) => s.key === key)?.status

  await src.switchUser('benhs.bookkeeper@demo.local') // Begang NHS only
  await assert.rejects(src.setNotApplicable(slot, 'Not required'), /this office/)
  const naSlot={reportCode:'FAR4_TRUST',unitCode:'BEGANG',periodKey:'2026-01'}
  await assert.rejects(src.setNotApplicable(naSlot, ''), /reason/)
  await src.setNotApplicable(naSlot, 'No applicable transactions')
  const naItems=S.buildChecklist({reportTypes:S.DEFAULT_REPORT_TYPES,units:S.DEFAULT_UNITS,submissions:await src.listSubmissions(),today,trackingStart:'2026-01-01',reminderDays:10})
  assert(naItems.find(i=>i.key==='FAR4_TRUST|BEGANG|2026-01').done)
  assert(!S.reminderItems(naItems,10).some(i=>i.key==='FAR4_TRUST|BEGANG|2026-01'))
  await assert.rejects(src.submitFiles({ ...slot, files: [file] }), /not assigned/)
  await src.switchUser('bnhs.bookkeeper@demo.local')
  await assert.rejects(src.submitFiles({ ...slot, files: [{ ...file, precheck: { blocked: true } }] }), /pre-check/)
  await src.submitFiles({ ...slot, files: [file] })
  assert.equal(await status(), 'for_review')
  await assert.rejects(src.approve(key), /Division Accountant/)

  await src.switchUser('accountant@demo.local')
  await assert.rejects(src.returnForRevision(key, '  '), /note/)
  await src.returnForRevision(key, 'Wrong month')
  assert.equal(await status(), 'returned')
  await assert.rejects(src.approve(key), /waiting for review/)

  await src.switchUser('bnhs.bookkeeper@demo.local')
  const [f1] = await src.listFiles()
  await src.removeFile(f1.id, 'Wrong month')
  assert.equal((await src.listFiles()).find((f) => f.id === f1.id).supersededAt !== null, true, 'removed files are kept, not deleted')
  await assert.rejects(src.resubmit(key), /corrected file/)
  await src.submitFiles({ ...slot, files: [{ ...file, sha256: 'h2' }] })
  assert.equal(await status(), 'for_review')

  await src.switchUser('coa@demo.local')
  assert.equal((await src.listSubmissions()).length, 0, 'COA sees nothing before approval')
  await src.switchUser('accountant@demo.local')
  await src.approve(key)
  assert.equal(await status(), 'approved')
  await src.switchUser('bnhs.bookkeeper@demo.local')
  await assert.rejects(src.submitFiles({ ...slot, files: [file] }), /reopen/)
  await src.switchUser('coa@demo.local')
  assert.equal((await src.listSubmissions()).length, 1)
  assert.equal((await src.listFiles()).length, 1, 'COA sees only current files of approved items')
  assert.equal((await src.listActivity()).length, 0)

  await src.switchUser('accountant@demo.local')
  await assert.rejects(src.reopen(key, ''), /reason/)
  await src.reopen(key, 'Revised TB received')
  assert.equal(await status(), 'for_review')
  await src.switchUser('coa@demo.local')
  assert.equal((await src.listSubmissions()).length, 0, 'COA loses access after reopen')

  await src.switchUser('accountant@demo.local')
  await src.setNotApplicable({ reportCode: 'RADA', unitCode: 'CONSO', periodKey: '2026-09' }, 'Not required')
  const merged = S.buildChecklist({ reportTypes: S.DEFAULT_REPORT_TYPES, units: S.DEFAULT_UNITS, submissions: await src.listSubmissions(), today, trackingStart: '2026-09-01', horizonDays: 45, reminderDays: 10 })
  assert(merged.find((i) => i.key === 'RADA|CONSO|2026-09').done)
  const actions = (await src.listActivity(key)).map((e) => e.action).reverse()
  assert.deepEqual(actions, ['upload', 'return', 'remove', 'upload', 'resubmit', 'approve', 'reopen'])

  // Resubmitting a returned item with its remaining files
  await src.switchUser('benhs.bookkeeper@demo.local')
  const s2 = { reportCode: 'RCI', unitCode: 'BEGANG', periodKey: '2026-09' }, k2 = 'RCI|BEGANG|2026-09'
  await src.submitFiles({ ...s2, files: [file, { ...file, name: 'wrong.pdf', sha256: 'h3' }] })
  await assert.rejects(src.resubmit(k2), /returned/)
  await src.switchUser('accountant@demo.local')
  await src.returnForRevision(k2, 'Remove wrong.pdf')
  await src.switchUser('benhs.bookkeeper@demo.local')
  await src.removeFile((await src.listFiles()).find((f) => f.itemKey === k2 && f.name === 'wrong.pdf').id)
  await src.resubmit(k2)
  assert.equal((await src.listSubmissions()).find((s) => s.key === k2).status, 'for_review')

  // The seeded demo is internally consistent
  const demo = D.createDemoSource({ today, session: 'accountant@demo.local' })
  const subs = await demo.listSubmissions()
  assert.deepEqual(subs.map((s) => s.status).sort(), ['approved', 'approved', 'for_review', 'for_review', 'not_applicable', 'returned'])
  assert(subs.every((s) => s.updatedAt <= new Date().toISOString()))

  // Sign-in: email + password
  let ms = 0
  const auth = D.createDemoSource({ today, nowMs: () => ms })
  assert.equal(await auth.getSession(), null, 'signed out by default')
  await assert.rejects(auth.listSubmissions(), /Sign in/)
  await assert.rejects(auth.signIn('not-an-email', 'x'), /valid email/)
  await assert.rejects(auth.signIn('stranger@deped.gov.ph', 'x'), /not on the allowed list/)
  await assert.rejects(auth.signIn('bnhs.bookkeeper@demo.local', 'wrong'), /4 attempts left/)
  const me = await auth.signIn('  BNHS.Bookkeeper@Demo.Local ', D.DEMO_PASSWORD)
  assert.equal(me.role, 'uploader'); assert.equal(D.ROLES[me.role], 'Senior Bookkeeper')
  assert(!('password' in me), 'passwords are never returned')
  await assert.rejects(auth.changePassword('wrong', 'newpass99'), /current password/)
  await assert.rejects(auth.changePassword(D.DEMO_PASSWORD, 'short1'), /8 characters/)
  await assert.rejects(auth.changePassword(D.DEMO_PASSWORD, 'lettersonly'), /letters and numbers/)
  await auth.changePassword(D.DEMO_PASSWORD, 'newpass99')
  await auth.signOut()
  assert.equal(await auth.getSession(), null)
  await assert.rejects(auth.signIn('bnhs.bookkeeper@demo.local', D.DEMO_PASSWORD), /Incorrect/)
  await auth.signIn('bnhs.bookkeeper@demo.local', 'newpass99'); await auth.signOut()
  for (let n = 0; n < 4; n++) await assert.rejects(auth.signIn('coa@demo.local', 'bad'))
  await assert.rejects(auth.signIn('coa@demo.local', 'bad'), /locked/)
  await assert.rejects(auth.signIn('coa@demo.local', D.DEMO_PASSWORD), /Try again/, 'lock holds even with the right password')
  ms += 5 * 60 * 1000 + 1
  await auth.signIn('coa@demo.local', D.DEMO_PASSWORD); await auth.signOut()
  // Forgot password: the Division Accountant sets a temporary password; it must be changed at sign-in
  await assert.rejects(auth.resetMemberPassword('bnhs.bookkeeper@demo.local', 'temp1234'), /Sign in/)
  await auth.signIn('bnhs.bookkeeper@demo.local', 'newpass99')
  await assert.rejects(auth.resetMemberPassword('benhs.bookkeeper@demo.local', 'temp1234'), /manage access/, 'bookkeepers cannot reset passwords')
  await auth.signOut()
  await auth.signIn('accountant@demo.local', D.DEMO_PASSWORD)
  await assert.rejects(auth.resetMemberPassword('accountant@demo.local', 'temp1234'), /Account settings/)
  await auth.saveMember({email:'bnhs.bookkeeper@demo.local',familyName:'Bazan',firstName:'Juan',base:'IU',unitCode:'BNHS',position:'Senior Bookkeeper'})
  assert.equal(D.resetPasswordFor({familyName:'Bazan',firstName:'Juan'}),'Bazan_J')
  await auth.resetMemberPassword('bnhs.bookkeeper@demo.local', 'temp1234')
  await auth.signOut()
  await assert.rejects(auth.signIn('bnhs.bookkeeper@demo.local', 'newpass99'), /Incorrect/, 'old password stops working')
  const tmp = await auth.signIn('bnhs.bookkeeper@demo.local', 'Bazan_J')
  assert.equal(tmp.mustChangePassword, true, 'temporary password must be changed')
  await auth.changePassword('Bazan_J', 'mine2026x')
  assert.equal((await auth.getSession()).mustChangePassword, false)
  await auth.signOut()
  assert.equal((await D.createDemoSource({ today, session: 'coa@demo.local' }).getSession()).role, 'coa')

  // Names: Family, First Middle with every word capitalised
  assert.equal(D.personName({ familyName: 'dela cruz', firstName: 'maria clara', middleName: 'd' }), 'Dela Cruz, Maria Clara D.')
  assert.equal(D.personName({ familyName: 'SANTOS', firstName: 'JUAN', middleName: '' }), 'Santos, Juan')
  assert.equal(D.personName({ familyName: "o'brien", firstName: 'ana', middleName: 'reyes' }), "O'Brien, Ana Reyes")

  // Access follows from where someone works
  assert.deepEqual(D.accessFor({ base: 'IU', unitCode: 'BEGANG' }), { role: 'uploader', offices: ['BEGANG'] })
  assert.deepEqual(D.accessFor({ base: 'SDO', position: 'Senior Bookkeeper' }), { role: 'uploader', offices: ['SDO', 'CONSO'] })
  assert.equal(D.accessFor({ base: 'SDO', position: 'Accountant' }).role, 'accountant')
  assert.equal(D.accessFor({ base: 'COA' }).role, 'coa')

  // Allowed users: only emails allowed by the Division Accountant or superadmin can register
  ms += 31000
  const reg = D.createDemoSource({ today, nowMs: () => ms, seed: false })
  await assert.rejects(reg.register({ familyName: 'santos', firstName: 'maria clara', middleName: 'd', email: 'maria@deped.gov.ph', password: 'maria2026' }), /not on the allowed list/)
  await reg.switchUser('bnhs.bookkeeper@demo.local')
  await assert.rejects(reg.saveMember({ email: 'maria@deped.gov.ph', familyName: 'Santos', firstName: 'Maria', base: 'IU', unitCode: 'BEGANG', position: 'Senior Bookkeeper' }), /manage access/)
  await reg.switchUser('accountant@demo.local')
  const allow = { email: 'maria@deped.gov.ph', familyName: 'santos', firstName: 'maria clara', middleName: 'd', base: 'IU', unitCode: 'BEGANG', position: 'Senior Bookkeeper' }
  await assert.rejects(reg.saveMember({ ...allow, familyName: '' }), /family name/)
  await assert.rejects(reg.saveMember({ ...allow, unitCode: 'SDO' }), /school/)
  await assert.rejects(reg.saveMember({ ...allow, position: 'Accountant' }), /position/)
  await assert.rejects(reg.saveMember({ ...allow, email: 'maria@gmail.com' }), /DepEd email/, 'IU staff use DepEd email')
  await assert.rejects(reg.saveMember({ ...allow, base: 'SDO', position: 'Senior Bookkeeper', email: 'maria@yahoo.com' }), /DepEd email/, 'SDO staff use DepEd email')
  await assert.rejects(reg.saveMember({ ...allow, base: 'SDO', position: 'Accountant' }), /superadmin/, 'only the superadmin allows an accountant')
  const maria0 = await reg.saveMember(allow)
  assert.equal(maria0.name, 'Santos, Maria Clara D.'); assert.equal(maria0.role, 'uploader'); assert.deepEqual(maria0.offices, ['BEGANG'])
  assert.equal((await reg.saveMember({ email: 'auditor.uno@coa.gov.ph', familyName: 'uno', firstName: 'auditor', base: 'COA', position: 'Auditor' })).role, 'coa', 'COA may use their own email')
  assert.equal((await reg.listMembers()).find((m) => m.email === 'maria@deped.gov.ph').registered, false)
  await assert.rejects(reg.resetMemberPassword('maria@deped.gov.ph', 'temp1234'), /not registered/)
  await reg.signOut()
  await assert.rejects(reg.signIn('maria@deped.gov.ph', 'x'), /Register/)
  await assert.rejects(reg.register({ familyName: 'santos', firstName: 'maria clara', middleName: 'd', email: 'maria@deped.gov.ph', password: '123456' }), /8 characters/)
  await assert.rejects(reg.register({ familyName: '', firstName: 'maria', email: 'maria@deped.gov.ph', password: 'maria2026' }), /family name/)
  const done = await reg.register({ familyName: 'santos', firstName: 'maria clara', middleName: 'd', email: 'Maria@DepEd.gov.ph', password: 'maria2026' })
  assert(done.registered && done.member.role === 'uploader')
  assert.equal(done.member.name, 'Santos, Maria Clara D.', 'registration saves the name, capitalised')
  await assert.rejects(reg.register({ familyName: 'santos', firstName: 'maria clara', middleName: 'd', email: 'maria@deped.gov.ph', password: 'other2026' }), /already registered/)
  const maria = await reg.signIn('maria@deped.gov.ph', 'maria2026')
  assert.deepEqual(maria.offices, ['BEGANG'])
  await reg.signOut()

  // Accountant rules
  await reg.switchUser('accountant@demo.local')
  await assert.rejects(reg.setMemberActive('accountant@demo.local', false), /own access/)
  await reg.setMemberActive('maria@deped.gov.ph', false)
  await assert.rejects(reg.signIn('maria@deped.gov.ph', 'maria2026'), /turned off/)
  await reg.enterSuperadmin()
  assert.equal((await reg.getSession()).role, 'superadmin')
  assert((await reg.listActivity()).length > 0, 'superadmin can read activity for View as (read-only)')
  assert(D.canReview(await reg.getSession()), 'superadmin can review reports')
  assert(D.canUpload(await reg.getSession(), 'BNHS'), 'superadmin can upload for every office')
  // Superadmin allows with email + role only; the name comes at registration and survives role changes
  const roleOnly = (email, key) => reg.saveMember({ email, ...D.ROLE_CHOICES.find(([k]) => k === key)[2] })
  const viaRole = await roleOnly('rolly@deped.gov.ph', 'bnhs')
  assert.equal(viaRole.name, 'rolly@deped.gov.ph'); assert.deepEqual(viaRole.offices, ['BNHS']); assert.equal(D.roleChoiceOf(viaRole), 'bnhs')
  await assert.rejects(reg.saveMember({ email: 'half@deped.gov.ph', familyName: 'only', base: 'IU', unitCode: 'BNHS', position: 'Senior Bookkeeper' }), /first name/)
  await reg.signOut()
  await reg.register({ email: 'rolly@deped.gov.ph', familyName: 'bautista', firstName: 'rolly', password: 'rolly2026' })
  await reg.enterSuperadmin()
  const moved = await roleOnly('rolly@deped.gov.ph', 'sdo')
  assert.equal(moved.name, 'Bautista, Rolly', 'changing the role keeps the registered name'); assert.deepEqual(moved.offices, ['SDO', 'CONSO'])
  assert.equal(D.roleChoiceOf(await roleOnly('coa.x@gmail.com', 'coa')), 'coa')
  await reg.saveMember({ email: 'acct2@deped.gov.ph', familyName: 'reyes', firstName: 'ana', base: 'SDO', position: 'Accountant' })
  await reg.saveMember({ email: 'acct2@deped.gov.ph', familyName: 'reyes', firstName: 'ana', base: 'COA', position: 'Auditor' })
  await assert.rejects(reg.saveMember({ email: 'accountant@demo.local', familyName: 'x', firstName: 'y', base: 'COA', position: 'Auditor' }), /must keep access/)

  console.log('COA pre-check and workflow checks passed')
})().catch((e) => { console.error(e); process.exit(1) })
