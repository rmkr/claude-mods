# claude-mods

Mods for Claude Code: plugins of function hooks that add panes, status line entries and commands.

## Mods

### cache-timer

Shows how long until the prompt cache expires, so you can compact before the next message has to re-send the whole conversation uncached.

- **Prompt cache pane** (`/cache`): a countdown to expiry and how many tokens are warm. Green while there's time, yellow near auto-compact, red once expired.
- **Status line**: `cache 3:42`, or `cache cold` once expired.
- **Compact now**: compacts immediately (not while a turn is running).
- **Auto-compact**: compacts on its own a set time before expiry (default 30s, adjust in 15s steps), at most once per idle stretch.
- **TTL 5m / 1h**: starts at 5m; corrects itself from the engine after the first compaction.

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
