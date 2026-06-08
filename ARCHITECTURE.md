# Architecture

Visual overview of how **telegram-personal-client** is structured and how data flows through it.

## 1. System context

How the tool sits between you, Telegram, and local files.

```mermaid
flowchart LR
  User["You (terminal)"]
  App["telegram-personal-client\n(Node.js + TypeScript)"]
  TG["Telegram servers\n(MTProto / port 443)"]
  Env[".env\n(API id, hash, session)"]
  Out["exports/\nmessages.json + media/"]

  User -->|"npm run auth / export"| App
  Env --> App
  App <-->|"GramJS (MTProto)"| TG
  App --> Out
```

**Key point:** This is **not** the Bot API. It logs in as your **user account** via MTProto (same protocol as the official app).

---

## 2. Layered structure

```mermaid
flowchart TB
  subgraph CLI["CLI entrypoints (npm scripts)"]
    auth["auth.ts"]
    test["test-connection.ts"]
    list["list-chats.ts"]
    export["export-chat.ts"]
    fetch["fetch-data.ts"]
  end

  subgraph Core["Shared core"]
    client["client.ts"]
  end

  subgraph External["External libraries"]
    gramjs["GramJS (telegram)"]
    dotenv["dotenv"]
    input["input (interactive prompts)"]
  end

  subgraph Storage["Local storage"]
    dotenvFile[".env"]
    manifest["exports/.../messages.json"]
    mediaDir["exports/.../media/"]
  end

  subgraph Remote["Remote"]
    telegram["Telegram MTProto API"]
  end

  auth --> client
  test --> client
  list --> client
  export --> client
  fetch --> client

  client --> gramjs
  client --> dotenv
  auth --> input

  gramjs <-->|WSS :443| telegram
  dotenv --> dotenvFile
  export --> manifest
  export --> mediaDir
```

| Layer | Role |
|-------|------|
| **CLI scripts** | Thin runners invoked by `npm run …` |
| **client.ts** | Single place for credentials, session, connection options |
| **GramJS** | MTProto client — dialogs, messages, media download |
| **Local files** | Session secrets in `.env`; export output on disk |

---

## 3. Module dependency diagram (UML-style)

```mermaid
classDiagram
  class client_ts {
    +getApiCredentials()
    +createClient(sessionString)
    +connectWithSavedSession(options)
  }

  class auth_ts {
    +main()
    interactive login
    prints TELEGRAM_SESSION
  }

  class list_chats_ts {
    +main()
    getDialogs()
  }

  class export_chat_ts {
    +main()
    resolveChat()
    iterMessages()
    downloadMedia()
    repairIncompleteMedia()
    saveManifest()
  }

  class fetch_data_ts {
    +main()
    sample read
  }

  class test_connection_ts {
    +main()
    connect / disconnect
  }

  class GramJS_TelegramClient {
    connect()
    start()
    getDialogs()
    getMessages()
    iterMessages()
    downloadMedia()
    getEntity()
  }

  class dotenv {
    loads .env
  }

  auth_ts --> client_ts : createClient()
  list_chats_ts --> client_ts : connectWithSavedSession()
  export_chat_ts --> client_ts : connectWithSavedSession()
  fetch_data_ts --> client_ts : connectWithSavedSession()
  test_connection_ts --> client_ts : createClient()
  client_ts --> GramJS_TelegramClient : builds
  client_ts --> dotenv
```

---

## 4. Authentication flow (one-time)

```mermaid
sequenceDiagram
  actor User
  participant auth as auth.ts
  participant client as client.ts
  participant GJ as GramJS
  participant TG as Telegram

  User->>auth: npm run auth
  auth->>client: createClient("")
  client->>GJ: new TelegramClient(StringSession, apiId, apiHash, useWSS)
  auth->>GJ: client.start(phone, code, password)
  GJ->>TG: MTProto auth (phone + code + 2FA)
  TG-->>GJ: authorized session
  GJ-->>auth: session.save()
  auth-->>User: print TELEGRAM_SESSION=...
  Note over User: paste into .env
  auth->>GJ: disconnect()
```

After this, all other scripts use `TELEGRAM_SESSION` from `.env` — no repeated login.

---

## 5. Export flow (with resume)

