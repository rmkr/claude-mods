# claude-mods

Mods for Claude Code: plugins of function hooks that add panes, status line entries and commands.

## Mods

### cache-timer

Shows how long until the prompt cache expires, so you can compact before the next message has to re-send the whole conversation uncached.

- **Band above the prompt**: `● cache 44m ■■■■■■■■□□□□ 98% hit · auto at 55m   Compact ×`. Time left, a bar of the TTL remaining, the last turn's cache hit rate, and when auto-compact fires. Green while there's time, yellow near auto-compact, red once expired. Click the time to collapse the band into the status line below the prompt (`cache 44m`); `/cache` expands it again. Click `auto off` / `auto at 55m` to toggle auto-compact. `×` hides it; `/cache` brings it back. A mark on the bar shows where auto-compact fires. Set **Band style** to `quiet` in `/config` to drop the bar.
- **Status line**: `cache 44m`, or `cache cold` once expired, while the band is collapsed.
- **Compact**: compacts immediately (not while a turn is running).
- **Auto-compact**: off by default. Turn it on in `/config` (cache-timer rows) and it compacts 5 minutes before expiry, 55 minutes into a 1h cache, at most once per idle stretch. The minutes are configurable there too.
- **TTL**: 1h by default, set in `/config`. It also corrects itself for the session after a compaction.

Settings are the plugin's `userConfig`, saved in `settings.json` under `pluginConfigs`. `/cache` prints the current values. The countdown starts when each turn ends.

## Install

Load a mod for one session:

```bash
claude --plugin-dir ~/code/claude-mods/cache-timer
```

Or load it in every session, desktop app included, from `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/code/claude-mods/cache-timer"
  }
}
```

Separate several folders with `:`.

## Developing

Each mod is a folder with `.claude-plugin/plugin.json`, `hooks/hooks.json` naming the hooks module, and the module itself (`hooks/register.tsx`). Check a mod before loading it:

```bash
claude plugin validate cache-timer
```

An interactive session watches `--plugin-dir` folders and reloads a mod when its files change.
