import type { REXConfiguration } from '@bric/rex-core/common'
import rexCorePlugin, { REXServiceWorkerModule, registerREXModule } from '@bric/rex-core/service-worker'

import { getAttemptedListsHash, hashListsSection, parseAndSyncLists, recordAttemptedLists } from './loading.mjs'
import { setDebug } from './matching.mjs'

function listsSectionOf(configuration: REXConfiguration): Record<string, unknown> {
  const lists = configuration['lists']

  if (typeof lists !== 'object' || lists === null || Array.isArray(lists)) {
    return {}
  }

  return lists as Record<string, unknown>
}

export async function listsLoaded(): Promise<boolean> {
  try {
    const configuration = await rexCorePlugin.fetchConfiguration()

    if (configuration === undefined || configuration === null) {
      return false
    }

    const currentHash = await hashListsSection(listsSectionOf(configuration))
    const attemptedHash = await getAttemptedListsHash()

    return attemptedHash === currentHash
  } catch {
    return false
  }
}

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
      return recordAttemptedLists({})
    }

    return parseAndSyncLists(lists as Record<string, unknown[]>)
  }
}

const plugin = new REXListsModule()

registerREXModule(plugin)

export default plugin
