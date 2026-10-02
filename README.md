# claude-mods

Mods for Claude Code: plugins of function hooks that add panes, status line entries and commands.

## Mods

### cache-timer

Shows how long until the prompt cache expires, so you can compact before the next message has to re-send the whole conversation uncached.

- **Band above the prompt**: `● cache 44m ■■■■■■■■□□□□ 98% hit · auto at 55m   Compact ×`. Time left, a bar of the TTL remaining with a mark where auto-compact fires, the last turn's cache hit rate, and the auto-compact setting. Green while there's time, yellow near auto-compact, red once expired.
- **Compact**: compacts immediately (not while a turn is running).
- **Auto-compact**: off by default. When on, it compacts 5 minutes before expiry (55 minutes into a 1h cache), at most once per idle stretch.

| Control | What it does |
| --- | --- |
| `Compact` | compact now |
| `auto off` / `auto at 55m` | click to turn auto-compact on or off |
| `×` | hide the band |
| `/cache` | show or hide the band |
| `/cache help` | list these controls in the session |
| `/cache auto on` / `off` | turn auto-compact on or off |
| `/cache auto 5m` | compact 5 minutes before the cache expires |
| `/cache ttl 1h` / `5m` | set the cache lifetime; it also corrects itself after a compaction |

Settings are the plugin's `userConfig`, saved in `settings.json` under `pluginConfigs`, so they persist across sessions. The same rows are in `/config` in a terminal session. The countdown restarts on every request that re-reads the conversation: each step of a turn, a forked agent, and Claude waking up when a background task finishes. Background shell commands and ordinary subagents don't call the API with this conversation, so they don't keep its cache warm.

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
