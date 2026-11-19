import { replaceBackendEntries } from './storage.mjs'
import type { ListEntry, PatternType, SyncResult } from './storage.mjs'
import { isStrictRegisteredDomain } from './matching.mjs'

// ============================================================================
// List-sync hash helpers
// ============================================================================

const LISTS_HASH_STORAGE_KEY = 'rexListsLastSyncedHash'
const SYNC_IN_PROGRESS_STORAGE_KEY = 'rexListsSyncInProgress'
const SYNC_ATTEMPT_FINISHED_STORAGE_KEY = 'rexListsSyncAttemptFinished'

async function hashListsConfig(listsConfig: Record<string, unknown>): Promise<string> {
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(listsConfig).sort()) {
    sorted[key] = listsConfig[key]
  }
  const encoded = new TextEncoder().encode(JSON.stringify(sorted))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function getLastSyncedListsHash(): Promise<string | undefined> {
  try {
    const result = await chrome.storage.local.get(LISTS_HASH_STORAGE_KEY)
    const value = result[LISTS_HASH_STORAGE_KEY]
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

async function setLastSyncedListsHash(hash: string): Promise<void> {
  await chrome.storage.local.set({ [LISTS_HASH_STORAGE_KEY]: hash })
}

export async function listsLoaded(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get([SYNC_IN_PROGRESS_STORAGE_KEY, SYNC_ATTEMPT_FINISHED_STORAGE_KEY])

    if (result[SYNC_IN_PROGRESS_STORAGE_KEY] === true) {
      return false
    }

    return result[SYNC_ATTEMPT_FINISHED_STORAGE_KEY] === true
  } catch {
    return false
  }
}

export async function clearLastSyncedListsHash(): Promise<void> {
  await chrome.storage.local.remove(LISTS_HASH_STORAGE_KEY)
}

// ============================================================================
// List-sync progress
// ============================================================================

let syncsUnderway = 0

export function beginListSync(): Promise<void> {
  syncsUnderway += 1

  return chrome.storage.local.set({ [SYNC_IN_PROGRESS_STORAGE_KEY]: true })
}

export async function endListSync(attemptFinished: boolean): Promise<void> {
  syncsUnderway -= 1

  if (attemptFinished === true) {
    await chrome.storage.local.set({ [SYNC_ATTEMPT_FINISHED_STORAGE_KEY]: true })
  }

  if (syncsUnderway === 0) {
    await chrome.storage.local.remove(SYNC_IN_PROGRESS_STORAGE_KEY)
  }
}

export async function clearListSyncProgress(): Promise<void> {
  await chrome.storage.local.remove([SYNC_IN_PROGRESS_STORAGE_KEY, SYNC_ATTEMPT_FINISHED_STORAGE_KEY])
}

export async function clearStaleListSync(): Promise<void> {
  if (syncsUnderway === 0) {
    await chrome.storage.local.remove(SYNC_IN_PROGRESS_STORAGE_KEY)
  }
}

// ============================================================================
// Configuration Sync (Backend-First)
// ============================================================================

/**
 * Sync lists from backend configuration URL
 * Primary workflow for backend-first architecture
 *
 * @param configUrl - URL to fetch configuration from (AWS Lambda endpoint)
 * @returns SyncResult with success status and updated list names
 */
export async function syncListsFromConfig(configUrl: string): Promise<SyncResult> {
  const errors: string[] = []
  const listsUpdated: string[] = []

  try {
    console.log('[list-utilities] Fetching configuration from:', configUrl)

    // 1. Fetch configuration from backend
    const response = await fetch(configUrl)

    if (!response.ok) {
      throw new Error(`Failed to fetch configuration: ${response.status} ${response.statusText}`)
    }

    const config = await response.json()

    // 2. Parse lists section
    if (config.lists && typeof config.lists === 'object') {
      console.log('[list-utilities] Found lists in configuration:', Object.keys(config.lists))
      await parseAndSyncLists(config.lists)
      listsUpdated.push(...Object.keys(config.lists))
    } else {
      console.warn('[list-utilities] No lists section found in configuration')
    }

    return {
      success: true,
      listsUpdated
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[list-utilities] Sync failed:', errorMessage)
    errors.push(errorMessage)

    return {
      success: false,
      listsUpdated,
      errors
    }
  }
}

/**
 * Parse lists configuration and sync each list
 *
 * @param listsConfig - Object with list names as keys and entry arrays as values
 */
export async function parseAndSyncLists(listsConfig: Record<string, any[]>, options?: { force?: boolean }): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    await beginListSync()
    await syncListsUnlessUnchanged(listsConfig, options)
  } finally {
    await endListSync(true)
  }
}

