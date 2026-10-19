import type { Env } from './types'

/** Retain queued objects until deletion can coordinate with writes. */
export async function cleanupDeletedNotebookImages(env: Env, bookId?: string) {
  void env
  void bookId
}
