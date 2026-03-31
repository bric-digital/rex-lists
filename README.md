# rex-lists

Core list storage and URL matching utilities for REX browser extensions.

## Overview

**rex-lists** provides:

- IndexedDB-backed storage for domain/URL pattern lists
- URL matching against multiple pattern types
- List management API (add, remove, query entries)
- Support for backend-synced and user-defined entries

This module is the storage/matching layer. For the UI and sync functionality, see [rex-lists-front-end](https://github.com/bric-digital/rex-lists-front-end).

## Configuration

This module reads from the `lists` section of the backend config.

### Schema

The `lists` object contains named lists, where each list is an array of pattern entries:

```
{
  "lists": {
    "<list_name>": [ <entry>, <entry>, ... ],
    "<list_name>": [ ... ]
  }
}
```

### Entry Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | string | Yes | The pattern to match (format depends on `pattern_type`) |
| `pattern_type` | string | Yes | One of: `domain`, `host`, `subdomain_wildcard`, `exact_url`, `host_path_prefix`, `regex` |
| `metadata` | object | No | Arbitrary metadata (e.g., `category`, `name`, `description`) |

### Pattern Types

| Pattern Type | Description | Example Pattern | Matches |
|--------------|-------------|-----------------|---------|
| `domain` | Registered domain only (eTLD+1). Uses Public Suffix List. | `google.com` | `https://www.google.com/maps`, `https://mail.google.com` |
| `host` | Exact hostname match. Leading `www.` is normalized. | `mail.google.com` | `https://mail.google.com/inbox` |
| `subdomain_wildcard` | Server-side alias for `host`. Identical behavior. | `mail.google.com` | `https://mail.google.com/inbox` |
| `exact_url` | Full URL must match exactly. | `https://example.com/login` | Only that exact URL |
| `host_path_prefix` | Hostname + path prefix. Query string ignored. | `example.com/maps` | `https://example.com/maps/directions` |
| `regex` | JavaScript regex applied to full URL. | `^https://(www\.)?example\.com/.*` | `https://example.com/anything` |

**Note**: Backend sync (`mergeBackendList`) also accepts `domain` as a fallback field name for backwards compatibility — if `pattern` is not present, it reads `domain` instead. New configurations should use `pattern`.

### Example

```json
{
  "lists": {
    "serp": [
      {
        "pattern": "google.com/search",
        "pattern_type": "host_path_prefix",
        "metadata": { "name": "Google Search", "category": "serp" }
      },
      {
        "pattern": "bing.com/search",
        "pattern_type": "host_path_prefix",
        "metadata": { "name": "Bing Search", "category": "serp" }
      },
      {
        "pattern": "^https?://(www\\.)?duckduckgo\\.com/.*[?&]q=",
        "pattern_type": "regex",
        "metadata": { "name": "DuckDuckGo Search", "category": "serp" }
      }
    ],
    "news-sites": [
      {
        "pattern": "nytimes.com",
        "pattern_type": "domain",
        "metadata": { "name": "New York Times", "category": "news" }
      },
      {
        "pattern": "cnn.com",
        "pattern_type": "domain",
        "metadata": { "name": "CNN", "category": "news" }
      }
    ],
    "ai-chatbots": [
      {
        "pattern": "chatgpt.com",
        "pattern_type": "domain",
        "metadata": { "name": "ChatGPT", "category": "AI Chatbot" }
      },
      {
        "pattern": "perplexity.ai",
        "pattern_type": "domain",
        "metadata": { "name": "Perplexity", "category": "AI Chatbot" }
      },
      {
        "pattern": "claude.ai",
        "pattern_type": "domain",
        "metadata": { "name": "Claude", "category": "AI Chatbot" }
      }
    ],
    "history-filter": [
      {
        "pattern": "msn.com/en-us/play",
        "pattern_type": "host_path_prefix",
        "metadata": { "category": "entertainment" }
      }
    ]
  }
}
```

### How Lists Are Used

Lists are referenced by name in other module configurations:

- **rex-history**: Uses `allow_lists`, `filter_lists`, `category_lists` to control what history is collected
- **rex-lists-front-end**: Displays and manages list entries

### Entry Sources

Each entry has a `source` field (set automatically):

| Source | Description |
|--------|-------------|
| `backend` | Synced from server configuration |
| `user` | Added manually by the user via UI |
| `generated` | Created programmatically (e.g., top domains) |

Backend sync replaces only `backend` entries, preserving `user` and `generated` entries.

## Data Storage

- **Database**: IndexedDB database `webmunk_lists`
- **Store**: `list_entries`
- **Uniqueness**: Entries are unique on `(list_name, pattern_type, pattern)`

## Installation

Add to your extension's `package.json` dependencies:

```json
{
  "dependencies": {
    "@bric/rex-lists": "github:bric-digital/rex-lists#main"
  }
}
```

Then run `npm install`.

## API

```typescript
import {
  matchDomainAgainstList,
  getListEntries,
  createListEntry,
  findListEntry,
  findListEntryByPattern,
  deleteListEntry,
  deleteAllEntriesInList,
  bulkCreateListEntries,
  bulkDeleteListEntries,
  updateListEntry,
  getAllLists,
  exportList,
  importList,
  syncListsFromConfig,
  parseAndSyncLists,
  mergeBackendList,
  matchesPattern,
  setDebug
} from '@bric/rex-lists'

// Check if URL matches any entry in a list
const match = await matchDomainAgainstList('https://www.google.com/search?q=test', 'serp')

// Get all entries for a list
const entries = await getListEntries('news-sites')

// Add a user entry
await createListEntry({
  list_name: 'news-sites',
  pattern: 'example-news.com',
  pattern_type: 'domain',
  source: 'user',
  metadata: { name: 'Example News' }
})

// Find a specific entry
const entry = await findListEntryByPattern('news-sites', 'domain', 'cnn.com')

// Check a single pattern match (synchronous)
const isMatch = matchesPattern('https://www.google.com/maps', 'google.com', 'domain')
```

## License

Apache 2.0
