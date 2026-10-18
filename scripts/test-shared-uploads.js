// Live check of the upload → review → release path on the configured Supabase project.
// Uses a past period (January 2025) and throwaway accounts, then removes everything it created.
// Run: node scripts/test-shared-uploads.js   (needs SUPABASE_ACCESS_TOKEN and SUPABASE_SECRET_KEY in .env.supabase)
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const root = path.join(__dirname, '..')
globalThis.CoaDemo = require('../coa/demo-source')
const { createSupabaseSource } = require('../coa/supabase-source')
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'coa/supabase.config.json'), 'utf8'))
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.supabase'), 'utf8').split(/\r?\n/).map((l) => /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]))
const ref = new URL(cfg.url).hostname.split('.')[0]
const n = Date.now(), pw = crypto.randomBytes(16).toString('hex') + 'Ab1'
const admin = `fw-up-admin-${n}@example.com`, bk = `fw-up-bk-${n}@deped.gov.ph`, acct = `fw-up-acct-${n}@deped.gov.ph`, coa = `fw-up-coa-${n}@example.com`
const PERIOD = '2025-01'

async function sql(query) { const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }); if (!r.ok) throw Error('SQL failed: ' + r.status + ' ' + (await r.text())); return r.json() }
// Same request shape as the main-process handler in main.js (JSON, raw bytes for storage).
async function request(a) {
  const headers = { apikey: cfg.publishableKey, 'Content-Type': a.bytes ? 'application/octet-stream' : 'application/json' }
  if (a.token) headers.Authorization = 'Bearer ' + a.token
  const r = await fetch(cfg.url + a.path, { method: a.method || 'GET', headers, body: a.bytes ? Buffer.from(a.bytes) : a.body === undefined ? undefined : JSON.stringify(a.body) })
  if (a.raw) return r
  const b = await r.json().catch(() => null)
  if (!r.ok) throw Error(b?.msg || b?.message || b?.error_description || b?.error || 'Request failed: ' + r.status)
  return b
}

async function main() {
  let objects = []
  try {
    await sql(`insert into public.members(email,name,role) values ('${admin}','Upload Test','superadmin')`)
    await request({ path: '/auth/v1/signup', method: 'POST', body: { email: admin, password: pw } })
    const sa = createSupabaseSource(request); await sa.signIn(admin, pw)
    await sa.saveMember({ email: bk, base: 'SDO', position: 'Senior Bookkeeper' })
    await sa.saveMember({ email: acct, base: 'SDO', position: 'Accountant' })
    await sa.saveMember({ email: coa, base: 'COA', position: 'Auditor' })
    for (const e of [bk, acct, coa]) await createSupabaseSource(request).register({ email: e, password: pw, familyName: 'test', firstName: 'upload' })

    // Senior Bookkeeper uploads MTB for SDO
    const up = createSupabaseSource(request); await up.signIn(bk, pw)
    const bytes = new Uint8Array(Buffer.from('Debit,Credit\n100,100\n'))
    const precheck = { findings: [{ severity: 'pass', code: 'TB_BALANCED', title: 'Debit equals credit', detail: '1.00' }], blocked: false }
    await assert.rejects(up.submitFiles({ reportCode: 'MTB', unitCode: 'BNHS', periodKey: PERIOD, files: [{ name: 'x.csv', size: bytes.length, type: 'text/csv', sha256: 'x', precheck, bytes }] }), /row-level|not assigned|Unauthorized|403/i, 'cannot upload for another office')
    await up.submitFiles({ reportCode: 'MTB', unitCode: 'SDO', periodKey: PERIOD, files: [{ name: 'MTB SDO Jan 2025.csv', size: bytes.length, type: 'text/csv', sha256: 'abc', precheck, bytes }] })
    const key = `MTB|SDO|${PERIOD}`
    const sub = (await up.listSubmissions()).find((s) => s.key === key)
    assert.equal(sub.status, 'for_review')
    const file = (await up.listFiles()).find((f) => f.itemKey === key)
    assert.equal(file.name, 'MTB SDO Jan 2025.csv'); objects.push(file.storagePath)
    assert.equal(file.precheck.findings[0].code, 'TB_BALANCED', 'pre-check results are stored with the file')

    // COA sees nothing before release
    const auditor = createSupabaseSource(request); await auditor.signIn(coa, pw)
    assert(!(await auditor.listSubmissions()).some((s) => s.key === key))
    const before = await request({ path: '/storage/v1/object/coa-files/' + file.storagePath, raw: true })
    assert.notEqual(before.status, 200, 'signed-out download refused')

    // Assigned uploaders can mark non-applicable reports; other offices and COA cannot.
    const naSlot = {reportCode:'RADA_TRUST',unitCode:'SDO',periodKey:PERIOD}
    await assert.rejects(up.setNotApplicable({...naSlot,unitCode:'BNHS'},'Not required'), /this office/)
    await assert.rejects(up.setNotApplicable(naSlot,' '), /reason/)
    await assert.rejects(auditor.setNotApplicable(naSlot,'Not required'), /this office/)
    await up.setNotApplicable(naSlot,'Not required for this office')
    const na = (await up.listSubmissions()).find(s=>s.key===`RADA_TRUST|SDO|${PERIOD}`)
    assert.equal(na.status,'not_applicable')
    assert.equal(na.reviewNote,'Not required for this office')
    assert((await up.listActivity(na.key)).some(a=>a.action==='not_applicable'))

    // Division Accountant approves
    const accountant = createSupabaseSource(request); await accountant.signIn(acct, pw)
    await accountant.approve(key)
    assert.equal((await accountant.listSubmissions()).find((s) => s.key === key).status, 'approved')
    assert((await accountant.listActivity(key)).map((a) => a.action).includes('approve'))

    // COA can now see and download it
    assert((await auditor.listSubmissions()).some((s) => s.key === key && s.status === 'approved'))
    const token = (await request({ path: '/auth/v1/token?grant_type=password', method: 'POST', body: { email: coa, password: pw } })).access_token
    const dl = await request({ path: '/storage/v1/object/coa-files/' + file.storagePath, token, raw: true })
    assert.equal(dl.status, 200, 'COA downloads the released file'); assert.equal(await dl.text(), 'Debit,Credit\n100,100\n')
    console.log('Upload, pre-check storage, office restriction, approval, activity and COA release checks passed')
  } finally {
    const rows = await sql(`select storage_path from public.submission_files f join public.submissions s on s.id=f.submission_id where s.period_key='${PERIOD}' and f.uploaded_by in ('${bk}','${acct}')`).catch(() => [])
    objects = [...new Set([...objects, ...rows.map((r) => r.storage_path)])]
    if (objects.length && env.SUPABASE_SECRET_KEY) await fetch(`${cfg.url}/storage/v1/object/coa-files`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: objects }) })
    const emails = [admin, bk, acct, coa].map((e) => `'${e}'`).join(',')
    await sql(`delete from public.activity_log where submission_id in (select id from public.submissions where period_key='${PERIOD}') or actor_email in (${emails}) or details->>'email' in (${emails});
      delete from public.submission_files where submission_id in (select id from public.submissions where period_key='${PERIOD}');
      delete from public.submissions where period_key='${PERIOD}';
      delete from auth.users where email in (${emails}); delete from public.members where email in (${emails});`)
    const left = await sql(`select (select count(*) from public.members where email in (${emails})) as members, (select count(*) from public.submissions where period_key='${PERIOD}') as subs, (select count(*) from storage.objects where bucket_id='coa-files' and name like '%/${PERIOD}/%') as files`)
    console.log('Cleanup:', JSON.stringify(left[0]))
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1 })
