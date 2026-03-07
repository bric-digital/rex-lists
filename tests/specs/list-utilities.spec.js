import { test, expect } from '@playwright/test';

/**
 * Comprehensive test suite for webmunk-core list utilities
 * Tests IndexedDB operations, CRUD, pattern matching, and bulk operations
 */

test.describe('List Utilities - Database Initialization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);

    // Clear database before each test
    await page.evaluate(() => window.clearDatabase());
    await page.waitForTimeout(100); // Give time for DB to clear
  });

  test('should initialize database successfully', async ({ page }) => {
    const dbName = await page.evaluate(async () => {
      const db = await window.ListUtilities.initializeListDatabase();
      return db.name;
    });

    expect(dbName).toBe('webmunk_lists');
  });

  test('should create object store with correct indexes', async ({ page }) => {
    const storeInfo = await page.evaluate(async () => {
      const db = await window.ListUtilities.initializeListDatabase();
      const store = db.transaction('list_entries', 'readonly').objectStore('list_entries');

      return {
        hasListNameIndex: store.indexNames.contains('list_name'),
        hasPatternIndex: store.indexNames.contains('pattern'),
        hasCompoundIndex: store.indexNames.contains('list_name_pattern'),
        hasUniquePatternIndex: store.indexNames.contains('list_name_pattern_type_pattern'),
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement
      };
    });

    expect(storeInfo.hasListNameIndex).toBe(true);
    expect(storeInfo.hasPatternIndex).toBe(true);
    expect(storeInfo.hasCompoundIndex).toBe(true);
    expect(storeInfo.hasUniquePatternIndex).toBe(true);
    expect(storeInfo.keyPath).toBe('id');
    expect(storeInfo.autoIncrement).toBe(true);
  });
});

test.describe('List Utilities - CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
    await page.evaluate(() => window.clearDatabase());
    await page.waitForTimeout(100);
  });

  test('should create a list entry', async ({ page }) => {
    const entryId = await page.evaluate(async () => {
      return await window.ListUtilities.createListEntry({
        list_name: 'test-list',
        pattern: 'example.com',
        pattern_type: 'domain',
        metadata: {
          category: 'test',
          description: 'Test domain'
        }
      });
    });

    expect(entryId).toBeGreaterThan(0);
  });

  test('should retrieve list entries', async ({ page }) => {
    // Create entries
    await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'test-list',
        pattern: 'example.com',
        pattern_type: 'domain',
        metadata: { category: 'test' }
      });
      await window.ListUtilities.createListEntry({
        list_name: 'test-list',
        pattern: 'test.com',
        pattern_type: 'domain',
        metadata: { category: 'test' }
      });
    });

    const entries = await page.evaluate(async () => {
      return await window.ListUtilities.getListEntries('test-list');
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].pattern).toBeTruthy();
    expect(entries[0].metadata.created_at).toBeTruthy();
    expect(entries[0].metadata.updated_at).toBeTruthy();
  });

  test('should update a list entry', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const id = await window.ListUtilities.createListEntry({
        list_name: 'test-list',
        pattern: 'example.com',
        pattern_type: 'domain',
        metadata: { category: 'original' }
      });

      await window.ListUtilities.updateListEntry(id, {
        metadata: { category: 'updated', description: 'Updated entry' }
      });

      const entries = await window.ListUtilities.getListEntries('test-list');
      return entries[0];
    });

    expect(result.metadata.category).toBe('updated');
    expect(result.metadata.description).toBe('Updated entry');
  });

  test('should delete a list entry', async ({ page }) => {
    const entriesCount = await page.evaluate(async () => {
      const id = await window.ListUtilities.createListEntry({
        list_name: 'test-list',
        pattern: 'example.com',
        pattern_type: 'domain',
        metadata: {}
      });

      await window.ListUtilities.deleteListEntry(id);
      const entries = await window.ListUtilities.getListEntries('test-list');
      return entries.length;
    });

    expect(entriesCount).toBe(0);
  });

  test('should delete all entries in a list', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // Create multiple entries
      await window.ListUtilities.createListEntry({
        list_name: 'test-list',
        pattern: 'example1.com',
        pattern_type: 'domain',
        metadata: {}
      });
      await window.ListUtilities.createListEntry({
        list_name: 'test-list',
        pattern: 'example2.com',
        pattern_type: 'domain',
        metadata: {}
      });
      await window.ListUtilities.createListEntry({
        list_name: 'other-list',
        pattern: 'other.com',
        pattern_type: 'domain',
        metadata: {}
      });

      await window.ListUtilities.deleteAllEntriesInList('test-list');

      return {
        testListCount: (await window.ListUtilities.getListEntries('test-list')).length,
        otherListCount: (await window.ListUtilities.getListEntries('other-list')).length
      };
    });

    expect(result.testListCount).toBe(0);
    expect(result.otherListCount).toBe(1);
  });
});

