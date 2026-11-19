import type { REXConfiguration } from '@bric/rex-core/common'
import rexCorePlugin, { REXServiceWorkerModule, registerREXModule } from '@bric/rex-core/service-worker'

import { parseAndSyncLists } from './loading.mjs'
import { setDebug } from './matching.mjs'

class REXListsModule extends REXServiceWorkerModule {
  moduleName() {
    return 'ListsModule'
  }

  setup() {
    return this.refreshConfiguration()
  }

  refreshConfiguration(): Promise<void> {
    return rexCorePlugin.fetchConfiguration()
      .then((configuration: REXConfiguration) => {
        return this.applyConfiguration(configuration)
      })
      .catch((error) => {
        console.error('[rex-lists] Unable to load lists from configuration:', error)
      })
  }

  private applyConfiguration(configuration: REXConfiguration | undefined): Promise<void> {
    if (configuration === undefined || configuration === null) {
      return Promise.resolve()
    }

    const listsConfig = configuration['lists_config'] as { debug?: boolean } | undefined

    setDebug(listsConfig?.debug === true)

    const lists = configuration['lists']

    if (typeof lists !== 'object' || lists === null || Array.isArray(lists)) {
      return Promise.resolve()
    }

    return parseAndSyncLists(lists as Record<string, unknown[]>)
  }
}

const plugin = new REXListsModule()

registerREXModule(plugin)

export default plugin
