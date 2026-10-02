export type CacheTtl = '5m' | '1h'
export type AutoMode = 'off' | 'compact' | 'keep warm'

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': {
      lastAt: number | null
      cachedTokens: number
      hitPct: number | null
      ttl: CacheTtl
      isRunning: boolean
      hasCompacted: boolean
      hasWarned: boolean
      pings: number
      isCollapsed: boolean
      isHidden: boolean
      shown: number | null
      autoMode: AutoMode
    }
  }
}
