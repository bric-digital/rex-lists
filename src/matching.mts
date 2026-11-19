import psl from 'psl'

import { getListEntries } from './storage.mjs'
import type { ListEntry, PatternType } from './storage.mjs'

// ============================================================================
// Debug Configuration
// ============================================================================

let debugEnabled = false

/**
 * Enable or disable debug logging for list matching operations.
 * When enabled, matchDomainAgainstList and matchesPattern will log details to the console.
 */
export function setDebug(enabled: boolean): void {
  debugEnabled = enabled
}

// ============================================================================
// Pattern Validation Helpers
// ============================================================================

function normalizeLeadingWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

/**
 * For pattern_type = 'domain', we ONLY accept a registered domain (eTLD+1), e.g. "google.com".
 *
 * If someone provides a subdomain like "health.google.com", PSL will parse the registered domain
 * as "google.com" — but treating "health.google.com" as a domain-pattern would be misleading
 * and dangerously broad (it would match all of google.com).
 */
export function isStrictRegisteredDomain(pattern: string): boolean {
  const candidate = normalizeLeadingWww(pattern.trim())
  // Disallow URLs or host/path strings in 'domain' patterns.
  if (candidate.includes('://') || candidate.includes('/')) return false

  const parsed = psl.parse(candidate)
  if (parsed.error !== undefined) return false
  const domain = (parsed as psl.ParsedDomain).domain
  if (!domain) return false

  // Must equal the registrable domain exactly (no subdomain prefixes).
  return candidate === domain
}

function isIpAddress(hostname: string): boolean {
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
  const isIpv6 = hostname.startsWith('[')

  return isIpv4 || isIpv6
}

export function registeredDomainOf(url: string): string {
  let hostname: string

  try {
    hostname = new URL(url).hostname
  } catch {
    return ''
  }

  if (isIpAddress(hostname)) {
    return ''
  }

  const parsed = psl.parse(hostname)

  if (parsed.error !== undefined) {
    return ''
  }

  const domain = (parsed as psl.ParsedDomain).domain

  if (domain === null || domain === undefined) {
    return ''
  }

  return domain
}

/**
 * Match a URL against all entries in a list
 * Returns the first matching entry, or null if no match
 */
export async function matchDomainAgainstList(url: string, listName: string): Promise<ListEntry | null> {
  const entries = await getListEntries(listName)

  if (debugEnabled) {
    console.log(`[rex-lists] matchDomainAgainstList`)
    console.log(entries)
  }

  const sorted = [...entries].sort(
    (a, b) => (PATTERN_TYPE_PRIORITY[a.pattern_type] ?? 99) - (PATTERN_TYPE_PRIORITY[b.pattern_type] ?? 99)
  )

  for (const entry of sorted) {
    if (matchesPattern(url, entry.pattern, entry.pattern_type)) {
      return entry
    }
  }

  return null
}

// ============================================================================
// Pattern Matching
// ============================================================================

const PATTERN_TYPE_PRIORITY: Record<PatternType, number> = {
  exact_url: 0,
  regex: 1,
  host_path_prefix: 2,
  subdomain_wildcard: 3,
  host: 3,
  domain: 4,
}

/**
 * Check if a URL matches a pattern based on pattern type
 * Uses psl library for proper domain parsing (handles complex TLDs)
 */
export function matchesPattern(url: string, pattern: string, patternType: PatternType): boolean {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname

    if (debugEnabled) {
      console.log(`[rex-lists] matchesPattern("${url}", "${pattern}", "${patternType}")`)
    }

    switch (patternType) {
      case 'domain': {
        // Strict registered-domain match (eTLD+1).
        // If the pattern isn't itself a registered domain, treat it as invalid and do NOT match.
        if (!isStrictRegisteredDomain(pattern)) {
          console.warn(
            `[list-utilities] Invalid 'domain' pattern "${pattern}". ` +
            `Use a registered domain like "google.com", or use pattern_type "host"/"regex" for subdomains.`
          )
          return false
        }

        const urlParsed = psl.parse(hostname)
        if (urlParsed.error !== undefined) return false
        const urlDomain = (urlParsed as psl.ParsedDomain).domain
        if (!urlDomain) return false

        return urlDomain === normalizeLeadingWww(pattern.trim())
      }

      case 'subdomain_wildcard':
        // Server-side alias for 'host'. The server stores this pattern type as 'subdomain_wildcard'
        // (a legacy name), but behavior is identical to 'host': exact hostname match, www-normalized.
        // Falls through intentionally.
      case 'host': {
        // Match exact hostname (including subdomain).
        // Normalize an optional leading "www." to reduce surprises.
        const urlHostNormalized = normalizeLeadingWww(hostname)

        let patternHost = pattern
        // Support patterns provided as full URLs or host/path strings; keep only the host portion.
        if (pattern.includes('://')) {
          patternHost = new URL(pattern).hostname
        } else if (pattern.includes('/')) {
          patternHost = pattern.split('/')[0] ?? ''
        }

        const patternHostNormalized = normalizeLeadingWww(patternHost)
        if (!patternHostNormalized) return false
        return urlHostNormalized === patternHostNormalized
      }

      case 'exact_url': {
        return url === pattern
      }

      case 'host_path_prefix': {
        // Match an anchored host + path prefix, e.g.:
        // - pattern: "google.com/maps" matches "https://www.google.com/maps/..."
        // - pattern: "https://google.com/maps" also supported
        //
        // We normalize an optional leading "www." on both sides for convenience.
        const urlHostNormalized = normalizeLeadingWww(hostname)
        const urlPath = urlObj.pathname

        let patternHost = ''
        let patternPath = ''

        // If pattern is a full URL, use URL parsing. Otherwise treat as "host/path".
        if (pattern.includes('://')) {
          const patternUrl = new URL(pattern)
          patternHost = patternUrl.hostname
          patternPath = patternUrl.pathname
        } else {
          const firstSlashIdx = pattern.indexOf('/')
          if (firstSlashIdx === -1) {
            // No path provided; this pattern type is meant to be host+path.
            return false
          }

          patternHost = pattern.slice(0, firstSlashIdx)
          patternPath = pattern.slice(firstSlashIdx)
        }

        const patternHostNormalized = normalizeLeadingWww(patternHost)
        if (!patternHostNormalized || urlHostNormalized !== patternHostNormalized) {
          return false
        }

        // Ensure patternPath starts with '/' so it aligns with URL.pathname.
        if (!patternPath.startsWith('/')) {
          patternPath = '/' + patternPath
        }

        if (urlPath.startsWith(patternPath)) {
          return true
        }

        // Also allow matching the same path without trailing slash
        // e.g. pattern "/maps/" should match pathname "/maps"
        if (patternPath.endsWith('/')) {
          const withoutTrailingSlash = patternPath.slice(0, -1)
          return urlPath === withoutTrailingSlash
        }

        return false
      }

      case 'regex': {
        try {
          return new RegExp(pattern).test(url)
        } catch (regexError) {
          console.error('[list-utilities] Invalid regex pattern:', pattern, regexError)
          return false
        }
      }

      default:
        console.warn('[list-utilities] Unknown pattern type:', patternType)
        return false
    }
  } catch (error) {
    console.error('[list-utilities] Error matching pattern:', error)
    return false
  }
}
