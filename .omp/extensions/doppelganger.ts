import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createDoppelgangerOmpExtension } from '../../packages/host-omp/src/index.ts'
import { resolveAidenActivation } from '../../packages/preset-aiden/src/index.ts'

const userConfigPath = fileURLToPath(new URL('../../dev/doppelganger/config.yaml', import.meta.url))

export default createDoppelgangerOmpExtension({
  activationResolver: async request => {
    if (request.projectManifestPath === undefined) {
      try {
        await access(userConfigPath)
      } catch {
        return
      }
    }
    return resolveAidenActivation({
      userConfigPath,
      sessionId: request.sessionId,
      ...(request.projectManifestPath === undefined ? {} : { projectManifestPath: request.projectManifestPath }),
    })
  },
  childPath: fileURLToPath(new URL('../../packages/host-omp/src/child.ts', import.meta.url)),
})