async function syncListsUnlessUnchanged(listsConfig: Record<string, any[]>, options?: { force?: boolean }): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!options?.force) {
    const newHash = await hashListsConfig(listsConfig as Record<string, unknown>)
    const storedHash = await getLastSyncedListsHash()
    if (storedHash !== undefined && storedHash === newHash) {
      console.log('[list-utilities] Lists config unchanged, skipping sync')
      return
    }
  }

  const listNames = Object.keys(listsConfig)
  console.log(`[list-utilities] Syncing ${listNames.length} lists`)

  let anyError = false
  const newHash = await hashListsConfig(listsConfig as Record<string, unknown>)

  for (const listName of listNames) {
    const entries = listsConfig[listName]

    if (!Array.isArray(entries)) {
      console.warn(`[list-utilities] Invalid entries for list ${listName}, skipping`)
      continue
    }

    try {
      await mergeBackendList(listName, entries)
      console.log(`[list-utilities] Synced list: ${listName} (${entries.length} entries)`)
    } catch (error) {
      anyError = true
      console.error(`[list-utilities] Failed to sync list ${listName}:`, error)
    }
  }

  if (!anyError) {
    await setLastSyncedListsHash(newHash)
  }
}

/**
 * Merge backend entries for a specific list
 * - Deletes all existing 'backend' entries for this list
 * - Inserts new backend entries from configuration
 * - Preserves 'user' and 'generated' entries
 *
 * @param listName - Name of the list to merge
 * @param entries - Array of entry objects from backend configuration
 */
export async function mergeBackendList(listName: string, entries: any[]): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  console.log(`[list-utilities] Merging backend list: ${listName}`)

  // 1. Prepare new backend entries (skip invalid ones, but log loudly)
  const newEntries: Omit<ListEntry, 'id'>[] = []

  for (const entry of entries) {
    const pattern = entry?.pattern ?? entry?.domain
    const patternType = entry?.pattern_type as PatternType | undefined

    if (typeof pattern !== 'string' || pattern.length === 0 || !patternType) {
      console.warn(`[list-utilities] Skipping invalid backend list entry (missing pattern/pattern_type) for ${listName}:`, entry)
      continue
    }

    if (patternType === 'domain' && !isStrictRegisteredDomain(pattern)) {
      console.error(
        `[list-utilities] Invalid backend 'domain' pattern "${pattern}" in list "${listName}". ` +
        `This would be misleading/broad. Use a registered domain like "google.com", or pattern_type "host"/"regex" for subdomains. Skipping entry.`
      )
      continue
    }

    newEntries.push({
      list_name: listName,
      pattern,
      pattern_type: patternType,
      source: 'backend' as const,
      metadata: {
        ...(entry?.metadata ?? {}),
        sync_timestamp: Date.now()
      }
    })
  }

  // 2. Replace the list's backend entries in one transaction
  try {
    await replaceBackendEntries(listName, newEntries)
    console.log(`[list-utilities] Replaced backend entries for ${listName} (${newEntries.length} entries)`)
  } catch (error) {
    console.error(`[list-utilities] Failed to replace backend entries for ${listName}:`, error)
    throw error
  }

  // 3. User-added and generated entries with other patterns are preserved
}