test.describe('List Utilities - Query Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
    await page.evaluate(() => window.clearDatabase());
    await page.waitForTimeout(100);
  });

  test('should find a specific list entry', async ({ page }) => {
    const found = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'test-list',
        pattern: 'example.com',
        pattern_type: 'domain',
        metadata: { category: 'findme' }
      });

      return await window.ListUtilities.findListEntry('test-list', 'example.com');
    });

    expect(found).toBeTruthy();
    expect(found.pattern).toBe('example.com');
    expect(found.metadata.category).toBe('findme');
  });

  test('should return null for non-existent entry', async ({ page }) => {
    const found = await page.evaluate(async () => {
      return await window.ListUtilities.findListEntry('test-list', 'nonexistent.com');
    });

    expect(found).toBeNull();
  });

  test('should match domain against list', async ({ page }) => {
    const match = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'blocked-sites',
        pattern: 'example.com',
        pattern_type: 'domain',
        metadata: { category: 'blocked' }
      });

      return await window.ListUtilities.matchDomainAgainstList(
        'https://www.example.com/page',
        'blocked-sites'
      );
    });

    expect(match).toBeTruthy();
    expect(match.pattern).toBe('example.com');
  });

  test('should get all unique list names', async ({ page }) => {
    const lists = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'list-a',
        pattern: 'a.com',
        pattern_type: 'domain',
        metadata: {}
      });
      await window.ListUtilities.createListEntry({
        list_name: 'list-b',
        pattern: 'b.com',
        pattern_type: 'domain',
        metadata: {}
      });
      await window.ListUtilities.createListEntry({
        list_name: 'list-a',
        pattern: 'a2.com',
        pattern_type: 'domain',
        metadata: {}
      });

      return await window.ListUtilities.getAllLists();
    });

    expect(lists).toContain('list-a');
    expect(lists).toContain('list-b');
    expect(lists.length).toBeGreaterThanOrEqual(2);
  });
});

test.describe('List Utilities - Pattern Matching: domain', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
  });

  // Pattern: 'bric.digital'
  // Matches the registered domain (eTLD+1) regardless of subdomain or path.

  test('matches the bare registered domain', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital', 'bric.digital', 'domain')
    );
    expect(result).toBe(true);
  });

  test('matches with www prefix on the URL', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://www.bric.digital', 'bric.digital', 'domain')
    );
    expect(result).toBe(true);
  });

  test('matches a subdomain of the registered domain', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://ssm.bric.digital/path', 'bric.digital', 'domain')
    );
    expect(result).toBe(true);
  });

  test('matches a deep subdomain of the registered domain', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://a.b.bric.digital/', 'bric.digital', 'domain')
    );
    expect(result).toBe(true);
  });

  test('does not match a different registered domain', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://notbric.digital', 'bric.digital', 'domain')
    );
    expect(result).toBe(false);
  });

  test('does not match a domain that merely contains the pattern as a substring', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://mybric.digital', 'bric.digital', 'domain')
    );
    expect(result).toBe(false);
  });

  test('rejects a subdomain used as a domain pattern (safety guard)', async ({ page }) => {
    // 'ssm.bric.digital' is not a registered domain (eTLD+1), so pattern_type:'domain' must not match
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://ssm.bric.digital', 'ssm.bric.digital', 'domain')
    );
    expect(result).toBe(false);
  });

  test('handles complex TLDs (co.uk)', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://www.bbc.co.uk/news', 'bbc.co.uk', 'domain')
    );
    expect(result).toBe(true);
  });
});

