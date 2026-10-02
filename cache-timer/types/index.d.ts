export type CacheTtl = '5m' | '1h'

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': {
      lastAt: number | null
      cachedTokens: number
      hitPct: number | null
      ttl: CacheTtl
      isRunning: boolean
      hasCompacted: boolean
      pings: number
      isHidden: boolean
      now: number
      frame: number
    }
  }
}
