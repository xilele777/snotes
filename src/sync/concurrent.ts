/** Keep download slots busy, but drain all in-flight work before exposing errors. */
export async function forEachConcurrent<T>(items: readonly T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  let stopped = false
  const worker = async () => {
    while (!stopped && next < items.length) {
      const item = items[next++]
      try { await run(item) } catch (error) {
        stopped = true
        throw error
      }
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  for (const result of results) if (result.status === 'rejected') throw result.reason
}
