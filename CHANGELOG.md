# Changelog

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
