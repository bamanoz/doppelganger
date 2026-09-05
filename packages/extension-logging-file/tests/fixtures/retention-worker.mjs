import { resolveFileLoggingConfig, normalizeFileLoggingConfig, RollingJsonlWriter } from '../../src/index.ts'

const input = JSON.parse(process.argv[2])
const scope = { runtimeActivationId: input.activationId, sessionId: 'retention-worker', runtimePresetId: 'retention-test' }
const config = resolveFileLoggingConfig(normalizeFileLoggingConfig(input.config), scope)
const writer = await RollingJsonlWriter.open(config)
let sequence = 0

process.on('message', async message => {
  try {
    switch (message.operation) {
      case 'write':
        for (let index = 0; index < (message.count ?? 1); index += 1) {
          await writer.write({ ...scope, sequence: ++sequence, timestamp: Date.now(), severity: 'info',
            logger: 'retention-worker', message: message.message ?? 'worker record' })
        }
        break
      case 'cleanup':
        await writer.cleanup()
        break
      case 'close':
        await writer.close()
        break
      case 'exit':
        await writer.close()
        process.send({ id: message.id, ok: true }, () => process.disconnect())
        return
      default:
        throw new Error(`unknown retention worker operation: ${message.operation}`)
    }
    process.send({ id: message.id, ok: true, status: writer.retentionStatus })
  } catch (error) {
    process.send({ id: message.id, ok: false, error: String(error) })
  }
})

process.send({ ready: true, path: config.path, status: writer.retentionStatus })
