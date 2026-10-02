# claude-mods

Mods for Claude Code: plugins of function hooks that add panes, status line entries and commands.

## Mods

### cache-timer

Shows how long until the prompt cache expires, so you can compact before the next message has to re-send the whole conversation uncached.

- **Band above the prompt**: `● cache 44m ■■■■■■■■□□□□ 98% · auto warm 55m   Keep warm  Compact  –`. Time left, a bar of the TTL remaining with a mark where the auto action fires, and the last turn's cache hit rate. Green while there's time, yellow near the auto action, red once expired. While Claude works, a spinner replaces the time and a highlight sweeps across the bar.
- **Keep warm**: one tiny request over the conversation, which the API serves from the cache, restarting its timer. Nothing is summarized or lost. Shown only while the cache is still warm and Claude isn't working.
- **Compact**: summarizes the conversation now, so later messages send less. Hidden while Claude is working.
- **Auto**: off by default. `compact` or `keep warm` runs 5 minutes before expiry (55 minutes into a 1h cache). Auto keep warm stops after 3 pings with no message from you.

| Control | What it does |
| --- | --- |
| `Keep warm` | restart the cache timer now |
| `Compact` | compact now |
| `auto off` / `auto compact 55m` / `auto warm 55m` | click to cycle the auto action |
| `–` | collapse the band to `● 44m +`; click `+` to open it again |
| `/cache` | show or hide the band (runs at once, even mid-turn) |
| `/cache help` | list these controls in the session |
| `/cache warm` | keep the cache warm now |
| `/cache auto compact` / `keep-warm` / `off` | set the auto action |
| `/cache auto 5m` | act 5 minutes before the cache expires |
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
