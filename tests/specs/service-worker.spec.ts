// @ts-nocheck
import { expect, injectConfiguration, test } from '../utils/extension'

const newsList = [{ pattern: 'example.com', pattern_type: 'domain' }]

function manyEntries(count) {
  const entries = []

  for (let index = 0; index < count; index += 1) {
    entries.push({ pattern: `site${index}.com`, pattern_type: 'domain' })
  }

  return entries
}

async function holdConfigurationWithoutRefresh(serviceWorker, configuration) {
  await serviceWorker.evaluate((value) => chrome.storage.local.set({ REXConfiguration: value }), configuration)
}

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

test('lists count as loaded after an attempt in which one list failed to store', async ({ serviceWorker }) => {
  const lists = {
    news: newsList,
    failing: [{ pattern: 'other.com', pattern_type: 'domain', metadata: {} }],
  }

  await holdConfigurationWithoutRefresh(serviceWorker, { lists })
  expect(await serviceWorker.evaluate(() => self.listsLoaded())).toBe(false)

  const result = await serviceWorker.evaluate(async (given) => {
    const unstorable = { ...given, failing: [{ ...given.failing[0], metadata: { notStorable: () => true } }] }

    await self.parseAndSyncLists(unstorable)

    return {
      loaded: await self.listsLoaded(),
      news: await self.hasListEntries('news'),
      failing: await self.hasListEntries('failing'),
    }
  }, lists)

  expect(result).toEqual({ loaded: true, news: true, failing: false })
})

test('unchanged configuration stays loaded while the module starts again', async ({ serviceWorker }) => {
  await injectConfiguration(serviceWorker, { lists: { news: newsList } })
  await expect.poll(() => serviceWorker.evaluate(() => self.listsLoaded())).toBe(true)

  const notLoadedReads = await serviceWorker.evaluate(async () => {
    let finished = false
    let notLoaded = 0

    const started = Promise.resolve(self.listsModule.setup()).then(() => {
      finished = true
    })

    while (finished === false) {
      if (await self.listsLoaded() === false) {
        notLoaded += 1
      }
    }

    await started

    if (await self.listsLoaded() === false) {
      notLoaded += 1
    }

    return notLoaded
  })

  expect(notLoadedReads).toBe(0)
})

test('changed lists held by rex-core are not loaded until their sync finishes', async ({ serviceWorker }) => {
  await injectConfiguration(serviceWorker, { lists: { news: newsList } })
  await expect.poll(() => serviceWorker.evaluate(() => self.listsLoaded())).toBe(true)

  await holdConfigurationWithoutRefresh(serviceWorker, { lists: { news: newsList, 'new-list': manyEntries(50) } })

  expect(await serviceWorker.evaluate(() => self.listsLoaded())).toBe(false)
  expect(await serviceWorker.evaluate(() => self.hasListEntries('new-list'))).toBe(false)

  await serviceWorker.evaluate(() => self.listsModule.refreshConfiguration())

  await expect.poll(() => serviceWorker.evaluate(() => self.listsLoaded())).toBe(true)
  expect(await serviceWorker.evaluate(() => self.hasListEntries('new-list'))).toBe(true)
})

test('a reader never sees lists loaded while a newly named list is still empty', async ({ serviceWorker }) => {
  await injectConfiguration(serviceWorker, { lists: { news: newsList } })
  await expect.poll(() => serviceWorker.evaluate(() => self.listsLoaded())).toBe(true)

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
  }, { lists: { news: newsList, 'new-list': manyEntries(500) } })

  expect(observed).toEqual({ loadedWhileEmpty: 0, settled: true })
})

test('registeredDomainOf', async ({ serviceWorker }) => {
  const result = await serviceWorker.evaluate(() => [
    self.registeredDomainOf('https://mail.example.co.uk/a'),
    self.registeredDomainOf('http://127.0.0.1:8080/'),
    self.registeredDomainOf('not a url'),
    self.registeredDomainOf('http://[::1]/'),
    self.registeredDomainOf('http://localhost/'),
    self.registeredDomainOf('about:blank'),
  ])
  expect(result).toEqual(['example.co.uk', '127.0.0.1', '', '[::1]', 'localhost', ''])
})
