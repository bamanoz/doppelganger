import type { Context, Plugin } from '@deepseek-ai/cordis'
import { InstanceSqliteService, type InstanceSqliteConfig } from './instance-sqlite.ts'

export const InstanceSqlitePlugin: Plugin<InstanceSqliteConfig> = {
  name: 'doppelganger-sqlite',
  provide: 'doppelgangerInstanceSqlite',
  async apply(ctx: Context, config: InstanceSqliteConfig) {
    await ctx.plugin(InstanceSqliteService, config).await()
  }
}

export default InstanceSqlitePlugin

export {
  InstanceSqliteService,
  type InstanceSqliteConfig,
  type InstanceSqliteDatabase,
} from './instance-sqlite.ts'
