/** API 实际使用的存储能力，Cloudflare 绑定与服务器适配器共同实现。 */
export interface QueryResult<T = Record<string, unknown>> {
  results: T[]
  meta: { changes: number }
}

export interface Statement {
  bind(...values: unknown[]): Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>
  run(): Promise<{ meta: { changes: number } }>
}

export interface Database {
  prepare(sql: string): Statement
  batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]>
}

export interface ImageObject {
  body: ReadableStream<Uint8Array> | ArrayBuffer
  httpEtag: string
  httpMetadata?: { contentType?: string }
}

export interface ImageStore {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>
  get(key: string): Promise<ImageObject | null>
  delete(key: string): Promise<void>
}
