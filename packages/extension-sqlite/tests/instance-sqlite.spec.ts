import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { InstanceSqliteService, type InstanceSqliteDatabase } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function sqliteContext(instanceHome: string) {
  const context = new Context()
  await context.plugin(InstanceSqliteService, { home: instanceHome, busyTimeoutMs: 1000 })
  return context
}

describe('namespaced SQLite storage', () => {
  it('allocates separate WAL databases and closes handles with consumer lifecycles', async () => {
    const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-storage-'))
    temporaryRoots.push(instanceHome)
    const context = await sqliteContext(instanceHome)
    const handles: InstanceSqliteDatabase[] = []
    const consumer = (namespace: string): Plugin => ({
      name: `${namespace}-consumer`,
      inject: ['doppelgangerInstanceSqlite'],
      async apply(ctx) {
        const database = await ctx.doppelgangerInstanceSqlite.open(namespace)
        database.exec('CREATE TABLE owned(value TEXT NOT NULL)')
        database.prepare('INSERT INTO owned(value) VALUES (?)').run(namespace)
        handles.push(database)
      },
    })
    const [memory, preferences] = await Promise.all([
      context.plugin(consumer('memory')),
      context.plugin(consumer('preferences')),
    ])

    expect(handles.map(handle => handle.filename).sort()).toEqual([
      join(instanceHome, 'storage', 'memory.sqlite'),
      join(instanceHome, 'storage', 'preferences.sqlite'),
    ])
    expect(handles.map(handle => handle.prepare('SELECT value FROM owned').get()?.value).sort()).toEqual([
      'memory',
      'preferences',
    ])
    const memoryHandle = handles.find(handle => handle.filename.endsWith('memory.sqlite'))
    if (memoryHandle === undefined) throw new Error('memory database did not open')
    expect(memoryHandle.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal')

    await memory.dispose()
    expect(() => memoryHandle.prepare('SELECT 1')).toThrow('is closed')
    await preferences.dispose()
    await context.fiber.dispose()
  })

  it('supports concurrent session connections with short transactions', async () => {
    const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-storage-concurrent-'))
    temporaryRoots.push(instanceHome)
    const [firstContext, secondContext] = await Promise.all([
      sqliteContext(instanceHome),
      sqliteContext(instanceHome),
    ])
    let first: InstanceSqliteDatabase | undefined
    let second: InstanceSqliteDatabase | undefined
    const firstConsumer = await firstContext.plugin({
      name: 'first-memory',
      inject: ['doppelgangerInstanceSqlite'],
      async apply(ctx) {
        first = await ctx.doppelgangerInstanceSqlite.open('memory')
      },
    })
    const secondConsumer = await secondContext.plugin({
      name: 'second-memory',
      inject: ['doppelgangerInstanceSqlite'],
      async apply(ctx) {
        second = await ctx.doppelgangerInstanceSqlite.open('memory')
      },
    })
    if (first === undefined || second === undefined) throw new Error('concurrent databases did not open')

    first.exec('CREATE TABLE IF NOT EXISTS commits(id INTEGER PRIMARY KEY, session_id TEXT NOT NULL)')
    first.transaction(database => {
      database.prepare('INSERT INTO commits(session_id) VALUES (?)').run('first')
    })
    second.transaction(database => {
      database.prepare('INSERT INTO commits(session_id) VALUES (?)').run('second')
    })
    expect(second.prepare('SELECT session_id FROM commits ORDER BY id').all().map(row => row.session_id)).toEqual([
      'first',
      'second',
    ])

    await Promise.all([firstConsumer.dispose(), secondConsumer.dispose()])
    await Promise.all([firstContext.fiber.dispose(), secondContext.fiber.dispose()])
  })

  it('validates owner configuration and rolls back failed synchronous transactions', async () => {
    const context = new Context()
    await expect(context.plugin(InstanceSqliteService, { home: 'relative' }).await())
      .rejects.toThrow('home must be absolute')
    await context.fiber.dispose()

    const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-storage-rollback-'))
    temporaryRoots.push(instanceHome)
    const active = await sqliteContext(instanceHome)
    const database = await active.doppelgangerInstanceSqlite.open('memory')
    database.exec('CREATE TABLE commits(value TEXT NOT NULL)')
    expect(() => database.transaction(handle => {
      handle.prepare('INSERT INTO commits(value) VALUES (?)').run('rolled-back')
      throw new Error('abort')
    })).toThrow('abort')
    expect(database.prepare('SELECT value FROM commits').all()).toEqual([])
    await expect(active.doppelgangerInstanceSqlite.open('Bad Namespace')).rejects.toThrow('lowercase alphanumeric')
    await active.fiber.dispose()
  })
})