test.describe('List Utilities - Pattern Matching: host / subdomain_wildcard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
  });

  // Pattern: 'ssm.bric.digital'
  // Matches only that exact hostname (normalizing leading www).
  // 'host' and 'subdomain_wildcard' are aliases — both tested below.

  test('host: matches the exact subdomain hostname', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://ssm.bric.digital/page', 'ssm.bric.digital', 'host')
    );
    expect(result).toBe(true);
  });

  test('host: does not match the parent registered domain', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital', 'ssm.bric.digital', 'host')
    );
    expect(result).toBe(false);
  });

  test('host: does not match a sibling subdomain', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://other.bric.digital', 'ssm.bric.digital', 'host')
    );
    expect(result).toBe(false);
  });

  test('host: normalizes www on the URL side', async ({ page }) => {
    // www.ssm.bric.digital -> strips www -> ssm.bric.digital (matches)
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://www.ssm.bric.digital/', 'ssm.bric.digital', 'host')
    );
    expect(result).toBe(true);
  });

  test('subdomain_wildcard: matches the exact hostname', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://ssm.bric.digital/data', 'ssm.bric.digital', 'subdomain_wildcard')
    );
    expect(result).toBe(true);
  });

  test('subdomain_wildcard: does not match parent domain', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital', 'ssm.bric.digital', 'subdomain_wildcard')
    );
    expect(result).toBe(false);
  });
});

test.describe('List Utilities - Pattern Matching: exact_url', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
  });

  // Pattern: 'https://bric.digital/'
  // Must be character-for-character identical.

  test('matches the exact URL', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital/', 'https://bric.digital/', 'exact_url')
    );
    expect(result).toBe(true);
  });

  test('does not match the same URL without trailing slash', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital', 'https://bric.digital/', 'exact_url')
    );
    expect(result).toBe(false);
  });

  test('does not match a URL with an extra path', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital/about', 'https://bric.digital/', 'exact_url')
    );
    expect(result).toBe(false);
  });

  test('does not match a different scheme', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('http://bric.digital/', 'https://bric.digital/', 'exact_url')
    );
    expect(result).toBe(false);
  });
});

test.describe('List Utilities - Pattern Matching: host_path_prefix', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
  });

  // Pattern: 'bric.digital/about'
  // Matches any URL whose host is bric.digital and whose path starts with /about.

  test('matches a URL whose path starts with the prefix', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital/about', 'bric.digital/about', 'host_path_prefix')
    );
    expect(result).toBe(true);
  });

  test('matches a URL with additional path segments after the prefix', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital/about/team', 'bric.digital/about', 'host_path_prefix')
    );
    expect(result).toBe(true);
  });

  test('matches when the pattern is given as a full URL', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern(
        'https://bric.digital/about/team',
        'https://bric.digital/about',
        'host_path_prefix'
      )
    );
    expect(result).toBe(true);
  });

  test('does not match a URL on a different path', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital/contact', 'bric.digital/about', 'host_path_prefix')
    );
    expect(result).toBe(false);
  });

  test('does not match a different host', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://other.digital/about', 'bric.digital/about', 'host_path_prefix')
    );
    expect(result).toBe(false);
  });

  test('normalizes www on the URL host', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://www.bric.digital/about/us', 'bric.digital/about', 'host_path_prefix')
    );
    expect(result).toBe(true);
  });

  test('pattern without a path component does not match', async ({ page }) => {
    // host_path_prefix requires a "/" — a bare hostname is not a valid prefix pattern
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital/about', 'bric.digital', 'host_path_prefix')
    );
    expect(result).toBe(false);
  });
});

test.describe('List Utilities - Pattern Matching: regex', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
  });

  // Pattern: '.*ric\\.dig.*'
  // Tests against the full URL string.

  test('matches a URL that satisfies the regex', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital/page', '.*ric\\.dig.*', 'regex')
    );
    expect(result).toBe(true);
  });

  test('matches a subdomain URL that satisfies the regex', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://ssm.bric.digital/', '.*ric\\.dig.*', 'regex')
    );
    expect(result).toBe(true);
  });

  test('does not match a URL that does not satisfy the regex', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://example.com/', '.*ric\\.dig.*', 'regex')
    );
    expect(result).toBe(false);
  });

  test('anchored regex only matches at the intended position', async ({ page }) => {
    const match = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital/', '^https://bric\\.digital/', 'regex')
    );
    const noMatch = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('http://bric.digital/', '^https://bric\\.digital/', 'regex')
    );
    expect(match).toBe(true);
    expect(noMatch).toBe(false);
  });

  test('handles an invalid regex gracefully (returns false, does not throw)', async ({ page }) => {
    const result = await page.evaluate(() =>
      window.ListUtilities.matchesPattern('https://bric.digital/', '[invalid(regex', 'regex')
    );
    expect(result).toBe(false);
  });
});

