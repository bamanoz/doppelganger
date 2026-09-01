import { inspectPersonaAsset, replacePersonaAsset } from '../../src/asset.ts'
import { acquirePersonaAssetLock } from '../../src/lock.ts'

const [filename, expectedRevision, replacement, pause] = process.argv.slice(2)
if (filename === undefined || expectedRevision === undefined || replacement === undefined || pause === undefined) {
  throw new Error('expected filename, revision, replacement, and pause')
}

const lock = await acquirePersonaAssetLock(filename, 2_000)
try {
  const current = await inspectPersonaAsset(filename, 65_536)
  if (current.revision !== expectedRevision) {
    process.stdout.write(`${JSON.stringify({ status: 'conflict', currentRevision: current.revision })}\n`)
  } else {
    await new Promise(resolve => setTimeout(resolve, Number(pause)))
    await replacePersonaAsset(filename, new TextEncoder().encode(replacement), current.mode)
    process.stdout.write(`${JSON.stringify({ status: 'applied' })}\n`)
  }
} finally {
  await lock.release()
}
