import { isStrictRegisteredDomain } from './matching.mjs'
import { clearLastSyncedListsHash } from './loading.mjs'

// ============================================================================
// Types and Interfaces
// ============================================================================

// Pattern types:
// - domain: matches the registered domain (e.g., "google.com" matches "www.google.com")
// - host: matches the exact hostname (subdomain included), e.g., "health.google.com" only
export type PatternType = 'domain' | 'host' | 'subdomain_wildcard' | 'exact_url' | 'host_path_prefix' | 'regex'
export type EntrySource = 'backend' | 'user' | 'generated'

export interface ListEntry {
  id?: number
  list_name: string
  pattern: string
  pattern_type: PatternType
  source: EntrySource
  metadata: {
    category?: string
    description?: string
    tags?: string[]
    created_at?: number
    updated_at?: number
    sync_version?: number
    sync_timestamp?: number
    [key: string]: any // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

export interface SyncResult {
  success: boolean
  listsUpdated: string[]
  errors?: string[]
}

// ============================================================================
// Database Constants
// ============================================================================

const DB_NAME = 'webmunk_lists'
// v2: uniqueness is (list_name, pattern_type, domain). This allows multiple entries
// with the same "domain" string in a list when their semantics differ by pattern_type
// (e.g. 'domain' vs 'host'), and fixes collisions for non-domain patterns.
//
// v3: force upgrade in case a previous v2 build existed with the old unique
// list_name_domain index (Chrome won't rerun onupgradeneeded unless the version changes).
//
// v4: rename the 'domain' record field to 'pattern' (domain was misleading — it holds
// any pattern string, not just registered domains). Migrate existing records in-place and
// rename the 'domain', 'list_name_domain', and 'list_name_pattern_type_domain' indexes.
const DB_VERSION = 4
const STORE_NAME = 'list_entries'

// ============================================================================
// Database Initialization
// ============================================================================

/**
 * Initialize or open the IndexedDB database for list management
 * Creates the object store and indexes if needed
 */
export async function initializeListDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      reject(new Error(`Failed to open database: ${request.error?.message}`))
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true
        })
      }

      // Ensure indexes exist / match expected uniqueness.
      // Note: during upgrades, we can safely recreate indexes in-place.
      const transaction = (event.target as IDBOpenDBRequest).transaction
      if (!transaction) return
      const objectStore = transaction.objectStore(STORE_NAME)

      // v4 migration: rename the stored 'domain' field to 'pattern' on all existing records.
      // We open a cursor over the whole store and rewrite any record that still has 'domain'.
      if ((event.oldVersion ?? 0) < 4) {
        const cursorRequest = objectStore.openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const record = cursor.value as any
          if ('domain' in record && !('pattern' in record)) {
            record.pattern = record.domain
            delete record.domain
            cursor.update(record)
          }
          cursor.continue()
        }
      }

      // Basic indexes
      if (!objectStore.indexNames.contains('list_name')) {
        objectStore.createIndex('list_name', 'list_name', { unique: false })
      }
      // Remove old 'domain' index (renamed to 'pattern' in v4).
      if (objectStore.indexNames.contains('domain')) {
        objectStore.deleteIndex('domain')
      }
      if (!objectStore.indexNames.contains('pattern')) {
        objectStore.createIndex('pattern', 'pattern', { unique: false })
      }
      if (!objectStore.indexNames.contains('source')) {
        objectStore.createIndex('source', 'source', { unique: false })
      }
      if (!objectStore.indexNames.contains('list_name_source')) {
        objectStore.createIndex('list_name_source', ['list_name', 'source'], { unique: false })
      }

      // Compound indexes:
      // - list_name_pattern: non-unique helper index (convenience queries)
      // - list_name_pattern_type_pattern: unique index enforcing per-pattern uniqueness
      if (objectStore.indexNames.contains('list_name_domain')) {
        objectStore.deleteIndex('list_name_domain')
      }
      if (!objectStore.indexNames.contains('list_name_pattern')) {
        objectStore.createIndex('list_name_pattern', ['list_name', 'pattern'], { unique: false })
      }

      if (objectStore.indexNames.contains('list_name_pattern_type_domain')) {
        objectStore.deleteIndex('list_name_pattern_type_domain')
      }
      if (!objectStore.indexNames.contains('list_name_pattern_type_pattern')) {
        objectStore.createIndex(
          'list_name_pattern_type_pattern',
          ['list_name', 'pattern_type', 'pattern'],
          { unique: true }
        )
      }

      console.log('[list-utilities] Ensured object store and indexes')
    }
  })
}

