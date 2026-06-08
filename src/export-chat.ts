/**
 * Export one chat: full message history + photos, voice notes, videos, files.
 * Automatically resumes from exports/<chat>/messages.json if present.
 *
 * Usage:
 *   npm run list-chats
 *   npm run export -- 123456789
 *   npm run export -- "@exampleuser"
 *   npm run export -- "Example Chat"
 *   npm run export -- 123456789 --limit 100 --out ./exports
 *   npm run export -- 123456789 --no-media
 *   npm run export -- 123456789 --fresh
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Api } from "telegram";
import { connectWithSavedSession } from "./client.js";

type MediaInfo = {
  kind: "photo" | "voice" | "video" | "audio" | "document" | "sticker" | "other";
  file: string | null;
  mimeType: string | null;
  fileName: string | null;
  size: number | null;
};

type ExportedMessage = {
  id: number;
  date: string;
  senderId: string | null;
  text: string;
  replyToMsgId: number | null;
  media: MediaInfo | null;
};

type Manifest = {
  chat: string;
  title: string;
  exportedAt: string;
  messageCount: number;
  downloadMedia: boolean;
  messages: ExportedMessage[];
};

type ExportArgs = {
  chat: string;
  outDir: string;
  limit?: number;
  downloadMedia: boolean;
  fresh: boolean;
};

const SAVE_EVERY = 50;

function parseArgs(argv: string[]): ExportArgs {
  const positional: string[] = [];
  let outDir = "./exports";
  let limit: number | undefined;
  let downloadMedia = true;
  let fresh = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) {
      outDir = argv[++i];
    } else if (arg === "--limit" && argv[i + 1]) {
      limit = Number(argv[++i]);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error("--limit must be a positive number");
      }
    } else if (arg === "--no-media") {
      downloadMedia = false;
    } else if (arg === "--fresh") {
      fresh = true;
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  const chat = positional.join(" ").trim();
  if (!chat) {
    throw new Error(
      'Usage: npm run export -- "<chat>" [--out ./exports] [--limit 1000] [--no-media] [--fresh]'
    );
  }

  return { chat, outDir, limit, downloadMedia, fresh };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "chat"
  );
}

function extensionFromMime(mimeType: string | undefined, kind: MediaInfo["kind"]): string {
  if (!mimeType) {
    if (kind === "voice") return ".ogg";
    if (kind === "photo") return ".jpg";
    return "";
  }
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "application/pdf": ".pdf",
  };
  return map[mimeType] ?? "";
}

function describeMedia(message: Api.Message): Omit<MediaInfo, "file"> | null {
  if (!message.media) return null;

  if (message.media instanceof Api.MessageMediaPhoto) {
    return { kind: "photo", mimeType: "image/jpeg", fileName: null, size: null };
  }

  if (message.media instanceof Api.MessageMediaDocument) {
    const doc = message.media.document;
    if (!(doc instanceof Api.Document)) {
      return { kind: "other", mimeType: null, fileName: null, size: null };
    }

    let kind: MediaInfo["kind"] = "document";
    let fileName: string | null = null;

    for (const attr of doc.attributes) {
      if (attr instanceof Api.DocumentAttributeFilename) {
        fileName = attr.fileName;
      }
      if (attr instanceof Api.DocumentAttributeAudio) {
        kind = attr.voice ? "voice" : "audio";
      }
      if (attr instanceof Api.DocumentAttributeVideo) {
        kind = attr.roundMessage ? "video" : "video";
      }
      if (attr instanceof Api.DocumentAttributeSticker) {
        kind = "sticker";
      }
    }

    return {
      kind,
      mimeType: doc.mimeType ?? null,
      fileName,
      size: Number(doc.size) || null,
    };
  }

  return { kind: "other", mimeType: null, fileName: null, size: null };
}

function mediaFileName(messageId: number, info: Omit<MediaInfo, "file">): string {
  const ext =
    (info.fileName && path.extname(info.fileName)) ||
    extensionFromMime(info.mimeType ?? undefined, info.kind) ||
    ".bin";
  return info.fileName
    ? `${messageId}_${info.fileName.replace(/[^\w.\-]+/g, "_")}`
    : `${messageId}_${info.kind}${ext}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findExistingMediaOnDisk(
  mediaDir: string,
  messageId: number,
  info: Omit<MediaInfo, "file">
): Promise<string | null> {
  const expected = mediaFileName(messageId, info);
  if (await fileExists(path.join(mediaDir, expected))) {
    return expected;
  }

  const files = await fs.readdir(mediaDir);
  const prefix = `${messageId}_`;
  const match = files.find((f) => f.startsWith(prefix));
  return match ?? null;
}

async function loadManifest(messagesPath: string): Promise<Manifest | null> {
  try {
    const raw = await fs.readFile(messagesPath, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

async function saveManifest(messagesPath: string, manifest: Manifest): Promise<void> {
  manifest.exportedAt = new Date().toISOString();
  manifest.messageCount = manifest.messages.length;
  await fs.writeFile(messagesPath, JSON.stringify(manifest, null, 2), "utf8");
}

async function resolveChat(
  client: Awaited<ReturnType<typeof connectWithSavedSession>>,
  identifier: string
): Promise<{ entity: Awaited<ReturnType<typeof client.getEntity>>; title: string }> {
  try {
    const entity = await client.getEntity(identifier);
    const title =
      ("title" in entity && typeof entity.title === "string" && entity.title) ||
      ("firstName" in entity && [entity.firstName, entity.lastName].filter(Boolean).join(" ")) ||
      ("username" in entity && entity.username && `@${entity.username}`) ||
      identifier;
    return { entity, title };
  } catch {
    // fall through to dialog search
  }

  const dialogs = await client.getDialogs({ limit: undefined });
  const needle = identifier.toLowerCase();

  const exact = dialogs.find(
    (d) => (d.title ?? d.name ?? "").toLowerCase() === needle
  );
  if (exact?.entity) {
    return { entity: exact.entity, title: exact.title ?? exact.name ?? identifier };
  }

  const partial = dialogs.filter((d) =>
    (d.title ?? d.name ?? "").toLowerCase().includes(needle)
  );
  if (partial.length === 1 && partial[0].entity) {
    return {
      entity: partial[0].entity,
      title: partial[0].title ?? partial[0].name ?? identifier,
    };
  }
  if (partial.length > 1) {
    const names = partial.map((d) => d.title ?? d.name).join(", ");
    throw new Error(`Multiple chats match "${identifier}": ${names}. Use a more specific title or id.`);
  }

  throw new Error(`Chat not found: "${identifier}". Run: npm run list-chats`);
}

async function downloadMessageMedia(
  client: Awaited<ReturnType<typeof connectWithSavedSession>>,
  message: Api.Message,
  mediaDir: string,
  existingFile: string | null
): Promise<string | null> {
  const info = describeMedia(message);
  if (!info) return null;

  if (existingFile && (await fileExists(path.join(mediaDir, existingFile)))) {
    return existingFile;
  }

  const onDisk = await findExistingMediaOnDisk(mediaDir, message.id, info);
  if (onDisk) {
    return onDisk;
  }

  const outputFile = path.join(mediaDir, mediaFileName(message.id, info));
  const saved = await client.downloadMedia(message, { outputFile });
  if (!saved) return null;
  const savedPath = typeof saved === "string" ? saved : outputFile;
  return path.basename(savedPath);
}

async function isMessageCompleteAsync(
  exportRoot: string,
  mediaDir: string,
  msg: ExportedMessage,
  downloadMedia: boolean
): Promise<boolean> {
  if (!downloadMedia || !msg.media) return true;
  if (msg.media.file && (await fileExists(path.join(exportRoot, msg.media.file)))) {
    return true;
  }
  const onDisk = await findExistingMediaOnDisk(mediaDir, msg.id, msg.media);
  return onDisk !== null;
}

function toExportedRow(
  message: Api.Message,
  mediaMeta: Omit<MediaInfo, "file"> | null,
  mediaFile: string | null
): ExportedMessage {
  return {
    id: message.id,
    date: message.date ? new Date(message.date * 1000).toISOString() : "",
    senderId: message.senderId?.toString() ?? null,
    text: message.message?.toString() ?? "",
    replyToMsgId: message.replyTo?.replyToMsgId ?? null,
    media: mediaMeta
      ? {
          ...mediaMeta,
          file: mediaFile ? path.join("media", path.basename(mediaFile)) : null,
        }
      : null,
  };
}

async function repairIncompleteMedia(
  client: Awaited<ReturnType<typeof connectWithSavedSession>>,
  entity: Awaited<ReturnType<typeof client.getEntity>>,
  exportRoot: string,
  mediaDir: string,
  messagesById: Map<number, ExportedMessage>,
  downloadMedia: boolean,
  manifest: Manifest,
  messagesPath: string
): Promise<number> {
  if (!downloadMedia) return 0;

  const incompleteIds: number[] = [];
  for (const [id, msg] of messagesById) {
    if (!(await isMessageCompleteAsync(exportRoot, mediaDir, msg, downloadMedia))) {
      incompleteIds.push(id);
    }
  }

  if (incompleteIds.length === 0) return 0;

  console.log(`Repairing ${incompleteIds.length} messages with missing media...`);
  let repaired = 0;

  for (let i = 0; i < incompleteIds.length; i += 100) {
    const batch = incompleteIds.slice(i, i + 100);
    const fetched = await client.getMessages(entity, { ids: batch });

    for (const message of fetched) {
      if (!message) continue;

      const existing = messagesById.get(message.id);
      const mediaMeta = describeMedia(message) ?? existing?.media;
      if (!mediaMeta) continue;

      let mediaFile: string | null = existing?.media?.file
        ? path.basename(existing.media.file)
        : null;

      const onDisk = await findExistingMediaOnDisk(mediaDir, message.id, mediaMeta);
      if (onDisk) {
        mediaFile = onDisk;
      } else {
        try {
          mediaFile = await downloadMessageMedia(client, message, mediaDir, mediaFile);
        } catch (err) {
          console.warn(`  failed media for message ${message.id}:`, (err as Error).message);
        }
      }

      messagesById.set(
        message.id,
        toExportedRow(message, mediaMeta, mediaFile)
      );
      repaired++;
    }

    manifest.messages = [...messagesById.values()].sort((a, b) => a.id - b.id);
    await saveManifest(messagesPath, manifest);
    console.log(`  repair progress: ${Math.min(i + 100, incompleteIds.length)}/${incompleteIds.length}`);
  }

  return repaired;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = await connectWithSavedSession({ ignoreUpdateTimeouts: true });
  const { entity, title } = await resolveChat(client, args.chat);

  const chatSlug = slugify(title);
  const exportRoot = path.resolve(args.outDir, chatSlug);
  const mediaDir = path.join(exportRoot, "media");
  const messagesPath = path.join(exportRoot, "messages.json");
  await fs.mkdir(mediaDir, { recursive: true });

  const previous = args.fresh ? null : await loadManifest(messagesPath);
  const messagesById = new Map<number, ExportedMessage>();

  let maxExportedId = 0;
  if (previous) {
    for (const msg of previous.messages) {
      messagesById.set(msg.id, msg);
      if (msg.id > maxExportedId) maxExportedId = msg.id;
    }
  }

  const manifest: Manifest = {
    chat: args.chat,
    title,
    exportedAt: new Date().toISOString(),
    messageCount: messagesById.size,
    downloadMedia: args.downloadMedia,
    messages: [],
  };

  console.log(`Exporting "${title}" → ${exportRoot}`);
  if (args.limit) console.log(`Limit: ${args.limit} messages`);
  if (!args.downloadMedia) console.log("Media download: disabled");
  if (previous && !args.fresh) {
    console.log(`Resuming: ${messagesById.size} messages already exported (last id: ${maxExportedId})`);
  }
  if (args.fresh) console.log("Fresh export: ignoring previous messages.json");

  let scanned = 0;
  let newCount = 0;
  let skipped = 0;
  let sinceLastSave = 0;

  const iterParams: {
    reverse: boolean;
    limit?: number;
    minId?: number;
    waitTime?: number;
  } = {
    reverse: true,
    limit: args.limit,
    waitTime: 1,
  };

  if (!args.fresh && maxExportedId > 0) {
    iterParams.minId = maxExportedId;
  }

  for await (const message of client.iterMessages(entity, iterParams)) {
    scanned++;
    const existing = messagesById.get(message.id);

    if (existing && (await isMessageCompleteAsync(exportRoot, mediaDir, existing, args.downloadMedia))) {
      skipped++;
      continue;
    }

    const mediaMeta = describeMedia(message);
    let mediaFile: string | null = existing?.media?.file
      ? path.basename(existing.media.file)
      : null;

    if (args.downloadMedia && mediaMeta) {
      const onDisk = await findExistingMediaOnDisk(mediaDir, message.id, mediaMeta);
      if (onDisk) {
        mediaFile = onDisk;
      } else {
        try {
          mediaFile = await downloadMessageMedia(client, message, mediaDir, mediaFile);
        } catch (err) {
          console.warn(`  failed media for message ${message.id}:`, (err as Error).message);
        }
      }
    }

    messagesById.set(message.id, toExportedRow(message, mediaMeta, mediaFile));
    newCount++;
    sinceLastSave++;

    if (sinceLastSave >= SAVE_EVERY) {
      manifest.messages = [...messagesById.values()].sort((a, b) => a.id - b.id);
      await saveManifest(messagesPath, manifest);
      sinceLastSave = 0;
      console.log(`  saved progress: ${manifest.messages.length} total (${newCount} new this run, ${skipped} skipped)`);
    } else if (newCount % 25 === 0) {
      console.log(`  processed ${newCount} new, skipped ${skipped}, scanned ${scanned}...`);
    }
  }

  const repaired = await repairIncompleteMedia(
    client,
    entity,
    exportRoot,
    mediaDir,
    messagesById,
    args.downloadMedia,
    manifest,
    messagesPath
  );

  manifest.messages = [...messagesById.values()].sort((a, b) => a.id - b.id);
  await saveManifest(messagesPath, manifest);

  let stillMissing = 0;
  if (args.downloadMedia) {
    for (const msg of manifest.messages) {
      if (!(await isMessageCompleteAsync(exportRoot, mediaDir, msg, true))) {
        stillMissing++;
      }
    }
  }

  console.log(`\nDone. ${manifest.messages.length} messages total.`);
  console.log(`  This run: ${newCount} new, ${skipped} skipped, ${repaired} media repaired`);
  if (stillMissing > 0) {
    console.log(`  Warning: ${stillMissing} messages still missing media (deleted on Telegram or download failed)`);
  } else if (newCount === 0 && repaired === 0) {
    console.log(`  Export complete — nothing left to fetch.`);
  }
  console.log(`  ${messagesPath}`);
  if (args.downloadMedia) {
    console.log(`  ${mediaDir}/`);
  }

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
