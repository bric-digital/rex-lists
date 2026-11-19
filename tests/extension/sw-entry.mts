// @ts-nocheck
import rexCorePlugin from '@bric/rex-core/service-worker'

import listsModule, { listsLoaded } from '../../src/service-worker.mjs'
import { hasListEntries, parseAndSyncLists, registeredDomainOf } from '../../src/list-utilities.mjs'

chrome.runtime.onMessage.addListener(rexCorePlugin.handleMessage)

self.listsModule = listsModule
self.listsLoaded = listsLoaded
self.hasListEntries = hasListEntries
self.parseAndSyncLists = parseAndSyncLists
self.registeredDomainOf = registeredDomainOf

self.sendRexMessage = (message) => {
  return new Promise((resolve) => {
    rexCorePlugin.handleMessage(message, null, resolve)
  })
}