/**
 * Get a database connection
 * Helper function to ensure database is initialized before operations
 */
async function getDatabase(): Promise<IDBDatabase> {
  return initializeListDatabase()
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new list entry
 * Automatically sets created_at and updated_at timestamps
 *
 * @throws Error if entry with same list_name and domain already exists
 */
export async function createListEntry(entry: Omit<ListEntry, 'id'>): Promise<number> {
  if (entry.pattern_type === 'domain' && !isStrictRegisteredDomain(entry.pattern)) {
    throw new Error(
      `Invalid 'domain' pattern "${entry.pattern}". ` +
      `Use a registered domain like "google.com", or use pattern_type "host"/"regex" for subdomains.`
    )
  }

  const db = await getDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    // Add timestamps
    const entryWithTimestamps = {
      ...entry,
      metadata: {
        ...entry.metadata,
        created_at: entry.metadata.created_at || Date.now(),
        updated_at: Date.now()
      }
    }

    const request = store.add(entryWithTimestamps)

    request.onsuccess = () => {
      resolve(request.result as number)
    }

    request.onerror = () => {
      reject(new Error(`Failed to create entry: ${request.error?.message}`))
    }
  })
}

/**
 * Get all entries for a specific list
 */
export async function getListEntries(listName: string): Promise<ListEntry[]> {
  const db = await getDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const index = store.index('list_name')
    const request = index.getAll(listName)

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      reject(new Error(`Failed to get list entries: ${request.error?.message}`))
    }
  })
}

export async function hasListEntries(listName: string): Promise<boolean> {
  const db = await getDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const index = store.index('list_name')
    const request = index.count(listName)

    request.onsuccess = () => {
      resolve(request.result > 0)
    }

    request.onerror = () => {
      reject(new Error(`Failed to count list entries: ${request.error?.message}`))
    }
  })
}

/**
 * Get entries for a specific list filtered by source
 */
export async function getListEntriesBySource(
  listName: string,
  source: EntrySource
): Promise<ListEntry[]> {
  const db = await getDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const index = store.index('list_name_source')
    const request = index.getAll([listName, source])

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      reject(new Error(`Failed to get list entries by source: ${request.error?.message}`))
    }
  })
}

/**
 * Get all unique list names
 */
export async function getAllLists(): Promise<string[]> {
  const db = await getDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onsuccess = () => {
      const entries = request.result as ListEntry[]
      const listNames = new Set<string>()

      entries.forEach(entry => {
        listNames.add(entry.list_name)
      })

      resolve(Array.from(listNames).sort())
    }

    request.onerror = () => {
      reject(new Error(`Failed to get all lists: ${request.error?.message}`))
    }
  })
}

/**
 * Update an existing list entry
 * Updates the updated_at timestamp
 */
