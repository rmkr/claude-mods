# claude-mods

Mods for Claude Code: plugins of function hooks that add panes, bands, commands and status line entries.

## cache-timer

Claude's prompt cache keeps your conversation ready so each new message only pays for what's new. When the cache expires (after 1 hour, or 5 minutes on some setups), the next message re-sends the whole conversation at full price. cache-timer shows how long you have left, and lets you keep the cache warm or compact the conversation before it runs out.

### Reading the band

The band sits above the chat box:

```
● cache 44m ■■■■■■■■■■■■■■■■□□□□ 98% · auto warm 55m   Keep warm  Compact  –
```

| Part | Meaning |
| --- | --- |
| `●` and the time | Time left before the cache expires. Whole minutes, then seconds in the last minute. Green while there's time, yellow near the auto action, red once expired. |
| Bar | The same countdown as a bar. One segment in your text colour marks where the auto action fires. |
| `98%` | How much of the last turn's input came from the cache. |
| `auto …` | What happens automatically before expiry: `auto off`, `auto compact 55m` or `auto warm 55m`. |
| `Keep warm` | Restarts the cache timer with one tiny request. Nothing is summarized or lost. Shown only while the cache is still warm. |
| `Compact` | Summarizes the conversation now, so later messages send less. |
| `–` | Collapses the band to `● 44m +`. Click `+` to open it again. |

While Claude is working, a spinner replaces the time, a highlight sweeps across the bar, and the buttons step aside until the turn ends. The countdown starts when the first reply finishes.

### Everyday use

- **Short break, want to come back to the same context:** click **Keep warm**, or set auto to keep warm so it happens for you 5 minutes before expiry.
- **Long break, or the conversation has grown large:** click **Compact**, or set auto to compact. The next message then sends only the summary.
- **Auto off:** a reminder pops up 5 minutes before the cache expires, so you can choose then.
- **Background agent still working:** auto-compact waits for it, so its report back finds the full conversation, and you get the reminder instead. Auto keep warm still fires.
- **Leaving for the day:** do nothing. Auto keep warm stops after 3 pings with no message from you (pings while a background agent works don't count), so an idle session doesn't keep spending.
- **Band in the way:** click `–` to collapse it, or type `/cache` to hide it completely. Type `/cache` again to bring it back.

### Controls

| Click or type | What it does |
| --- | --- |
| `auto …` on the band | Cycle the auto action: off → compact → keep warm |
| `Keep warm` / `Compact` | Act now |
| `–` / `+` | Collapse or open the band |
| `/cache` | Show or hide the band (runs at once, even mid-turn) |
| `/cache help` | List the controls and current settings in the session |
| `/cache warm` | Keep the cache warm now |
| `/cache auto compact` / `keep-warm` / `off` | Set the auto action |
| `/cache auto 5m` | Run the auto action 5 minutes before expiry |
| `/cache ttl 1h` / `5m` | Set the cache lifetime |

### Settings

Settings persist across sessions. Change them with the band and `/cache` commands above, or in `/config` in a terminal session (the cache-timer rows). They're saved in `~/.claude/settings.json` under `pluginConfigs`.

| Setting | Default | Meaning |
| --- | --- | --- |
| Auto-compact | off | Compact before the cache expires, at most once per idle stretch; waits while a background agent runs |
| Auto keep warm | off | Keep the cache warm before it expires instead; wins over auto-compact if both are on |
| Minutes before expiry | 5 | When the auto action runs (5 = 55 minutes into a 1h cache) |
| Cache TTL | 1h | How long the cache lives; corrects itself after a compaction reports the real value |

### What keeps the cache warm

The countdown restarts on every request that re-reads this conversation: each step of a turn, a forked agent, Keep warm, and Claude waking up when a background task finishes. Background shell commands and ordinary subagents don't send this conversation, so they don't keep its cache warm, and the countdown keeps running while they work.

### Troubleshooting

- **No band:** type `/cache` (it may be hidden), then `/reload-plugins`.
- **Shows `—`:** nothing is cached yet; send a message.
- **Time looks wrong:** check the TTL with `/cache help` and set it with `/cache ttl 1h` or `/cache ttl 5m`.

## Install

Load a mod in every session, desktop app included, from `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/code/claude-mods/cache-timer"
  }
}
```

Separate several folders with `:`. Start a new session, or run `/reload-plugins`, to pick up changes.

Or load it for one terminal session:

```bash
claude --plugin-dir ~/code/claude-mods/cache-timer
```

## Developing

Each mod is a folder with `.claude-plugin/plugin.json`, `hooks/hooks.json` naming the hooks module, and the module itself (`hooks/register.tsx`). Check and test a mod before loading it:

```bash
claude plugin validate cache-timer
```

```bash
claude plugin test cache-timer
```

An interactive session watches `--plugin-dir` folders and reloads a mod when its files change.
