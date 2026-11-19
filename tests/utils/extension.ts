// @ts-nocheck
import { chromium, expect, test as base } from '@playwright/test'
import type { BrowserContext, Worker } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const extensionPath = resolve(dirname(fileURLToPath(import.meta.url)), '../extension')

export function newUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'rex-lists-'))
}

export function launchExtension(userDataDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })
}

export async function extensionServiceWorker(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers()

  if (worker === undefined) {
    worker = await context.waitForEvent('serviceworker')
  }

  await expect.poll(() => worker.evaluate(() => typeof self.registeredDomainOf === 'function')).toBe(true)

  return worker
}

export const test = base.extend<{ serviceWorker: Worker }>({
  context: async ({}, use) => {
    const context = await launchExtension(newUserDataDir())

    await use(context)
    await context.close()
  },

  serviceWorker: async ({ context }, use) => {
    const worker = await extensionServiceWorker(context)

    await use(worker)
  },
})

export { expect }

export async function injectConfiguration(serviceWorker: Worker, configuration: Record<string, unknown>): Promise<void> {
  await serviceWorker.evaluate((value) => {
    return self.sendRexMessage({ messageType: 'updateConfiguration', configuration: value })
  }, configuration)
}
