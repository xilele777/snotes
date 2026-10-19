import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

function files(root, directory = root) {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${path}`)
    return stat.isDirectory() ? files(root, path) : [relative(root, path).split(sep).join('/')]
  })
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
function copy(source, target, path) {
  mkdirSync(dirname(join(target, path)), { recursive: true })
  copyFileSync(join(source, path), join(target, path))
}
function checkDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Database integrity check failed')
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database foreign key check failed')
  } finally { db.close() }
}
function newDestination(source, target) {
  const rel = relative(source, target)
  if (rel === '' || !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)) throw new Error('Destination must be outside source')
  if (existsSync(target)) throw new Error('Destination already exists; choose a new empty path')
  mkdirSync(target, { recursive: true })
}

export function backupInstance(source, target) {
  checkDatabase(join(source, 'snotes.sqlite'))
  newDestination(source, target)
  const db = new DatabaseSync(join(source, 'snotes.sqlite'), { readOnly: true })
  try { db.prepare('VACUUM INTO ?').run(join(target, 'snotes.sqlite')) } finally { db.close() }
  if (existsSync(join(source, 'images'))) for (const path of files(join(source, 'images'))) copy(source, target, `images/${path}`)
  checkDatabase(join(target, 'snotes.sqlite'))
  const manifest = { app: 'snotes-instance', format: 1, created_at: new Date().toISOString(), files: Object.fromEntries(files(target).map(path => [path, hash(join(target, path))])) }
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

export function restoreInstance(source, target) {
  const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'))
  if (manifest.app !== 'snotes-instance' || manifest.format !== 1 || !manifest.files || !Object.hasOwn(manifest.files, 'snotes.sqlite')) throw new Error('Invalid instance manifest')
  const actual = files(source).filter(path => path !== 'manifest.json')
  if (actual.length !== Object.keys(manifest.files).length) throw new Error('Unexpected or missing backup files')
  for (const path of actual) {
    if (path !== 'snotes.sqlite' && !path.startsWith('images/')) throw new Error('Unexpected backup path')
    if (hash(join(source, path)) !== manifest.files[path]) throw new Error(`Checksum mismatch: ${path}`)
  }
  checkDatabase(join(source, 'snotes.sqlite'))
  newDestination(source, target)
  for (const path of actual) copy(source, target, path)
  const epoch = randomUUID()
  writeFileSync(join(target, 'sync-epoch'), epoch, { flag: 'wx', mode: 0o600 })
  writeFileSync(join(target, 'sync-require-epoch'), 'true', { flag: 'wx', mode: 0o600 })
  const db = new DatabaseSync(join(target, 'snotes.sqlite'))
  try {
    db.exec("BEGIN IMMEDIATE; UPDATE sync_instance SET epoch = lower(hex(randomblob(16))) WHERE id = 1; DELETE FROM sync_checkpoint; COMMIT;")
  } finally { db.close() }
  checkDatabase(join(target, 'snotes.sqlite'))
  return { epoch, directory: target }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, source, target, offline] = process.argv.slice(2)
  if (!['backup', 'restore'].includes(command) || !source || !target || offline !== '--offline') {
    console.error('Stop all writers first, then: node scripts/instance-backup.mjs backup|restore SOURCE NEW_DESTINATION --offline')
    process.exitCode = 1
  } else {
    try { console.log(JSON.stringify(command === 'backup' ? backupInstance(resolve(source), resolve(target)) : restoreInstance(resolve(source), resolve(target)), null, 2)) }
    catch (error) { console.error(error.message); process.exitCode = 1 }
  }
}
