/**
 * Small in-memory cache for provider fetches.
 *
 * Every open dashboard polls every 30s, and the admin overview fetches every
 * client again on top of that — enough to trip platform rate limits (HeyReach
 * answers 429 on short bursts). This cache:
 *
 *  - serves a fresh entry for `ttlMs` without calling the platform;
 *  - shares one in-flight fetch between concurrent callers (single-flight);
 *  - on failure, falls back to the last good value for up to `staleMs`, so a
 *    transient error never blanks a dashboard that had data.
 *
 * It lives in module scope, so it is per server instance — on Vercel a warm
 * function reuses it across requests, which is where the bursts come from.
 */

interface Entry<T> {
  value?: T
  storedAt: number
  inflight?: Promise<T>
}

const entries = new Map<string, Entry<unknown>>()

export async function cached<T>(
  key: string,
  { ttlMs, staleMs }: { ttlMs: number; staleMs: number },
  fetcher: () => Promise<T>,
): Promise<T> {
  const entry = (entries.get(key) as Entry<T> | undefined) ?? { storedAt: 0 }
  entries.set(key, entry)

  const age = Date.now() - entry.storedAt
  if (entry.value !== undefined && age < ttlMs) return entry.value
  if (entry.inflight) return entry.inflight

  entry.inflight = fetcher()
    .then(value => {
      entry.value = value
      entry.storedAt = Date.now()
      return value
    })
    .catch(err => {
      const staleAge = Date.now() - entry.storedAt
      if (entry.value !== undefined && staleAge < staleMs) return entry.value
      throw err
    })
    .finally(() => {
      entry.inflight = undefined
    })

  return entry.inflight
}