test.describe('List Utilities - matchDomainAgainstList end-to-end', () => {
  // These tests go through the full pipeline: insert an entry into IndexedDB,
  // then call matchDomainAgainstList and assert on the returned ListEntry.
  // This verifies that pattern matching works correctly in the real DB roundtrip,
  // not just as a unit call to matchesPattern.

  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
    await page.evaluate(() => window.clearDatabase());
    await page.waitForTimeout(100);
  });

  test('domain pattern: URL with subdomain matches registered domain entry', async ({ page }) => {
    const match = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'e2e-list',
        pattern: 'bric.digital',
        pattern_type: 'domain',
        source: 'backend',
        metadata: { category: 'tech' }
      });
      return await window.ListUtilities.matchDomainAgainstList(
        'https://ssm.bric.digital/dashboard',
        'e2e-list'
      );
    });
    expect(match).not.toBeNull();
    expect(match.pattern).toBe('bric.digital');
    expect(match.pattern_type).toBe('domain');
    expect(match.metadata.category).toBe('tech');
  });

  test('domain pattern: unrelated domain does not match', async ({ page }) => {
    const match = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'e2e-list',
        pattern: 'bric.digital',
        pattern_type: 'domain',
        source: 'backend',
        metadata: {}
      });
      return await window.ListUtilities.matchDomainAgainstList('https://example.com/', 'e2e-list');
    });
    expect(match).toBeNull();
  });

  test('host pattern: exact subdomain hostname matches', async ({ page }) => {
    const match = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'e2e-list',
        pattern: 'ssm.bric.digital',
        pattern_type: 'host',
        source: 'backend',
        metadata: {}
      });
      return await window.ListUtilities.matchDomainAgainstList(
        'https://ssm.bric.digital/page',
        'e2e-list'
      );
    });
    expect(match).not.toBeNull();
    expect(match.pattern_type).toBe('host');
  });

  test('host pattern: parent domain does not match', async ({ page }) => {
    const match = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'e2e-list',
        pattern: 'ssm.bric.digital',
        pattern_type: 'host',
        source: 'backend',
        metadata: {}
      });
      return await window.ListUtilities.matchDomainAgainstList('https://bric.digital/', 'e2e-list');
    });
    expect(match).toBeNull();
  });

  test('exact_url pattern: matches only the exact URL', async ({ page }) => {
    const match = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'e2e-list',
        pattern: 'https://bric.digital/',
        pattern_type: 'exact_url',
        source: 'backend',
        metadata: {}
      });
      return await window.ListUtilities.matchDomainAgainstList('https://bric.digital/', 'e2e-list');
    });
    expect(match).not.toBeNull();
    expect(match.pattern_type).toBe('exact_url');
  });

  test('exact_url pattern: URL with extra path does not match', async ({ page }) => {
    const match = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'e2e-list',
        pattern: 'https://bric.digital/',
        pattern_type: 'exact_url',
        source: 'backend',
        metadata: {}
      });
      return await window.ListUtilities.matchDomainAgainstList('https://bric.digital/extra', 'e2e-list');
    });
    expect(match).toBeNull();
  });

  test('host_path_prefix pattern: URL under the prefix matches', async ({ page }) => {
    const match = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'e2e-list',
        pattern: 'bric.digital/about',
        pattern_type: 'host_path_prefix',
        source: 'backend',
        metadata: {}
      });
      return await window.ListUtilities.matchDomainAgainstList(
        'https://bric.digital/about/team',
        'e2e-list'
      );
    });
    expect(match).not.toBeNull();
    expect(match.pattern_type).toBe('host_path_prefix');
  });

  test('host_path_prefix pattern: URL on a different path does not match', async ({ page }) => {
    const match = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'e2e-list',
        pattern: 'bric.digital/about',
        pattern_type: 'host_path_prefix',
        source: 'backend',
        metadata: {}
      });
      return await window.ListUtilities.matchDomainAgainstList(
        'https://bric.digital/contact',
        'e2e-list'
      );
    });
    expect(match).toBeNull();
  });

  test('regex pattern: URL matching the pattern is found', async ({ page }) => {
    const match = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'e2e-list',
        pattern: '.*ric\\.dig.*',
        pattern_type: 'regex',
        source: 'backend',
        metadata: { category: 'bric-sites' }
      });
      return await window.ListUtilities.matchDomainAgainstList(
        'https://bric.digital/page',
        'e2e-list'
      );
    });
    expect(match).not.toBeNull();
    expect(match.pattern_type).toBe('regex');
    expect(match.metadata.category).toBe('bric-sites');
  });

  test('regex pattern: non-matching URL returns null', async ({ page }) => {
    const match = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'e2e-list',
        pattern: '.*ric\\.dig.*',
        pattern_type: 'regex',
        source: 'backend',
        metadata: {}
      });
      return await window.ListUtilities.matchDomainAgainstList('https://example.com/', 'e2e-list');
    });
    expect(match).toBeNull();
  });

  test('returns null when the list does not exist', async ({ page }) => {
    const match = await page.evaluate(async () =>
      await window.ListUtilities.matchDomainAgainstList('https://bric.digital/', 'no-such-list')
    );
    expect(match).toBeNull();
  });

  test('returns the first matching entry when multiple entries are present', async ({ page }) => {
    const match = await page.evaluate(async () => {
      await window.ListUtilities.bulkCreateListEntries([
        { list_name: 'e2e-list', pattern: 'example.com', pattern_type: 'domain', source: 'backend', metadata: { category: 'other' } },
        { list_name: 'e2e-list', pattern: 'bric.digital', pattern_type: 'domain', source: 'backend', metadata: { category: 'tech' } }
      ]);
      return await window.ListUtilities.matchDomainAgainstList('https://bric.digital/', 'e2e-list');
    });
    expect(match).not.toBeNull();
    expect(match.pattern).toBe('bric.digital');
    expect(match.metadata.category).toBe('tech');
  });
});

