# Telegram Personal Client

TypeScript tooling to access your **personal** Telegram account (not a bot), export chat history, and download media (photos, voice notes, videos, documents).

Built with [GramJS](https://gram.js.org) (MTProto). The Bot API cannot read your private chats — this uses user login instead.

## Prerequisites

- Node.js 18+
- A Telegram account
- **API ID** and **API hash** from [my.telegram.org](https://my.telegram.org)

## Quick start

```bash
cd telegram-personal-client
npm install
cp .env.example .env
```

Edit `.env` with your credentials (see below), then:

```bash
npm run auth
```

Enter your phone in international format (e.g. `+1234567890`), then the code from the Telegram app.

Copy the printed `TELEGRAM_SESSION=...` line into `.env`, then verify:

```bash
npm run test-connection
```

## Getting API credentials

1. Open [https://my.telegram.org](https://my.telegram.org)
2. Log in with your phone (code arrives in the **Telegram app**, not SMS)
3. Go to **API development tools**
4. Create an app and copy **api_id** and **api_hash** into `.env`

### If my.telegram.org shows `ERROR`

Common fixes:

- Use an **incognito/private** browser window
- **Disable ad blockers** and privacy extensions
- Align your **IP country** with your phone number’s country (VPN mismatch often causes `ERROR`)
- Try **mobile hotspot** instead of office Wi‑Fi
- Use a unique **short name** (lowercase, no spaces), platform **Desktop**, URL like `https://example.com`
- Click **Create application** multiple times — the site is flaky

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_API_ID` | Yes | Numeric app id from my.telegram.org |
| `TELEGRAM_API_HASH` | Yes | App hash from my.telegram.org |
| `TELEGRAM_SESSION` | After auth | Session string from `npm run auth` |
| `TELEGRAM_USE_WSS` | No | Default `true` — connects on port 443 (recommended) |

**Never commit `.env`** — it grants full access to your account.

## Commands

| Command | Description |
|---------|-------------|
| `npm run auth` | One-time login (phone → code → 2FA if enabled) |
| `npm run test-connection` | Verify Telegram connectivity |
| `npm run list-chats` | List dialogs (titles, ids, usernames) |
| `npm run export -- "<chat>"` | Export one chat with history + media |
| `npm run fetch` | Sample script (recent dialogs + messages) |

## Export a chat

### 1. Find the chat

```bash
npm run list-chats
```

Pick a target from the output — you can use:

- a **username** (with `@`)
- the exact **dialog title** (in quotes if it contains spaces)
- the numeric **dialog id**

### 2. Export

```bash
npm run export -- 123456789
npm run export -- "@exampleuser"
npm run export -- "Example Chat"
```

Use the id, username, or title from your own `list-chats` output.

### Options

```bash
npm run export -- 123456789 --out ./exports
npm run export -- 123456789 --limit 100
npm run export -- 123456789 --no-media
npm run export -- 123456789 --fresh
```

| Flag | Description |
|------|-------------|
| `--out ./exports` | Output folder (default: `./exports`) |
| `--limit 100` | Only export the last N messages (omit for full history) |
| `--no-media` | JSON only, skip file downloads |
| `--fresh` | Ignore previous `messages.json` and rebuild the index |

### Output layout

```
exports/example-chat/
  messages.json
  media/
    1001_voice.ogg
    1002_photo.jpg
```

Each message in `messages.json` includes id, date, sender, text, reply info, and a `media` block when applicable.

## Resume (no duplicate downloads)

Re-run the **same** export command with the **same** chat identifier:

```bash
npm run export -- 123456789
```

On resume the script will:

- Load existing `exports/<chat>/messages.json`
- Skip messages already exported with media on disk
- Skip re-downloading files already in `media/`
- Continue from the last exported message id
- Run a **repair pass** for any missing downloadable media
- Save progress periodically during the run

Typical completion output:

```text
Resuming: 500 messages already exported (last id: 99999)
Repairing 3 messages with missing media...
Done. 500 messages total.
  Export complete — nothing left to fetch.
```

Do **not** use `--fresh` unless you want to rebuild `messages.json` from scratch (existing media files on disk are still skipped).

## Connection troubleshooting

### `Not connected` / `connection closed` on port 80

The client uses **WSS (port 443)** by default. Ensure `.env` has:

```env
TELEGRAM_USE_WSS=true
```

### `TIMEOUT` during long exports

Background GramJS ping timeouts are harmless and suppressed during export. If the process stops, re-run the same `npm run export` command — it resumes.

### `failed media for message X: not implemented`

GramJS cannot download some Telegram media types (link previews, polls, locations, etc.). These appear as `kind: "other"` in `messages.json`. Photos, voice notes, and most files are supported.

## Security

- **Do not commit** `.env`, `TELEGRAM_SESSION`, or `exports/` (all are in `.gitignore`)
- Session string = full account access — treat it like a password
- Follow [Telegram API Terms](https://core.telegram.org/api/terms); avoid spam or abusive automation

## Project structure

```
src/
  auth.ts
  client.ts
  list-chats.ts
  export-chat.ts
  fetch-data.ts
  test-connection.ts
```

## License

Private tooling — use at your own risk.
