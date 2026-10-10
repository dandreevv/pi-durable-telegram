# pi-durable-telegram

A Telegram channel for [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable)
(`@earendil-works/pi-durable`), the experimental durable agent harness from the pi project. It turns a pi-durable
agent into a personal coding agent you talk to in a private Telegram chat, and it keeps working through crashes and
restarts: an unfinished run continues after the process comes back, and its answer still reaches the chat.

It is a library (`createTelegramChannel`) and a ready-to-run daemon (`pi-durable-telegram run`).

> **Experimental.** pi-durable is experimental and changes without notice. This package pins exact versions
> (`@earendil-works/pi-durable`, `pi-ai` and `chord` 1.1.0).

## What it does

- **Durable conversations.** One pi-durable conversation per allowed chat, stored in SQLite. After a crash or a
  restart, unfinished runs resume and their answers are delivered once. Telegram delivery state is durable too, and
  redelivered Telegram updates are never submitted twice.
- **Streaming.** The answer streams into one message that is edited about once per second, with a typing indicator
  and short tool hints (`⚙ bash: npm test`). Long answers are split at 4096 characters. Model Markdown is converted to
  Telegram HTML, with a plain-text fallback if Telegram rejects it.
- **Queueing.** Messages sent while the agent works are queued and answered in order. Nothing is dropped.
- **Commands.** `/new` (fresh context, old history kept), `/stop` (stop the current run, queued messages continue),
  `/compact [instructions]`, `/status` (model, thinking, context use, spend, queue), `/help`.
- **Files.** Photos and documents (up to 20 MB, the bot API limit) are saved to `<workdir>/inbox/YYYY-MM-DD/`; the
  agent is told the path and can look at images with its `read` tool. The agent can send files back with the
  `telegram_send_file` tool (up to 50 MB).
- **Voice.** Voice messages, audio and video notes are transcribed with [Deepgram](https://deepgram.com) (`nova-3`,
  automatic language detection) when `DEEPGRAM_API_KEY` is set.
- **Tools.** `read` (text and images), `write`, `edit` and `bash`, working in `PI_WORKDIR` with the service user's
  full access.

## Requirements

