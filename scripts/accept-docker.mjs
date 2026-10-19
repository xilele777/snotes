import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const image = process.argv[2]
if (!image || process.argv.length !== 3) throw new Error('Usage: node scripts/accept-docker.mjs BUILT_IMAGE_TAG')
const prefix = 'snotes-acceptance-' + Date.now()
const source = prefix + '-source', archive = prefix + '-archive'
const original = prefix + '-app', restored = prefix + '-restored'
const token = randomBytes(32).toString('hex')
const secretDirectory = mkdtempSync(join(tmpdir(), 'snotes-acceptance-'))
const envFile = join(secretDirectory, 'runtime.env')
writeFileSync(envFile, 'ACCESS_TOKEN=' + token + '\nTRASH_RETENTION_DAYS=off\n', { mode: 0o600 })
function docker(...args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 })
  if (result.status !== 0) throw new Error('docker ' + args[0] + ' failed: ' + (result.stderr || result.error || result.stdout))
  return result.stdout.trim()
}
const origin = 'http://127.0.0.1:8792'
async function ready() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(origin + '/api/health')).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Container did not become healthy')
}
async function req(path, body, epoch, expected = 200) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(epoch ? { 'X-Snotes-Epoch': epoch } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  assert.equal(response.status, expected, path)
  return response.json()
}
const report = { started: new Date().toISOString(), image, checks: [] }
try {
  docker('volume', 'create', source); docker('volume', 'create', archive)
  docker('run', '-d', '--name', original, '--env-file', envFile, '-p', '127.0.0.1:8792:3000', '-v', source + ':/app/data', image)
  await ready()
  const oldEpoch = (await req('/api/sync/instance')).epoch
  const id = randomUUID()
  const note = { id, title: 'Docker 中文验收', summary: '', content: '# Docker 持久化', create_time: Date.now() }
  await req('/api/notes', note, oldEpoch)
  const form = new FormData(), bytes = Buffer.from([137,80,78,71,13,10,26,10])
  form.set('file', new Blob([bytes], { type: 'image/png' }), 'test.png'); form.set('note_id', id)
  const upload = await fetch(origin + '/api/images/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Snotes-Epoch': oldEpoch }, body: form })
  assert.equal(upload.status, 200)
  const object = await upload.json()
  async function verify() {
    const bodies = await req('/api/sync/bodies', { ids: [id] })
    assert.equal(bodies.bodies[0].content, note.content)
    const objectResponse = await fetch(origin + object.url, { headers: { Authorization: 'Bearer ' + token } })
    assert.equal(objectResponse.status, 200)
    assert.deepEqual(Buffer.from(await objectResponse.arrayBuffer()), bytes)
    assert.equal((await fetch(origin + object.url)).status, 401)
  }
  await verify(); report.checks.push('health, authenticated note/image roundtrip, anonymous image 401')
  const html = await (await fetch(origin)).text()
  const main = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1]
  for (const path of [main, '/vendor/vditor/4.0.0/dist/js/lute/lute.min.js', '/', '/sw.js']) {
    const response = await fetch(origin + path, { headers: { 'Accept-Encoding': 'gzip' } })
    assert.equal(response.status, 200)
    const actual = Buffer.from(await response.arrayBuffer())
    const local = Buffer.from(docker('exec', original, 'node', '-e', "process.stdout.write(require('node:fs').readFileSync(process.argv[1]).toString('base64'))", '/app/dist' + (path === '/' ? '/index.html' : path)), 'base64')
    assert.equal(createHash('sha256').update(actual).digest('hex'), createHash('sha256').update(local).digest('hex'))
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    assert.match(response.headers.get('vary'), /Accept-Encoding/i)
    assert.match(response.headers.get('cache-control'), path.startsWith('/assets/') || path.startsWith('/vendor/') ? /immutable/ : /no-cache/)
  }
  report.checks.push('Docker HTTP gzip, Vary, immutable/no-cache and build byte hashes')
  docker('restart', original); await ready(); await verify()
  assert.equal((await req('/api/sync/instance')).epoch, oldEpoch)
  report.checks.push('restart persistence and stable epoch')
  docker('stop', original)
  const seed = "const {DatabaseSync}=require('node:sqlite');const fs=require('node:fs');const db=new DatabaseSync('/app/data/snotes.sqlite');db.exec(\"INSERT INTO note(id, invalid, create_time, update_time) VALUES('trash-acceptance',1,1,1);INSERT INTO note_body(note_id,content) VALUES('trash-acceptance','回收站');INSERT INTO note_history(note_id,time,body) VALUES('trash-acceptance',1,'普通历史');\");db.close();fs.writeFileSync('/app/data/images/unreferenced.png','orphan-object');"
  docker('run','--rm','--user','root','-v',source + ':/app/data','--entrypoint','node',image,'-e',seed)
  docker('run','--rm','--user','root','-v',source + ':/app/data','-v',archive + ':/acceptance','--entrypoint','node',image,'scripts/instance-backup.mjs','backup','/app/data','/acceptance/backup','--offline')
  docker('run','--rm','--user','root','-v',archive + ':/acceptance','--entrypoint','node',image,'scripts/instance-backup.mjs','restore','/acceptance/backup','/acceptance/restored','--offline')
  const verifySql = "const {DatabaseSync}=require('node:sqlite');const fs=require('node:fs');const assert=require('node:assert/strict');const db=new DatabaseSync('/acceptance/restored/snotes.sqlite');assert.equal(db.prepare(\"SELECT content FROM note_body WHERE note_id='trash-acceptance'\").get().content,'回收站');assert.equal(db.prepare(\"SELECT body FROM note_history WHERE note_id='trash-acceptance'\").get().body,'普通历史');assert.equal(db.prepare('SELECT count(*) n FROM sync_checkpoint').get().n,0);assert.equal(fs.readFileSync('/acceptance/restored/images/unreferenced.png','utf8'),'orphan-object');db.close();"
  docker('run','--rm','--user','root','-v',archive + ':/acceptance','--entrypoint','node',image,'-e',verifySql)
  docker('run','--rm','--user','root','-v',archive + ':/acceptance','--entrypoint','chown',image,'-R','node:node','/acceptance/restored')
  docker('run','-d','--name',restored,'--env-file',envFile,'-e','SNOTES_DATA_DIR=/acceptance/restored','-p','127.0.0.1:8792:3000','-v',archive + ':/acceptance',image)
  await ready(); await verify()
  const newEpoch = (await req('/api/sync/instance')).epoch
  assert.notEqual(newEpoch, oldEpoch)
  const another = { ...note, id: randomUUID() }
  await req('/api/notes', another, undefined, 409)
  await req('/api/notes', another, oldEpoch, 409)
  await req('/api/notes', another, newEpoch)
  report.checks.push('offline full backup/restore: local history, unreferenced trash/images, cleared receipts, rotated epoch, strict missing/stale epoch 409, new epoch writes 200')
  report.image_id = docker('image','inspect',image,'--format','{{.Id}}')
  report.finished = new Date().toISOString(); report.status='passed'
} catch (error) {
  report.status = 'failed'
  report.error = error.message
  throw error
} finally {
  for (const name of [original,restored]) spawnSync('docker',['rm','-f',name],{encoding:'utf8'})
  for (const volume of [source,archive]) spawnSync('docker',['volume','rm',volume],{encoding:'utf8'})
  unlinkSync(envFile); rmdirSync(secretDirectory)
  report.cleanup='Only acceptance containers/volumes and temporary credentials removed; built image retained'
  mkdirSync('tmp/acceptance', { recursive: true })
  writeFileSync('tmp/acceptance/docker-acceptance.json',JSON.stringify(report,null,2))
}
console.log(JSON.stringify(report,null,2))
