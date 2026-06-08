/**
 * List your dialogs so you can pick a chat id / username / exact title for export.
 */
import { connectWithSavedSession } from "./client.js";

async function main() {
  const client = await connectWithSavedSession();
  const dialogs = await client.getDialogs({ limit: undefined });

  const rows = dialogs.map((d) => ({
    title: d.title ?? d.name ?? "(unknown)",
    id: d.id?.toString() ?? "",
    username: d.entity && "username" in d.entity ? d.entity.username ?? null : null,
    isGroup: d.isGroup ?? false,
    isChannel: d.isChannel ?? false,
    isUser: d.isUser ?? false,
  }));

  console.log(JSON.stringify(rows, null, 2));
  console.log(`\n${rows.length} chats. Export with:`);
  console.log('  npm run export -- 123456789');
  console.log('  npm run export -- "@exampleuser"');
  console.log('  npm run export -- "Example Chat"');

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
