// Local book storage in SQLite (Node's built-in node:sqlite, so no native packages).
// The renderer still loads and saves one { entries, accounts, cashflows, organization, year } object;
// this module maps it to tables and writes each save in a single transaction.
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const ENTRY_COLUMNS = ['fund', 'year', 'date', 'ref', 'code', 'name', 'memo', 'debit', 'credit', 'opening', 'batch', 'source']
const SCHEMA = `
create table if not exists meta (key text primary key, value text not null);
create table if not exists entries (
  id integer primary key,
  fund text not null, year integer not null, date text not null, ref text not null,
  code text not null, name text not null, memo text not null default '',
  debit integer not null default 0, credit integer not null default 0,
  opening integer not null default 0, batch text, source text, extra text
);
create index if not exists entries_fund_year on entries (fund, year);
create table if not exists accounts (key text primary key, data text not null);
create table if not exists cashflows (key text primary key, value text not null);`

const defaults = () => ({ entries: [], accounts: {}, organization: 'Your organization', year: Number(new Date(Date.now() + 288e5).toISOString().slice(0, 4)) })

/** Opens (or creates) the book database. legacyJson: an accounts.json to import once, then keep as *.migrated. */
function openStore(file, { legacyJson } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on;')
  db.exec(SCHEMA)
  const tx = (fn) => { db.exec('begin immediate'); try { const r = fn(); db.exec('commit'); return r } catch (e) { db.exec('rollback'); throw e } }

  const isEmpty = () => !db.prepare('select 1 from meta union all select 1 from entries union all select 1 from accounts limit 1').get()

  function read() {
    if (isEmpty()) return defaults()
    const data = defaults()
    for (const { key, value } of db.prepare('select key, value from meta').all()) data[key] = JSON.parse(value)
    data.entries = db.prepare('select * from entries order by id').all().map(({ id, extra, opening, ...e }) => ({ ...e, opening: !!opening, ...(extra ? JSON.parse(extra) : {}) }))
    for (const k of ['batch', 'source']) data.entries.forEach((e) => { if (e[k] === null) delete e[k] })
    data.accounts = Object.fromEntries(db.prepare('select key, data from accounts').all().map((r) => [r.key, JSON.parse(r.data)]))
    const flows = db.prepare('select key, value from cashflows').all()
    if (flows.length || data.cashflows !== undefined) data.cashflows = Object.fromEntries(flows.map((r) => [r.key, r.value]))
    return data
  }

  function write(data) {
    if (!data || !Array.isArray(data.entries) || typeof data.accounts !== 'object') throw Error('Invalid records')
    const { entries, accounts, cashflows, ...rest } = data
    const insEntry = db.prepare(`insert into entries (${ENTRY_COLUMNS.join(', ')}, extra) values (${ENTRY_COLUMNS.map(() => '?').join(', ')}, ?)`)
    const insAccount = db.prepare('insert into accounts (key, data) values (?, ?)')
    const insFlow = db.prepare('insert into cashflows (key, value) values (?, ?)')
    const insMeta = db.prepare('insert into meta (key, value) values (?, ?)')
    tx(() => {
      db.exec('delete from entries; delete from accounts; delete from cashflows; delete from meta;')
      for (const e of entries) {
        const extra = Object.fromEntries(Object.entries(e).filter(([k]) => !ENTRY_COLUMNS.includes(k)))
        insEntry.run(String(e.fund ?? ''), Number(e.year) || 0, String(e.date ?? ''), String(e.ref ?? ''), String(e.code ?? ''), String(e.name ?? ''), String(e.memo ?? ''),
          Number(e.debit) || 0, Number(e.credit) || 0, e.opening ? 1 : 0, e.batch ?? null, e.source ?? null, Object.keys(extra).length ? JSON.stringify(extra) : null)
      }
      for (const [k, v] of Object.entries(accounts || {})) insAccount.run(k, JSON.stringify(v))
      for (const [k, v] of Object.entries(cashflows || {})) insFlow.run(k, String(v))
      // organization, year and any other top-level settings; the marker keeps cashflows: {} round-tripping.
      for (const [k, v] of Object.entries({ ...rest, ...(cashflows !== undefined ? { cashflows: {} } : {}) })) if (v !== undefined) insMeta.run(k, JSON.stringify(v))
    })
  }

  /** Copies the whole database to another file (used before a restore). */
  function snapshot(target) { try { fs.rmSync(target, { force: true }) } catch {} db.prepare('vacuum into ?').run(target) }

  if (legacyJson && isEmpty() && fs.existsSync(legacyJson)) {
    const old = JSON.parse(fs.readFileSync(legacyJson, 'utf8'))
    write({ ...defaults(), ...old, entries: Array.isArray(old?.entries) ? old.entries : [], accounts: old?.accounts && typeof old.accounts === 'object' ? old.accounts : {} })
    fs.renameSync(legacyJson, legacyJson + '.migrated')
  }

  return { read, write, snapshot, close: () => db.close() }
}

module.exports = { openStore }
