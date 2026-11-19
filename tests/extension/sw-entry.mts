// @ts-nocheck
import rexCorePlugin from '@bric/rex-core/service-worker'

import '../../src/service-worker.mjs'
import { hasListEntries, listsLoaded, registeredDomainOf } from '../../src/list-utilities.mjs'

chrome.runtime.onMessage.addListener(rexCorePlugin.handleMessage)

self.listsLoaded = listsLoaded
self.hasListEntries = hasListEntries
self.registeredDomainOf = registeredDomainOf

self.sendRexMessage = (message) => {
  return new Promise((resolve) => {
    rexCorePlugin.handleMessage(message, null, resolve)
  })
}