test.describe('List Utilities - Bulk Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
    await page.evaluate(() => window.clearDatabase());
    await page.waitForTimeout(100);
  });

  test('should bulk create entries', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const entries = [
        { list_name: 'bulk-test', pattern: 'site1.com', pattern_type: 'domain', metadata: {} },
        { list_name: 'bulk-test', pattern: 'site2.com', pattern_type: 'domain', metadata: {} },
        { list_name: 'bulk-test', pattern: 'site3.com', pattern_type: 'domain', metadata: {} }
      ];

      const ids = await window.ListUtilities.bulkCreateListEntries(entries);
      const retrieved = await window.ListUtilities.getListEntries('bulk-test');

      return { idsCount: ids.length, entriesCount: retrieved.length };
    });

    expect(result.idsCount).toBe(3);
    expect(result.entriesCount).toBe(3);
  });

  test('should export list to JSON', async ({ page }) => {
    const exported = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'export-test',
        pattern: 'example.com',
        pattern_type: 'domain',
        metadata: { category: 'test' }
      });

      return await window.ListUtilities.exportList('export-test');
    });

    const data = JSON.parse(exported);
    expect(data.list_name).toBe('export-test');
    expect(data.version).toBe(1);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].pattern).toBe('example.com');
    expect(data.exported_at).toBeTruthy();
  });

  test('should import list from JSON', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const importData = {
        list_name: 'import-test',
        version: 1,
        entries: [
          { pattern: 'imported1.com', pattern_type: 'domain', metadata: { source: 'import' } },
          { pattern: 'imported2.com', pattern_type: 'domain', metadata: { source: 'import' } }
        ]
      };

      const count = await window.ListUtilities.importList('import-test', JSON.stringify(importData));
      const entries = await window.ListUtilities.getListEntries('import-test');

      return { importCount: count, entriesCount: entries.length, firstEntry: entries[0] };
    });

    expect(result.importCount).toBe(2);
    expect(result.entriesCount).toBe(2);
    expect(result.firstEntry.metadata.source).toBe('import');
  });

  test('should replace existing entries on import', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // Create initial entries
      await window.ListUtilities.createListEntry({
        list_name: 'replace-test',
        pattern: 'old.com',
        pattern_type: 'domain',
        metadata: {}
      });

      // Import new data (should replace)
      const importData = {
        list_name: 'replace-test',
        version: 1,
        entries: [
          { pattern: 'new.com', pattern_type: 'domain', metadata: {} }
        ]
      };

      await window.ListUtilities.importList('replace-test', JSON.stringify(importData));
      const entries = await window.ListUtilities.getListEntries('replace-test');

      return { count: entries.length, pattern: entries[0].pattern };
    });

    expect(result.count).toBe(1);
    expect(result.pattern).toBe('new.com');
  });
});

