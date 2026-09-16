import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Database, QueryResult, Statement } from '../worker/storage'

function parameter(value: unknown): SQLInputValue {
  if (value === null || typeof value === 'string' || typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Uint8Array) return value
  throw new TypeError('Unsupported SQL parameter')
}

class SqliteStatement implements Statement {
  constructor(readonly owner: SqliteDatabase, private sql: string, private values: SQLInputValue[] = []) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(this.owner, this.sql, values.map(parameter))
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.owner.connection.prepare(this.sql).get(...this.values) as T | undefined) ?? null
  }

  async all<T = Record<string, unknown>>(): Promise<QueryResult<T>> {
    return { results: this.owner.connection.prepare(this.sql).all(...this.values) as T[], meta: { changes: 0 } }
  }

  execute() {
    const result = this.owner.connection.prepare(this.sql).run(...this.values)
    return { meta: { changes: Number(result.changes) } }
  }

  async run() { return this.execute() }
}

export class SqliteDatabase implements Database {
  readonly connection: DatabaseSync

  constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true })
    this.connection = new DatabaseSync(filename, { timeout: 5000 })
    this.connection.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  }

  prepare(sql: string): Statement { return new SqliteStatement(this, sql) }

  async batch(statements: Statement[]) {
    // 事务中不能 await，否则另一个请求会插入同一连接的未提交事务。
    return this.transaction(() => statements.map((statement) => {
      if (!(statement instanceof SqliteStatement) || statement.owner !== this) throw new TypeError('Statement belongs to another database')
      return statement.execute()
    }))
  }

  transaction<T>(fn: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.connection.exec('COMMIT')
      return result
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
  }

  migrate(directory: string): string[] {
    this.connection.exec('CREATE TABLE IF NOT EXISTS snotes_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)')
    const applied: string[] = []
    for (const name of readdirSync(directory).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()) {
      const sql = readFileSync(join(directory, name), 'utf8')
      // Git 可在不同系统转换换行，不应因此判定迁移内容发生变化。
      const checksum = createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
      this.transaction(() => {
        const prior = this.connection.prepare('SELECT checksum FROM snotes_migrations WHERE name = ?').get(name)
        if (prior) {
          if (prior.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`)
          return
        }
        this.connection.exec(sql)
        this.connection.prepare('INSERT INTO snotes_migrations VALUES (?, ?, ?)').run(name, checksum, Date.now())
        applied.push(name)
      })
    }
    return applied
  }

  close() { this.connection.close() }
}