export async function updateListEntry(id: number, updates: Partial<ListEntry>): Promise<void> {
  const db = await getDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const getRequest = store.get(id)

    getRequest.onsuccess = () => {
      const entry = getRequest.result as ListEntry

      if (!entry) {
        reject(new Error(`Entry with id ${id} not found`))
        return
      }

      const nextPattern = updates.pattern ?? entry.pattern
      const nextPatternType = updates.pattern_type ?? entry.pattern_type
      if (nextPatternType === 'domain' && !isStrictRegisteredDomain(nextPattern)) {
        reject(
          new Error(
            `Invalid 'domain' pattern "${nextPattern}". ` +
            `Use a registered domain like "google.com", or use pattern_type "host"/"regex" for subdomains.`
          )
        )
        return
      }

      const updatedEntry = {
        ...entry,
        ...updates,
        id, // Ensure ID doesn't change
        metadata: {
          ...entry.metadata,
          ...updates.metadata,
          updated_at: Date.now()
        }
      }

      const putRequest = store.put(updatedEntry)

      putRequest.onsuccess = () => {
        resolve()
      }

      putRequest.onerror = () => {
        reject(new Error(`Failed to update entry: ${putRequest.error?.message}`))
      }
    }

    getRequest.onerror = () => {
      reject(new Error(`Failed to get entry for update: ${getRequest.error?.message}`))
    }
  })
}

/**
 * Delete a list entry by ID
 */
export async function deleteListEntry(id: number): Promise<void> {
  const db = await getDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.delete(id)

    transaction.oncomplete = () => {
      resolve()
    }

    transaction.onerror = () => {
      reject(new Error(`Failed to delete entry (tx): ${transaction.error?.message}`))
    }

    request.onerror = () => {
      reject(new Error(`Failed to delete entry: ${request.error?.message}`))
    }
  })
}

/**
 * Delete all entries in a specific list
 * Optionally filter by source
 */
export async function deleteAllEntriesInList(
  listName: string,
  sourceFilter?: EntrySource
): Promise<void> {
  const db = await getDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    transaction.oncomplete = () => {
      resolve()
    }

    transaction.onerror = () => {
      reject(new Error(`Failed to delete list entries (tx): ${transaction.error?.message}`))
    }

    if (sourceFilter) {
      // Use compound index to filter by both list_name and source
      const index = store.index('list_name_source')
      const request = index.openCursor(IDBKeyRange.only([listName, sourceFilter]))

      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }

      request.onerror = () => {
        reject(new Error(`Failed to delete list entries: ${request.error?.message}`))
      }
    } else {
      // Delete all entries for this list regardless of source
      const index = store.index('list_name')
      const request = index.openCursor(IDBKeyRange.only(listName))

      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }

      request.onerror = () => {
        reject(new Error(`Failed to delete list entries: ${request.error?.message}`))
      }
    }
  })
}

/**
 * Reset the entire list database
 * This completely deletes the database and requires reinitialization
 * Use when you need to clear all data and schema (useful for testing or recovery)
 * 
 * Note: Make sure to close any open connections before calling this function.
 * If the database is blocked, you may need to close browser tabs using the extension.
 */
export async function resetListDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)

    request.onsuccess = () => {
      console.log('[list-utilities] Database reset complete')
      clearLastSyncedListsHash().then(resolve, resolve)
    }

    request.onerror = () => {
      reject(new Error(`Failed to reset database: ${request.error?.message}`))
    }

    request.onblocked = () => {
      console.warn('[list-utilities] Database reset blocked - close all connections and try again')
      // Don't reject here - the operation will eventually succeed when connections close
    }
  })
}

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Find a specific entry in a list by pattern string
 */
export async function findListEntry(listName: string, pattern: string): Promise<ListEntry | null> {
  const db = await getDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const index = store.index('list_name_pattern')
    const request = index.getAll([listName, pattern])

    request.onsuccess = () => {
      const results = request.result
      resolve(Array.isArray(results) && results.length > 0 ? results[0] : null)
    }

    request.onerror = () => {
      reject(new Error(`Failed to find entry: ${request.error?.message}`))
    }
  })
}

/**
 * Find a specific entry in a list by (pattern_type, pattern).
 * This is the schema-level uniqueness key.
 */
