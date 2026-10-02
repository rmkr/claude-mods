# claude-mods

Mods for Claude Code: plugins of function hooks that add panes, status line entries and commands.

## Mods

### cache-timer

Shows how long until the prompt cache expires, so you can compact before the next message has to re-send the whole conversation uncached.

- **Band above the prompt**: `● cache 3:42 ■■■■■■□□□□ 98% hit [Compact] [×]`. Time left, a bar of the TTL remaining, and the last turn's cache hit rate. Green while there's time, yellow near auto-compact, red once expired. `×` hides it; `/cache` brings it back.
- **Status line**: `cache 3:42`, or `cache cold` once expired.
- **Compact**: compacts immediately (not while a turn is running).
- **Auto-compact**: `/cache auto on 30` compacts on its own 30s before expiry, at most once per idle stretch. `/cache auto off` stops it.
- **TTL**: `/cache ttl 1h` or `/cache ttl 5m`. Starts at 5m and corrects itself from the engine after the first compaction.

The countdown starts when each turn ends. Settings last for the current session only.

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
