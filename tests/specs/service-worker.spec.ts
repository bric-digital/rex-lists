// @ts-nocheck
import { expect, extensionServiceWorker, injectConfiguration, launchExtension, newUserDataDir, test } from '../utils/extension'

const newsList = [{ pattern: 'example.com', pattern_type: 'domain' }]

test('lists in configuration are loaded by the module', async ({ serviceWorker }) => {
  expect(await serviceWorker.evaluate(() => self.listsLoaded())).toBe(false)
  await injectConfiguration(serviceWorker, { lists: { news: newsList } })
  await expect.poll(() => serviceWorker.evaluate(() => self.hasListEntries('news'))).toBe(true)
  await expect.poll(() => serviceWorker.evaluate(() => self.listsLoaded())).toBe(true)
})

test('lists count as loaded when configuration has no lists section', async ({ serviceWorker }) => {
  expect(await serviceWorker.evaluate(() => self.listsLoaded())).toBe(false)
  await injectConfiguration(serviceWorker, { other_module: { enabled: true } })
  await expect.poll(() => serviceWorker.evaluate(() => self.listsLoaded())).toBe(true)
})

test('lists count as loaded after an attempt with an invalid list', async ({ serviceWorker }) => {
  await injectConfiguration(serviceWorker, { lists: { news: newsList, broken: 5 } })
  await expect.poll(() => serviceWorker.evaluate(() => self.listsLoaded())).toBe(true)
  expect(await serviceWorker.evaluate(() => self.hasListEntries('news'))).toBe(true)
})

test('lists do not count as loaded while a sync is marked in progress', async ({ serviceWorker }) => {
  await injectConfiguration(serviceWorker, { lists: { news: newsList } })
  await expect.poll(() => serviceWorker.evaluate(() => self.listsLoaded())).toBe(true)
  await serviceWorker.evaluate(() => chrome.storage.local.set({ rexListsSyncInProgress: true }))
  expect(await serviceWorker.evaluate(() => self.listsLoaded())).toBe(false)
})

test('a sync marker left by a stopped worker is cleared when the module starts again', async () => {
  const userDataDir = newUserDataDir()
  const firstContext = await launchExtension(userDataDir)
  const firstWorker = await extensionServiceWorker(firstContext)

  await injectConfiguration(firstWorker, { lists: { news: newsList } })
  await expect.poll(() => firstWorker.evaluate(() => self.listsLoaded())).toBe(true)
  await firstWorker.evaluate(() => chrome.storage.local.set({ rexListsSyncInProgress: true }))
  expect(await firstWorker.evaluate(() => self.listsLoaded())).toBe(false)
  await firstContext.close()

  const secondContext = await launchExtension(userDataDir)
  const secondWorker = await extensionServiceWorker(secondContext)

  await expect.poll(() => secondWorker.evaluate(() => self.listsLoaded())).toBe(true)
  await secondContext.close()
})

test('a reader never sees lists loaded while a newly named list is still empty', async ({ serviceWorker }) => {
  await injectConfiguration(serviceWorker, { lists: { news: newsList } })
  await expect.poll(() => serviceWorker.evaluate(() => self.listsLoaded())).toBe(true)

  const newList = []

  for (let index = 0; index < 500; index += 1) {
    newList.push({ pattern: `site${index}.com`, pattern_type: 'domain' })
  }

  const observed = await serviceWorker.evaluate(async (configuration) => {
    await self.sendRexMessage({ messageType: 'updateConfiguration', configuration })

    let loadedWhileEmpty = 0

    for (let read = 0; read < 100000; read += 1) {
      const loaded = await self.listsLoaded()
      const hasEntries = await self.hasListEntries('new-list')

      if (loaded === true && hasEntries === false) {
        loadedWhileEmpty += 1
      }

      if (loaded === true && hasEntries === true) {
        return { loadedWhileEmpty, settled: true }
      }
    }

    return { loadedWhileEmpty, settled: false }
  }, { lists: { news: newsList, 'new-list': newList } })

  expect(observed).toEqual({ loadedWhileEmpty: 0, settled: true })
})

test('registeredDomainOf', async ({ serviceWorker }) => {
  const result = await serviceWorker.evaluate(() => [
    self.registeredDomainOf('https://mail.example.co.uk/a'),
    self.registeredDomainOf('http://127.0.0.1:8080/'),
    self.registeredDomainOf('not a url'),
    self.registeredDomainOf('http://[::1]/'),
    self.registeredDomainOf('http://localhost/'),
  ])
  expect(result).toEqual(['example.co.uk', '', '', '', ''])
})