export async function findListEntryByPattern(
  listName: string,
  patternType: PatternType,
  pattern: string
): Promise<ListEntry | null> {
  const db = await getDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const index = store.index('list_name_pattern_type_pattern')
    const request = index.get([listName, patternType, pattern])

    request.onsuccess = () => {
      resolve(request.result || null)
    }

    request.onerror = () => {
      reject(new Error(`Failed to find entry: ${request.error?.message}`))
    }
  })
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Create multiple list entries in a single transaction
 * Returns array of created IDs
 */
export async function bulkCreateListEntries(entries: Omit<ListEntry, 'id'>[]): Promise<number[]> {
  const db = await getDatabase()

  // Check for duplicates within the entries array being inserted
  const uniqueKeys = new Set<string>()
  const duplicatesInArray: Array<{ index: number, key: string }> = []
  
  entries.forEach((entry, index) => {
    const key = `${entry.list_name}:${entry.pattern_type}:${entry.pattern}`
    if (uniqueKeys.has(key)) {
      duplicatesInArray.push({ index, key })
    }
    uniqueKeys.add(key)
  })

  if (duplicatesInArray.length > 0) {
    console.error('[list-utilities] Duplicate entries detected in bulk insert array:', duplicatesInArray)
    return Promise.reject(new Error(`Duplicate entries in array: ${duplicatesInArray.map(d => `[${d.index}]${d.key}`).join(', ')}`))
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const ids: number[] = []
    let completed = 0
    let skipped = 0

    entries.forEach((entry, index) => {
      const entryWithTimestamps = {
        ...entry,
        metadata: {
          ...entry.metadata,
          created_at: entry.metadata.created_at || Date.now(),
          updated_at: Date.now()
        }
      }

      const request = store.add(entryWithTimestamps)

      request.onsuccess = () => {
        ids.push(request.result as number)
        completed++

        if (completed + skipped === entries.length) {
          if (skipped > 0) {
            console.warn(`[list-utilities] Bulk insert completed with ${skipped} skipped duplicates`)
          }
          resolve(ids)
        }
      }

      request.onerror = (event) => {
        // Handle uniqueness constraint violations gracefully: skip the
        // duplicate and continue.  This prevents transaction abort when a
        // concurrent sync (or stale DB state) leaves a matching entry.
        if (request.error?.name === 'ConstraintError') {
          event.preventDefault() // Keep the transaction alive
          skipped++
          console.warn(
            `[list-utilities] Skipping duplicate entry at index ${index} ` +
            `(${entry.list_name}:${entry.pattern_type}:${entry.pattern})`
          )
          if (completed + skipped === entries.length) {
            console.warn(`[list-utilities] Bulk insert completed with ${skipped} skipped duplicates`)
            resolve(ids)
          }
        } else {
          const errorDetails = {
            list_name: entry.list_name,
            pattern_type: entry.pattern_type,
            pattern: entry.pattern,
            source: entry.source,
            index,
            error: request.error?.message
          }
          console.error('[list-utilities] Bulk insert failed at entry:', errorDetails)
          reject(new Error(`Failed to create bulk entry at index ${index} (${entry.list_name}:${entry.pattern_type}:${entry.pattern}): ${request.error?.message}`))
        }
      }
    })

    // Handle empty array case
    if (entries.length === 0) {
      resolve([])
    }
  })
}

/**
 * Replace a list's backend entries in a single transaction
 * Deletes the list's existing backend entries, deletes entries of other sources
 * that share a (pattern_type, pattern) with an incoming entry, then adds the
 * incoming entries. Readers see the list either before or after the replacement.
 */
