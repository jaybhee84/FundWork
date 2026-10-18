#!/usr/bin/env node
// Run SQL on the FundWork Supabase project from this computer.
//
// Setup (once):
//   1. Supabase dashboard → your avatar → Account preferences → Access Tokens → Generate new token.
//   2. Create a file named .env.supabase in the FundWork folder containing:
//        SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx
//      The token can manage your whole Supabase account: keep it in this file only.
//      .env.supabase is git-ignored and is never packaged into the installer.
//
// Commands (npm run supabase -- <command>):
//   status                       Check the token and the project, list applied migrations
//   migrate                      Apply new files from supabase/migrations (each runs once, in order)
//   sql "select 1"               Run one SQL statement and print the result
//   sql -f path/to/file.sql      Run a SQL file
//   add-member <email> <role> "<name>" [offices]
//                                Pre-authorise an account. role: superadmin | accountant | uploader | coa
//                                offices (uploader only), comma-separated: SDO,BNHS,BEGANG,CONSO
//
// Uses the Supabase Management API (https://api.supabase.com). No extra packages needed.
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const ENV_FILE = path.join(ROOT, '.env.supabase')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const CONFIG = path.join(ROOT, 'coa', 'supabase.config.json')

function readEnv() {
  const env = {}
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('SUPABASE_'))) }
}

function projectRef(env) {
  if (env.SUPABASE_PROJECT_REF) return env.SUPABASE_PROJECT_REF
  const url = env.SUPABASE_URL || JSON.parse(fs.readFileSync(CONFIG, 'utf8')).url
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url || '')
  if (!m) throw Error(`Cannot find the project. Set "url" in ${path.relative(ROOT, CONFIG)} or SUPABASE_PROJECT_REF in .env.supabase`)
  return m[1]
}

function token(env) {
  const t = env.SUPABASE_ACCESS_TOKEN
  if (!t) throw Error('No access token. Create .env.supabase with SUPABASE_ACCESS_TOKEN=sbp_... (see the top of scripts/supabase.js)')
  if (!t.startsWith('sbp_')) throw Error('SUPABASE_ACCESS_TOKEN should be a personal access token starting with sbp_. The publishable (anon) and service_role keys cannot run SQL.')
  return t
}

async function api(env, route, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef(env)}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token(env)}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || text || res.statusText
    if (res.status === 401) throw Error('The access token was rejected (401). Generate a new one and update .env.supabase.')
    if (res.status === 404) throw Error(`Project ${projectRef(env)} was not found for this token (404).`)
    throw Error(`Supabase returned ${res.status}: ${msg}`)
  }
  return data
}
const query = (env, sql) => api(env, '/database/query', { query: sql })
const lit = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

const LEDGER = `create schema if not exists fundwork_admin;
revoke all on schema fundwork_admin from public, anon, authenticated;
create table if not exists fundwork_admin.migrations (name text primary key, applied_at timestamptz not null default now());`

async function status(env) {
  const p = await api(env, '')
  console.log(`Project   ${p.name} (${p.id}) · ${p.region} · ${p.status}`)
  await query(env, LEDGER)
  const rows = await query(env, 'select name, applied_at from fundwork_admin.migrations order by name')
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    const r = rows.find((x) => x.name === f)
    console.log(`${r ? 'applied ' : 'PENDING '} ${f}${r ? `  (${r.applied_at})` : ''}`)
  }
  const members = await query(env, "select to_regclass('public.members') is not null as ok").catch(() => [{ ok: false }])
  if (members[0]?.ok) {
    const m = await query(env, 'select role, count(*)::int as n from public.members group by role order by role')
    console.log('Members  ', m.length ? m.map((x) => `${x.role}: ${x.n}`).join(', ') : 'none yet (use add-member)')
  }
}

async function migrate(env) {
  await query(env, LEDGER)
  let done = new Set((await query(env, 'select name from fundwork_admin.migrations')).map((r) => r.name))
  const all = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  // The first migration may have been pasted into the SQL Editor by hand: record it instead of running it again.
  if (!done.size && (await query(env, "select to_regclass('public.units') is not null as ok"))[0]?.ok) {
    await query(env, `insert into fundwork_admin.migrations (name) values (${lit(all[0])}) on conflict do nothing`)
    console.log(`${all[0]} was already applied by hand; recorded it.`)
    done = new Set([all[0]])
  }
  const files = all.filter((f) => !done.has(f))
  if (!files.length) return console.log('Database is up to date.')
  for (const f of files) {
    process.stdout.write(`Applying ${f} … `)
    const body = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')
    // One request = one transaction: the file and its ledger entry succeed or fail together.
    await query(env, `begin;\n${body}\ninsert into fundwork_admin.migrations (name) values (${lit(f)});\ncommit;`)
    console.log('done')
  }
}

async function addMember(env, [email, role, name, offices]) {
  const roles = ['superadmin', 'accountant', 'uploader', 'coa']
  if (!email || !roles.includes(role) || !name) throw Error('Usage: add-member <email> <superadmin|accountant|uploader|coa> "<full name>" [SDO,BNHS,BEGANG,CONSO]')
  let list = role === 'superadmin' ? [] : role === 'uploader' ? String(offices || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : ['SDO', 'BNHS', 'BEGANG', 'CONSO']
  if (role === 'uploader' && !list.length) throw Error('A Senior Bookkeeper (uploader) needs offices, e.g. BNHS')
  const arr = `array[${list.map(lit).join(',')}]::text[]`
  await query(env, `insert into public.members (email, user_id, name, role, offices)
    values (lower(${lit(email)}), (select id from auth.users where lower(email) = lower(${lit(email)}) limit 1), ${lit(name)}, ${lit(role)}, ${arr})
    on conflict (email) do update set name = excluded.name, role = excluded.role, offices = excluded.offices, active = true, updated_at = now();`)
  console.log(`${email} can now ${role === 'superadmin' ? 'manage accounts' : `use FundWork as ${role}`}. They choose Register in FundWork with this email and set a password; no email is sent.`)
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  const env = readEnv()
  if (cmd === 'status') return status(env)
  if (cmd === 'migrate') return migrate(env)
  if (cmd === 'add-member') return addMember(env, args)
  if (cmd === 'sql') {
    const text = args[0] === '-f' ? fs.readFileSync(path.resolve(args[1]), 'utf8') : args.join(' ')
    if (!text.trim()) throw Error('Usage: sql "select ..."  or  sql -f file.sql')
    const rows = await query(env, text)
    if (Array.isArray(rows) && rows.length && rows.every((r) => !Object.keys(r).length)) {
      console.log('The query returned no columns. On Windows, npm cuts a command at the first line break: keep the SQL on one line, or save it to a file and use sql -f file.sql')
      process.exitCode = 1
    } else if (Array.isArray(rows) && rows.length) console.table(rows)
    else console.log('OK')
    return
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exitCode = cmd ? 1 : 0
}

main().catch((e) => { console.error('Error:', e.message); process.exitCode = 1 })
