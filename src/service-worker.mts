import type { REXConfiguration } from '@bric/rex-core/common'
import rexCorePlugin, { REXServiceWorkerModule, registerREXModule } from '@bric/rex-core/service-worker'

import { beginListSync, clearStaleListSync, endListSync, parseAndSyncLists } from './loading.mjs'
import { setDebug } from './matching.mjs'

class REXListsModule extends REXServiceWorkerModule {
  moduleName() {
    return 'ListsModule'
  }

  setup() {
    return clearStaleListSync()
      .catch((error) => {
        console.error('[rex-lists] Unable to clear a stale list sync marker:', error)
      })
      .then(() => {
        return this.refreshConfiguration()
      })
  }

  refreshConfiguration(): Promise<void> {
    let attemptFinished = false

    return beginListSync()
      .then(() => {
        return rexCorePlugin.fetchConfiguration()
      })
      .then((configuration: REXConfiguration) => {
        if (configuration === undefined || configuration === null) {
          return Promise.resolve()
        }

        attemptFinished = true

        return this.applyConfiguration(configuration)
      })
      .catch((error) => {
        console.error('[rex-lists] Unable to load lists from configuration:', error)
      })
      .then(() => {
        return endListSync(attemptFinished)
      })
      .catch((error) => {
        console.error('[rex-lists] Unable to record the end of a list sync:', error)
      })
  }

  private applyConfiguration(configuration: REXConfiguration): Promise<void> {
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
