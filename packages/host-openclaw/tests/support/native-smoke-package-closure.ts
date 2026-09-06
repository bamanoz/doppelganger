import { cp, mkdir, readFile, symlink } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

export interface OpenClawSourcePackageClosureOptions {
  readonly artifact: string
  readonly hostPackageRoot: string
  readonly seedPackages: readonly string[]
}

export async function materializeOpenClawSourcePackageClosure(
  options: OpenClawSourcePackageClosureOptions,
): Promise<void> {
  const sourceModules = resolve(options.hostPackageRoot, '..', '..', 'node_modules')
  const targetModules = join(options.artifact, 'node_modules')
  const pending = [...options.seedPackages]
  const copied = new Set<string>()

  while (pending.length > 0) {
    const packageName = pending.shift()!
    if (packageName === 'openclaw' || copied.has(packageName)) continue
    const source = join(sourceModules, ...packageName.split('/'))
    const destination = join(targetModules, ...packageName.split('/'))
    let manifestText: string
    try {
      manifestText = await readFile(join(source, 'package.json'), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const manifest = JSON.parse(manifestText) as {
      readonly dependencies?: Readonly<Record<string, string>>
      readonly optionalDependencies?: Readonly<Record<string, string>>
      readonly peerDependencies?: Readonly<Record<string, string>>
    }

    await mkdir(dirname(destination), { recursive: true })
    if (packageName.startsWith('@doppelganger/')) {
      const workspaceDestination = join(options.artifact, 'runtime-packages', ...packageName.split('/'))
      await mkdir(dirname(workspaceDestination), { recursive: true })
      await cp(source, workspaceDestination, { recursive: true, dereference: true, preserveTimestamps: true })
      await symlink(relative(dirname(destination), workspaceDestination), destination, 'junction')
    } else {
      await cp(source, destination, { recursive: true, dereference: true, preserveTimestamps: true })
    }
    copied.add(packageName)
    pending.push(
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    )
  }
}