- Node.js 22.19 or newer (`node:sqlite` is used for storage).
- A Telegram bot token from [@BotFather](https://t.me/BotFather) and your numeric Telegram user id (for example from
  [@userinfobot](https://t.me/userinfobot)).
- A model provider account. The default is Anthropic `claude-opus-5-5` with a Claude Pro/Max subscription (OAuth).

## Install

```sh
npm install -g pi-durable-telegram
```

## Log in

On the server, over SSH:

```sh
pi-durable-telegram login anthropic --env-file ~/.config/pi-durable-telegram/env
```

It prints a URL. Open it in any browser, sign in, and paste the code (or the whole redirect URL) back into the
terminal. Credentials are stored in `<PI_DATA_DIR>/auth.json` with mode 600 and refreshed automatically. Login uses
pi-ai's own OAuth flow unchanged, and it is safe to run while the daemon is running.

Other providers: `login <provider>` uses the provider's OAuth flow when it has one, otherwise it asks for an API key.
Only Anthropic is tested; other providers are best effort. Provider API keys in the environment (for example
`ANTHROPIC_API_KEY`) also work when nothing is stored.

> **Note on subscriptions.** Using a Claude subscription through OAuth in third-party tools may be restricted by
> Anthropic's terms. Check them; using it this way is your responsibility.

## Configure

Configuration comes from the environment, optionally loaded from a file with `--env-file <path>` (real environment
variables win over the file). Invalid values stop the daemon at start with one line per problem.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | | Bot token from @BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | yes | | Comma-separated Telegram user ids allowed to use the bot |
| `PI_PROVIDER` | no | `anthropic` | pi-ai provider id |
| `PI_MODEL` | no | `claude-opus-5-5` | Model id of the provider |
| `PI_THINKING` | no | `high` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`; checked against the model |
| `PI_WORKDIR` | no | current directory | The agent's working directory |
| `PI_DATA_DIR` | no | `$XDG_STATE_HOME/pi-durable-telegram` or `~/.local/state/pi-durable-telegram` | SQLite storage, credentials, lock |
| `PI_INSTRUCTIONS` | no | `<PI_WORKDIR>/AGENTS.md` | Project instructions added to the system prompt; re-read when the file changes |
| `PI_CONTEXT_CAP` | no | model window | Compact the context once it grows past this many tokens |
| `DEEPGRAM_API_KEY` | no | | Enables voice transcription |
| `TELEGRAM_API_ROOT` | no | `https://api.telegram.org` | Bot API server (for a local Bot API server) |
| `PI_LOG_LEVEL` | no | `info` | `debug`, `info`, `warn` or `error` |

Example `~/.config/pi-durable-telegram/env`:

```sh
TELEGRAM_BOT_TOKEN=123456789:AA...
TELEGRAM_ALLOWED_USER_IDS=111111111
PI_WORKDIR=/home/me/projects
DEEPGRAM_API_KEY=...
```

## Run

```sh
pi-durable-telegram run --env-file ~/.config/pi-durable-telegram/env
```

Exit codes: 0 clean shutdown, 1 fatal error (restart it), 2 configuration error or rejected bot token, 3 the data
directory is used by another process, 4 not logged in.

### As a systemd user service

```sh
mkdir -p ~/.config/systemd/user
cp "$(npm root -g)/pi-durable-telegram/deploy/pi-durable-telegram.service" ~/.config/systemd/user/
chmod 600 ~/.config/pi-durable-telegram/env
systemctl --user daemon-reload
systemctl --user enable --now pi-durable-telegram
loginctl enable-linger "$USER"   # keep it running after you log out
journalctl --user -u pi-durable-telegram -f
```

The unit restarts the service on failure and limits memory to 1 GB. On SIGTERM the daemon stops polling, lets
in-flight work stop, closes the storage and releases its lock; unfinished runs continue after the next start.

## Security

**The `bash` tool is a full shell under the service user.** Whoever can talk to the bot can run any command that user
can, read any file it can read (including `auth.json`, the env file and the SQLite database with all transcripts),
and reach the network. The allow-list of Telegram user ids is the only boundary.

- Only private chats with allow-listed user ids are served. Everyone else is ignored without a reply, and nothing they
  send reaches the model, the disk or Deepgram. Groups are not supported.
- Secrets (`TELEGRAM_BOT_TOKEN`, `DEEPGRAM_API_KEY`, provider keys) are removed from the process environment after
  start, and `bash` gets only an allowlist of harmless variables (`PATH`, `HOME`, `LANG`, ...).
- Logs never contain message text, file URLs, tokens or credentials.
- The data directory is created with mode 700, `auth.json` with mode 600.
- If that matters for you, run the service under a dedicated user that owns only the project directory.

## Use as a library

pi-durable needs every task definition installed before `Harness.open`, and `resume()` only after the channel is wired,
so the channel has two steps: install `channel.extension`, open the harness, then `channel.start()`.

```ts
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
  buildSafeEnv,
  createFileCredentialStore,
  createPromptExtension,
  createTelegramChannel,
  createWorkspaceTools,
} from "pi-durable-telegram";

const workdir = "/home/me/projects";
const models = createModels({ credentials: createFileCredentialStore("/home/me/.local/state/bot/auth.json") });
models.setProvider(anthropicProvider());

const channel = createTelegramChannel({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  allowedUserIds: [111111111],
  workdir,
  model: { provider: "anthropic", modelId: "claude-opus-5-5" },
  thinkingLevel: "high",
  models,
});

const registry = createRegistry();
registry.install(createWorkspaceTools({ env: buildSafeEnv(process.env) }));
registry.install(createPromptExtension({ instructionsPath: `${workdir}/AGENTS.md` }));
registry.install(channel.extension);

const harness = await Harness.open(
  await openNodeSqliteStorage("/home/me/.local/state/bot/durable.sqlite"),
  { models, registry, env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? workdir }) },
  BACKGROUND_CONTEXT,
);
await channel.start(harness, BACKGROUND_CONTEXT); // resumes unfinished work, then starts polling

process.once("SIGTERM", async () => {
  await channel.stop();
  await harness.close(BACKGROUND_CONTEXT);
});
```

Do not call `submit`, `wait`, `compact` or `abort` on the harness before `channel.start()`: they start the scheduler,
and resumed runs could then begin before the channel is listening. Keep one process per storage file; the CLI uses a
lock file for that (`acquireDataDirLock`). Updates from another source (for example a webhook) can be passed to
`channel.handleUpdate(update)` after `start(harness, context, { polling: false })`.

Other exports: `openAgent` (the CLI's setup), `parseConfig`, `createDeepgramStt`, `createGrammyPort`,
`markdownToTelegramHtml`, `splitForTelegram`.

## Development

```sh
npm install
npm run typecheck
npm run lint        # Biome lint and format check
npm test            # node --test on the TypeScript sources: property, example, integration and end-to-end tests
npm run build
```

Tests never contact Telegram, model providers or Deepgram: they use pi-ai's faux provider, an in-memory Telegram
fake and a fake Bot API HTTP server.

## License

MIT
