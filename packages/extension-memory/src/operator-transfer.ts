import { pathToFileURL } from 'node:url'
import type { Writable } from 'node:stream'
import type { MemoryDatabaseConfig } from './persistence/config.ts'
import { validateMemoryDatabaseConfig } from './persistence/config.ts'
import { transferMemoryDatabase } from './persistence/transfer.ts'

interface OperatorArguments {
  readonly sourceConfigEnv: string
  readonly destinationConfigEnv: string
  readonly legacyActorId: string
  readonly sourceStopped: true
}

const USAGE = 'memory:transfer --source-config-env <ENV> --destination-config-env <ENV> --legacy-actor-id <ID> --source-stopped'

function operatorArguments(argv: readonly string[]): OperatorArguments {
  const values: Record<string, string | true> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--source-stopped') {
      if (values.sourceStopped !== undefined) throw new TypeError('duplicate --source-stopped')
      values.sourceStopped = true
      continue
    }
    const key = flag === '--source-config-env'
      ? 'sourceConfigEnv'
      : flag === '--destination-config-env'
        ? 'destinationConfigEnv'
        : flag === '--legacy-actor-id'
          ? 'legacyActorId'
          : undefined
    if (key === undefined) throw new TypeError(`unsupported memory transfer argument: ${String(flag)}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new TypeError(`missing value for ${flag}`)
    if (values[key] !== undefined) throw new TypeError(`duplicate ${flag}`)
    values[key] = value
    index += 1
  }
  if (values.sourceStopped !== true) throw new TypeError('memory transfer requires --source-stopped after every source writer and coordinator is stopped')
  for (const key of ['sourceConfigEnv', 'destinationConfigEnv', 'legacyActorId'] as const) {
    if (typeof values[key] !== 'string' || values[key].trim().length === 0) throw new TypeError(`memory transfer is missing ${key}`)
  }
  return Object.freeze({
    sourceConfigEnv: values.sourceConfigEnv as string,
    destinationConfigEnv: values.destinationConfigEnv as string,
    legacyActorId: values.legacyActorId as string,
    sourceStopped: true,
  })
}

function configFromEnvironment(name: string, environment: NodeJS.ProcessEnv): MemoryDatabaseConfig {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new TypeError('memory transfer config reference must be an environment-variable name')
  const encoded = environment[name]
  if (encoded === undefined || encoded.length === 0) throw new TypeError(`memory transfer config reference ${name} is unavailable`)
  let decoded: unknown
  try {
    decoded = JSON.parse(encoded)
  } catch {
    throw new TypeError(`memory transfer config reference ${name} is not valid JSON`)
  }
  return validateMemoryDatabaseConfig(decoded as MemoryDatabaseConfig)
}

function boundedError(error: unknown): string {
  if (error instanceof TypeError) return error.message
  if (error instanceof Error && /^memory transfer /u.test(error.message)) return error.message
  if (error instanceof Error && /^MEMORY_STORAGE_/u.test(error.message)) return error.message
  return 'memory transfer failed'
}

/** Operator entrypoint; configuration values name provider configs and PostgreSQL credentials remain indirect. */
export async function runMemoryTransferOperator(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  stdout: Writable = process.stdout,
  stderr: Writable = process.stderr,
): Promise<number> {
  try {
    const args = operatorArguments(argv)
    const source = configFromEnvironment(args.sourceConfigEnv, environment)
    const destination = configFromEnvironment(args.destinationConfigEnv, environment)
    const report = await transferMemoryDatabase({ source, destination, legacyActorId: args.legacyActorId, sourceStopped: true })
    stdout.write(`${JSON.stringify(report)}\n`)
    return 0
  } catch (error) {
    stderr.write(`${boundedError(error)}\nusage: ${USAGE}\n`)
    return 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runMemoryTransferOperator(process.argv.slice(2))
}