export async function replaceBackendEntries(
  listName: string,
  entries: Omit<ListEntry, 'id'>[]
): Promise<void> {
  const db = await getDatabase()
  const now = Date.now()
  const incoming = withoutDuplicatePatterns(entries)

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    transaction.oncomplete = () => {
      resolve()
    }

    transaction.onerror = () => {
      reject(new Error(`Failed to replace backend entries (tx): ${transaction.error?.message}`))
    }

    transaction.onabort = () => {
      reject(new Error(`Replacing backend entries was aborted: ${transaction.error?.message}`))
    }

    const backendCursor = store.index('list_name_source').openCursor(IDBKeyRange.only([listName, 'backend']))

    backendCursor.onsuccess = () => {
      const cursor = backendCursor.result

      if (cursor) {
        cursor.delete()
        cursor.continue()
        return
      }

      const patternIndex = store.index('list_name_pattern_type_pattern')

      incoming.forEach((entry) => {
        const existingRequest = patternIndex.getKey([listName, entry.pattern_type, entry.pattern])

        existingRequest.onsuccess = () => {
          if (existingRequest.result !== undefined) {
            store.delete(existingRequest.result)
          }

          store.add({
            ...entry,
            metadata: {
              ...entry.metadata,
              created_at: entry.metadata.created_at || now,
              updated_at: now
            }
          })
        }
      })
    }
  })
}

function withoutDuplicatePatterns(entries: Omit<ListEntry, 'id'>[]): Omit<ListEntry, 'id'>[] {
  const seen = new Set<string>()
  const unique: Omit<ListEntry, 'id'>[] = []

  for (const entry of entries) {
    const key = `${entry.pattern_type}:${entry.pattern}`

    if (seen.has(key)) {
      console.warn(`[list-utilities] Skipping duplicate entry in replacement (${entry.list_name}:${key})`)
      continue
    }

    seen.add(key)
    unique.push(entry)
  }

  return unique
}

/**
 * Delete multiple list entries by ID in a single transaction
 * More efficient than deleting entries one at a time
 */
export async function bulkDeleteListEntries(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return Promise.resolve()
  }

  const db = await getDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    transaction.oncomplete = () => {
      resolve()
    }

    transaction.onerror = () => {
      reject(new Error(`Failed to delete entries (tx): ${transaction.error?.message}`))
    }

    ids.forEach((id) => {
      const request = store.delete(id)

      request.onerror = () => {
        reject(new Error(`Failed to delete entry ${id}: ${request.error?.message}`))
      }
    })
  })
}

/**
 * Export a list to JSON string
 */
export async function exportList(listName: string): Promise<string> {
  const entries = await getListEntries(listName)

  const exportData = {
    list_name: listName,
    exported_at: Date.now(),
    version: 1,
    entries: entries.map(entry => ({
      pattern: entry.pattern,
      pattern_type: entry.pattern_type,
      metadata: entry.metadata
    }))
  }

  return JSON.stringify(exportData, null, 2)
}

/**
 * Import a list from JSON string
 * Clears existing list before importing
 * Returns number of entries imported
 */
export async function importList(listName: string, jsonData: string): Promise<number> {
  try {
    const importData = JSON.parse(jsonData)

    if (!importData.entries || !Array.isArray(importData.entries)) {
      throw new Error('Invalid import data: missing entries array')
    }

    // Clear existing list
    await deleteAllEntriesInList(listName)

    // Import new entries
    const entries: Omit<ListEntry, 'id'>[] = importData.entries.map((entry: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      list_name: listName,
      pattern: entry.pattern,
      pattern_type: entry.pattern_type,
      metadata: entry.metadata || {}
    }))

    const ids = await bulkCreateListEntries(entries)
    return ids.length
  } catch (error) {
    if (error instanceof Error) {
      // eslint-disable-next-line preserve-caught-error -- Error cause: {} constructor arg is TS2022+ lib, not available in consumer toolchains yet
      throw new Error(`Failed to import list: ${error.message}`)
    }
    // eslint-disable-next-line preserve-caught-error -- Error cause: {} constructor arg is TS2022+ lib, not available in consumer toolchains yet
    throw new Error('Failed to import list: Unknown error')
  }
}
