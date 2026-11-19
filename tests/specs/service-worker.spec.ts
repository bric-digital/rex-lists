// @ts-nocheck
import { expect, injectConfiguration, test } from '../utils/extension'

test('lists in configuration are loaded by the module', async ({ serviceWorker }) => {
  expect(await serviceWorker.evaluate(() => self.listsLoaded())).toBe(false)
  await injectConfiguration(serviceWorker, { lists: { news: [{ pattern: 'example.com', pattern_type: 'domain' }] } })
  await expect.poll(() => serviceWorker.evaluate(() => self.hasListEntries('news'))).toBe(true)
  expect(await serviceWorker.evaluate(() => self.listsLoaded())).toBe(true)
})

test('registeredDomainOf', async ({ serviceWorker }) => {
  const result = await serviceWorker.evaluate(() => [
    self.registeredDomainOf('https://mail.example.co.uk/a'),
    self.registeredDomainOf('http://127.0.0.1:8080/'),
    self.registeredDomainOf('not a url'),
  ])
  expect(result).toEqual(['example.co.uk', '', ''])
})
