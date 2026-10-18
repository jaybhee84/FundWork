const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { openStore } = require('./store')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fundwork-store-'))
try {
  // Empty database gives the same defaults the app always started with.
  let s = openStore(path.join(dir, 'empty.db'))
  const blank = s.read()
  assert.deepEqual(blank.entries, []); assert.deepEqual(blank.accounts, {}); assert.equal(blank.organization, 'Your organization'); assert(Number.isInteger(blank.year))
  s.close()

  // Round trip, including extra fields the store has no column for.
  const books = {
    organization: 'Isabela City SDO', year: 2026,
    entries: [
      { date: '2026-01-01', ref: 'OPENING', code: '101', name: 'Cash', memo: '', debit: 10025, credit: 0, fund: 'Regular', year: 2026, opening: true, batch: 'b1', source: 'open.xlsx' },
      { date: '2026-01-02', ref: 'J1', code: '301', name: 'Equity', memo: 'note', debit: 0, credit: 10025, fund: 'Regular', year: 2026, opening: false, tag: 'kept' }
    ],
    accounts: { 'Regular|101': { type: 'Asset', cash: true } },
    cashflows: { 'Regular|2026|J1': 'Operating' },
    lastFund: 'Regular'
  }
  s = openStore(path.join(dir, 'books.db'))
  s.write(books)
  assert.deepEqual(s.read(), books)
  s.write({ ...books, entries: books.entries.slice(1), cashflows: {} })
  assert.equal(s.read().entries.length, 1, 'a save replaces the previous records')
  assert.deepEqual(s.read().cashflows, {})
  assert.throws(() => s.write({ entries: 'x', accounts: {} }), /Invalid records/)
  assert.equal(s.read().entries.length, 1, 'a rejected save leaves the records unchanged')

  // Snapshot before a restore is a complete, openable copy.
  s.snapshot(path.join(dir, 'books.db.before-restore'))
  s.close()
  const copy = openStore(path.join(dir, 'books.db.before-restore'))
  assert.equal(copy.read().entries[0].tag, 'kept'); copy.close()

  // An existing accounts.json is imported once and kept as *.migrated.
  const legacy = path.join(dir, 'accounts.json')
  fs.writeFileSync(legacy, JSON.stringify(books))
  s = openStore(path.join(dir, 'migrated.db'), { legacyJson: legacy })
  assert.deepEqual(s.read(), books)
  assert(!fs.existsSync(legacy) && fs.existsSync(legacy + '.migrated'))
  s.close()

  // An incomplete accounts.json still opens, with defaults for what it lacks.
  fs.writeFileSync(legacy, JSON.stringify({ organization: 'Old books' }))
  s = openStore(path.join(dir, 'partial.db'), { legacyJson: legacy })
  const partial = s.read()
  assert.equal(partial.organization, 'Old books'); assert.deepEqual(partial.entries, []); assert(Number.isInteger(partial.year))
  s.close()

  console.log('SQLite store checks passed')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