```mermaid
sequenceDiagram
  actor User
  participant exp as export-chat.ts
  participant client as client.ts
  participant GJ as GramJS
  participant TG as Telegram
  participant disk as exports/

  User->>exp: npm run export -- 123456789
  exp->>client: connectWithSavedSession(ignoreUpdateTimeouts)
  client->>GJ: connect() via WSS :443
  exp->>GJ: getEntity(chat id / title / @user)
  exp->>disk: load messages.json (if exists)

  alt Resume
    exp->>exp: set minId = last exported message id
  end

  loop For each message (iterMessages)
    alt Already complete
      exp->>exp: skip (no re-download)
    else New or incomplete media
      exp->>GJ: downloadMedia(message)
      GJ->>TG: fetch file chunks
      TG-->>GJ: media bytes
      GJ-->>disk: write media/
      exp->>disk: update messages.json (every 50 msgs)
    end
  end

  exp->>exp: repairIncompleteMedia()
  Note over exp,disk: Re-fetch missing files by message id batches

  exp->>disk: final messages.json
  exp->>GJ: disconnect()
  exp-->>User: Done summary
```

---

## 6. Export resume decision logic

```mermaid
flowchart TD
  Start["npm run export"]
  Load["Load existing messages.json"]
  Fresh{"--fresh flag?"}
  Ignore["Ignore previous manifest"]
  Merge["Merge into messagesById map"]
  Loop["iterMessages (oldest → newest)"]
  Exists{"Message already in manifest?"}
  MediaOk{"Media on disk or not needed?"}
  Skip["Skip — no API download"]
  Download["downloadMedia → media/"]
  Link["Link existing file from disk"]
  Save["Append to manifest, save every 50"]
  Repair["repairIncompleteMedia()"]
  Done["Write final messages.json"]

  Start --> Fresh
  Fresh -->|yes| Ignore --> Loop
  Fresh -->|no| Load --> Merge --> Loop
  Loop --> Exists
  Exists -->|yes| MediaOk
  Exists -->|no| Download
  MediaOk -->|yes| Skip --> Loop
  MediaOk -->|no| Download
  Download --> Link --> Save --> Loop
  Loop -->|finished| Repair --> Done
```

---

## 7. Connection configuration

```mermaid
flowchart LR
  subgraph client_ts
    WSS["useWSS: true\n(port 443)"]
    Session["StringSession\nfrom .env"]
    Creds["apiId + apiHash\nfrom .env"]
    ErrH["ignoreUpdateTimeouts\n(suppress TIMEOUT noise)"]
  end

  subgraph GramJS
    TCP["TCPFull over 443"]
    MTProto["MTProto handshake"]
  end

  Creds --> GramJS
  Session --> GramJS
  WSS --> TCP
  TCP --> MTProto
  ErrH -.->|"export only"| GramJS
```

Port **80** is avoided by default because many networks block or reset it. **443 (WSS)** is used instead.

---

## 8. On-disk data model

```mermaid
erDiagram
  MANIFEST ||--o{ MESSAGE : contains
  MESSAGE ||--o| MEDIA : optional

  MANIFEST {
    string chat
    string title
    string exportedAt
    int messageCount
    bool downloadMedia
  }

  MESSAGE {
    int id
    string date
    string senderId
    string text
    int replyToMsgId
  }

  MEDIA {
    string kind
    string file
    string mimeType
    string fileName
    int size
  }
```

**Folder layout:**

```
exports/<chat-title-slug>/
├── messages.json    ← MANIFEST + MESSAGE[] + MEDIA
└── media/
    └── {messageId}_{type}.{ext}
```

---

## 9. Script map (quick reference)

```mermaid
mindmap
  root((telegram-personal-client))
    Setup
      auth.ts
      test-connection.ts
      .env
    Discover
      list-chats.ts
    Export
      export-chat.ts
      resume
      repair media
      exports/
    Explore
      fetch-data.ts
    Core
      client.ts
      GramJS
```

---

## 10. Technology stack

| Piece | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js | GramJS target platform |
| Language | TypeScript | Typed scripts, `tsx` runner |
| Telegram access | GramJS (`telegram`) | MTProto for **personal** accounts |
| Session | `StringSession` | Portable auth string in `.env` |
| Transport | WSS / port 443 | Works when port 80 is blocked |
| Config | `dotenv` | Keep secrets out of code |
| CLI input | `input` | Phone / code / 2FA during `auth` |
