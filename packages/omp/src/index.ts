import { createDoppelgangerOmpExtension } from '@doppelganger/doppelganger-host-omp'
import { optionsFromEnvironment } from './options.ts'

export default createDoppelgangerOmpExtension(optionsFromEnvironment(process.env))