test.describe('List Utilities - Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
    await page.evaluate(() => window.clearDatabase());
    await page.waitForTimeout(100);
  });

  test('should reject duplicate entries', async ({ page }) => {
    const error = await page.evaluate(async () => {
      try {
        await window.ListUtilities.createListEntry({
          list_name: 'dup-test',
          pattern: 'duplicate.com',
          pattern_type: 'domain',
          metadata: {}
        });
        await window.ListUtilities.createListEntry({
          list_name: 'dup-test',
          pattern: 'duplicate.com',
          pattern_type: 'domain',
          metadata: {}
        });
        return null;
      } catch (err) {
        return err.message;
      }
    });

    expect(error).toBeTruthy();
    expect(error).toContain('Failed to create entry');
  });

  test('should allow same domain string with different pattern types', async ({ page }) => {
    const result = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'mixed-patterns',
        pattern: 'example.com',
        pattern_type: 'domain',
        metadata: {}
      });

      await window.ListUtilities.createListEntry({
        list_name: 'mixed-patterns',
        pattern: 'example.com',
        pattern_type: 'host',
        metadata: {}
      });

      const entries = await window.ListUtilities.getListEntries('mixed-patterns');
      return entries.map(e => e.pattern_type).sort();
    });

    expect(result).toEqual(['domain', 'host']);
  });

  test('should allow multiple regex patterns in the same list', async ({ page }) => {
    const count = await page.evaluate(async () => {
      await window.ListUtilities.createListEntry({
        list_name: 'regex-list',
        pattern: '.*(tiktok|snapchat).*',
        pattern_type: 'regex',
        metadata: {}
      });

      await window.ListUtilities.createListEntry({
        list_name: 'regex-list',
        pattern: '^https?://([a-z0-9-]+\\\\.)*(porn|pron|xxx)(/|$)',
        pattern_type: 'regex',
        metadata: {}
      });

      return (await window.ListUtilities.getListEntries('regex-list')).length;
    });

    expect(count).toBe(2);
  });

  test('should handle invalid regex patterns gracefully', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.ListUtilities.matchesPattern('https://test.com', '[invalid(regex', 'regex');
    });

    expect(result).toBe(false);
  });

  test('should handle invalid URLs gracefully', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.ListUtilities.matchesPattern('not-a-url', 'example.com', 'domain');
    });

    expect(result).toBe(false);
  });

  test('should handle update of non-existent entry', async ({ page }) => {
    const error = await page.evaluate(async () => {
      try {
        await window.ListUtilities.updateListEntry(999999, { pattern: 'new.com' });
        return null;
      } catch (err) {
        return err.message;
      }
    });

    expect(error).toBeTruthy();
    expect(error).toContain('not found');
  });
});

test.describe('List Utilities - Performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
    await page.evaluate(() => window.clearDatabase());
    await page.waitForTimeout(100);
  });

  test('should handle 100 entries efficiently', async ({ page }) => {
    const duration = await page.evaluate(async () => {
      const entries = [];
      for (let i = 0; i < 100; i++) {
        entries.push({
          list_name: 'perf-test',
          pattern: `domain${i}.com`,
          pattern_type: 'domain',
          metadata: { index: i }
        });
      }

      const start = performance.now();
      await window.ListUtilities.bulkCreateListEntries(entries);
      const end = performance.now();

      return end - start;
    });

    // Should complete in reasonable time (< 1 second)
    expect(duration).toBeLessThan(1000);
  });

  test('should retrieve entries efficiently', async ({ page }) => {
    const duration = await page.evaluate(async () => {
      const entries = [];
      for (let i = 0; i < 100; i++) {
        entries.push({
          list_name: 'retrieve-test',
          pattern: `domain${i}.com`,
          pattern_type: 'domain',
          metadata: {}
        });
      }

      await window.ListUtilities.bulkCreateListEntries(entries);

      const start = performance.now();
      await window.ListUtilities.getListEntries('retrieve-test');
      const end = performance.now();

      return end - start;
    });

    // Should retrieve in reasonable time (< 100ms)
    expect(duration).toBeLessThan(100);
  });
});
