---
name: pi-durable-telegram
description: Set up an always-on durable pi agent on a server that the user talks to in Telegram (pi-durable-telegram). Use when the user asks to run pi on a VPS or home server, to reach their agent from Telegram, or to install, log in, restart, update or debug pi-durable-telegram.
license: MIT
compatibility: Linux server with systemd and Node.js 22.19+, reachable over SSH or local
---

# Durable pi agent in Telegram

`pi-durable-telegram` is a daemon built on pi-durable. It runs on a server, keeps one durable conversation per allowed
Telegram chat in SQLite, and survives crashes and restarts: an unfinished run continues after the process comes back,
and its answer still reaches the chat. You install it on the user's server and leave it running.

Run every command on the target machine (prefix with `ssh <host>` when it is remote). Never print tokens or keys back
into the chat or logs.

## 1. Collect what you need from the user

Ask only for what you cannot find yourself:

1. **Server**: SSH host, or this machine. It must run systemd and Node.js 22.19 or newer (`node --version`).
2. **Bot token** from @BotFather. The bot must not be used by any other process: one token can be polled by one
   process only (Telegram answers 409 otherwise). Check with
   `curl -s https://api.telegram.org/bot<TOKEN>/getWebhookInfo` (no `url`, low `pending_update_count`).
3. **Allowed Telegram user ids** (numbers, comma-separated). The user gets theirs from @userinfobot.
4. **Working directory** for the agent (default `~/pi-agent`).
5. Optional: **Deepgram API key** for voice messages.
6. Model: default `anthropic` / `claude-opus-5-5` with a Claude Pro/Max subscription. Mention that subscription use in
   third-party tools may be restricted by Anthropic's terms, and that an API key is the alternative.

## 2. Install

If the server's default Node is older than 22.19, install a newer one next to it (for example `nvm install 24`)
without changing the default; other services may depend on it. Note the absolute path of that `node` binary.

```sh
npm install -g pi-durable-telegram
pi-durable-telegram --version
```

## 3. Configure

```sh
mkdir -p ~/.config/pi-durable-telegram ~/pi-agent
umask 077
cat > ~/.config/pi-durable-telegram/env <<'EOF'
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_IDS=...
PI_WORKDIR=/home/<user>/pi-agent
EOF
chmod 600 ~/.config/pi-durable-telegram/env
```

Optional variables: `PI_PROVIDER`, `PI_MODEL`, `PI_THINKING` (default `high`), `DEEPGRAM_API_KEY`, `PI_DATA_DIR`,
`PI_CONTEXT_CAP`. See the package README for the full table.

Write `<workdir>/AGENTS.md`: it is added to the agent's system prompt and re-read when it changes. Put there the
language to answer in, what lives on the server (services, project folders, where notes or a knowledge vault are),
and what the agent must not touch. Keep it short and concrete.

## 4. Log in to the model provider

Login is interactive. Start it in a detached `tmux` session so you can relay it:

```sh
tmux new-session -d -s pilogin -x 400 -y 50 \
  "pi-durable-telegram login anthropic --env-file ~/.config/pi-durable-telegram/env"
sleep 3; tmux capture-pane -p -J -t pilogin
```

Give the printed URL to the user as a link. They sign in and send you the code (`code#state`). Then:

```sh
tmux send-keys -t pilogin -l '<code#state>'; tmux send-keys -t pilogin Enter
sleep 5; tmux capture-pane -p -J -t pilogin; tmux kill-session -t pilogin
```

Success leaves `auth.json` (mode 600) in the data directory (`~/.local/state/pi-durable-telegram` by default).

## 5. Run as a systemd user service

Copy the unit shipped with the package and point `ExecStart` at absolute paths, because systemd does not load the
shell's `PATH` (nvm in particular):

```sh
mkdir -p ~/.config/systemd/user
cp "$(npm root -g)/pi-durable-telegram/deploy/pi-durable-telegram.service" ~/.config/systemd/user/
# Edit ExecStart to: <abs node> <npm root -g>/pi-durable-telegram/dist/cli/main.js run --env-file %h/.config/pi-durable-telegram/env
# and set WorkingDirectory to the agent's workdir.
systemctl --user daemon-reload
systemctl --user enable --now pi-durable-telegram
loginctl enable-linger "$USER"
```

## 6. Verify for real

1. `systemctl --user is-active pi-durable-telegram` prints `active`.
2. `journalctl --user -u pi-durable-telegram -n 20 -o cat` shows `polling_started bot=<name>` and
   `started model=...`.
3. Ask the user to send the bot a message. The journal shows `message_admitted` then `delivered`, and the user sees
   the answer. Only then say it works.
4. Optionally ask for a voice note and a photo, and `/status`.

## Operate

- Logs: `journalctl --user -u pi-durable-telegram -f`.
- Restart: `systemctl --user restart pi-durable-telegram` (unfinished runs resume after start).
- Update: `npm install -g pi-durable-telegram@latest`, then restart.
- Telegram commands: `/new`, `/stop`, `/compact`, `/status`, `/help`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Exit code 2 at start | Bad config or rejected bot token; the journal names each problem |
| Exit code 3 | Another process owns the data directory; stop it |
| Exit code 4 or "run login" in chat | Not logged in or the credentials expired: repeat step 4 |
| 409 Conflict in the journal | Another process polls the same bot token; stop it or use another bot |
| No answer, nothing in the journal | The sender is not in `TELEGRAM_ALLOWED_USER_IDS` (strangers are ignored silently) |
| Voice says not configured | Set `DEEPGRAM_API_KEY` and restart |

## Security

The agent has a full shell as the service user: whoever is on the allow-list can run any command that user can. Say
this to the user before installing, and suggest a dedicated system user when the server holds other important data.
