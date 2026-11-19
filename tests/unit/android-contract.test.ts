import { describe, expect, it } from 'vitest'
import type fixtureTypes from '../../shared/fixtures/android-sync/contracts.json'
import fixtureSource from '../../shared/fixtures/android-sync/contracts.json?raw'
import { derive } from '../../shared/derive'
import { escapeRawHtml, migrateLegacyBr } from '../../shared/sanitize'
import { planPull } from '../../shared/sync-reduce'
import { mergeTask } from '../../shared/outbox'
import { noteFits } from '../../shared/limits'
import { backoffDelay, isRetriableStatus } from '../../shared/backoff'
import type { LocalNoteState, NoteMeta, OutboxTask } from '../../shared/types'

// JSON.parse preserves lone UTF-16 surrogates used by the cross-language tests.
const fixtures = JSON.parse(fixtureSource) as typeof fixtureTypes

describe('shared Android / Web contract fixtures', () => {
  it('uses the supported fixture schema', () => expect(fixtures.schemaVersion).toBe(1))

  for (const fixture of fixtures.derive) {
    it(`derive: ${fixture.name}`, () => expect(derive(fixture.markdown)).toEqual(fixture.expected))
  }
  for (const fixture of fixtures.sanitize) {
    it(`sanitize: ${fixture.name}`, () => {
      const migrated = migrateLegacyBr(fixture.markdown)
      expect(migrated).toBe(fixture.legacy)
      expect(escapeRawHtml(migrated)).toBe(fixture.escaped)
    })
  }
  for (const fixture of fixtures.pull) {
    it(`pull: ${fixture.name}`, () => {
      const remote = fixture.remote.map(note => ({ ...fixtures.defaults.note, ...note }) as NoteMeta)
      const local = fixture.local.map(note => ({ ...fixtures.defaults.local, ...note }) as LocalNoteState)
      const plan = planPull(remote, new Map(local.map(note => [note.id, note])))
      expect({
        insert: plan.insert.map(note => note.id),
        updateProp: plan.updateProp.map(note => note.id),
        deleteLocal: plan.deleteLocal.map(note => note.id),
        fetchBody: plan.fetchBody,
      }).toEqual(fixture.expected)
    })
  }
  for (const fixture of fixtures.outbox) {
    it(`outbox: ${fixture.name}`, () => {
      const existing = fixture.existing ? { ...fixtures.defaults.task, ...fixture.existing } as OutboxTask : undefined
      const incoming = { ...fixtures.defaults.task, ...fixture.incoming } as OutboxTask
      // JSON omits absent IDs; both runtimes normalize to the wire shape.
      expect(JSON.parse(JSON.stringify(mergeTask(existing, incoming)))).toEqual(fixture.expected)
    })
  }
  for (const fixture of fixtures.limits) {
    it(`limits: ${fixture.name}`, () => {
      const body = fixture.unit.repeat(fixture.repeat) + fixture.suffix
      expect(new TextEncoder().encode(body).byteLength).toBe(fixture.bytes)
      expect(noteFits(body)).toBe(fixture.fits)
    })
  }
  for (const fixture of fixtures.backoff) {
    it(`backoff: ${fixture.retry}`, () => expect(backoffDelay(fixture.retry)).toBe(fixture.delay))
  }
  for (const fixture of fixtures.status) {
    it(`status: ${fixture.status}`, () => expect(isRetriableStatus(fixture.status)).toBe(fixture.retriable))
  }
})
