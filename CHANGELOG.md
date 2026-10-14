# Changelog

## 0.1.4 (2026-10-14)

- Plugins, off by default: `PI_PLUGINS` lists built-in plugins, local folders or npm packages installed in
  `<PI_DATA_DIR>/plugins`. A plugin that fails to load, returns an invalid extension or reuses a core name or section
  is skipped: the daemon starts, the log says why, each allowed user gets one line in the chat and `/status` lists
  loaded and failed plugins. A tool call left unfinished by a removed or broken plugin comes back to the model as an
  error and never blocks startup.
- `search`: the `web_search` tool over Tavily, Exa, Brave or Parallel. Results are marked as untrusted web data.
- `mcp`: tools of the MCP servers in `.mcp.json` (stdio and HTTP), named `mcp__<server>__<tool>`. A server that fails
  to start or does not answer in `PI_MCP_TIMEOUT` seconds is reported while the others load; MCP servers get no
  secrets unless their config names them.
- `skills`: one prompt section lists the skills in `<PI_WORKDIR>/skills`, pi's skills folder and `PI_SKILLS_DIRS`;
  the agent reads a skill's `SKILL.md` when a task matches.

## 0.1.3 (2026-10-14)

- Published on npm: `npm install -g pi-durable-telegram`, and `pi install npm:pi-durable-telegram` for the setup skill.
- Answers are Telegram rich messages: tables, task lists, headings and `<details>` folds render natively. Long
  answers are split within Telegram's limits; a refused rich message falls back to HTML. `TELEGRAM_RICH=never` keeps
  the old HTML messages.
- Buttons: the model can end a question with buttons; a tap is your next message, and the pressed button is marked.
- Answers stream as native Telegram drafts with a stop button that works like `/stop`; where drafts are refused the
  edited preview message is used as before.
- pi-durable, pi-ai and chord 1.2.0.

## 0.1.2 (2026-10-11)

- Nothing an allowed user sends is refused any more. Videos, animations and stickers are saved and handed to the
  agent like photos and documents. A file over 20 MB or a failed download is reported to the agent with its name,
  size and the reason. A location, contact, poll or any other message without text or a file arrives as its own
  fields. A voice note without a transcript (no Deepgram key, or the speech service failed) is saved as an audio
  file with the reason, where the bot used to answer "not supported" or "not configured" itself.

## 0.1.1 (2026-10-11)

- One-command installer: `curl -fsSL https://raw.githubusercontent.com/smixs/pi-durable-telegram/main/install.sh | bash`
  installs the official pi, opens it for `/login`, connects the bot, finds your Telegram id from your first message,
  takes the model pi runs, installs the daemon and starts the service. Run it again to update.
- The installer and the setup skill write the provider and model into the env file: a fresh pi saves no default the
  daemon could read, and the service used to stop with "not logged in" for another provider.
- The systemd unit no longer restarts in a loop on exit codes 2, 3 and 4 (bad config, data directory in use, not
  logged in).
- README rewritten in plain language; technical reference moved to `docs/` (install, configuration, how it works,
  security, library).

## 0.1.0 (2026-10-11)

First release.

- Telegram channel for `@earendil-works/pi-durable` 1.1.0: library (`createTelegramChannel`, two-step lifecycle) and
  the `pi-durable-telegram` CLI (`run`, `login <provider>`).
- One durable conversation per allowed private chat in SQLite; unfinished runs resume after a crash and their answers
  are still delivered. Delivery progress is durable, redelivered updates are dropped, a data-directory lock keeps a
  single owner.
- Streaming by editing one message (about one edit per second, 429-aware), Markdown to Telegram HTML with a plain-text
  fallback, splitting at 4096 characters.
- Messages during a run are queued and answered in order; `/new`, `/stop`, `/compact`, `/status`, `/help`.
- Forwarded messages reach the model marked as third-party content; a forwarded command is not run.
- Photos and documents saved to `<workdir>/inbox/`, images viewable by the model through `read`; `telegram_send_file`
  tool; voice, audio and video notes transcribed with Deepgram (optional).
- Workspace tools: `read` (with images), `write`, `edit`, `bash` without the service's secrets in its environment.
- `login <provider>` over SSH with pi-ai's OAuth flow, for machines without pi; credentials mode 600.
- Pi package: `pi install git:github.com/smixs/pi-durable-telegram` adds the `pi-durable-telegram` skill. Run it in pi on the server: it
  asks for a bot token, finds your Telegram id, installs and checks the systemd service.
- Shares pi's login and defaults: credentials come from pi's `auth.json` under pi's own lock (`PI_AUTH_FILE`
  overrides), and unset `PI_PROVIDER`, `PI_MODEL`, `PI_THINKING` follow pi's settings. A `<data dir>/auth.json`
  from an earlier build keeps working.
