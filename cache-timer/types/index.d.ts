export type CacheTtl = '5m' | '1h'

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': {
      lastAt: number | null
      hitPct: number | null
      ttl: CacheTtl
      isAuto: boolean
      leadSec: number
      isRunning: boolean
      hasCompacted: boolean
      isHidden: boolean
      now: number
    }
  }
}
