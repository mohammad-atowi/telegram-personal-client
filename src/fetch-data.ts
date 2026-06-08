/**
 * Example: list dialogs and fetch recent messages from one chat.
 * Customize limits and export format for your use case.
 */
import { Api } from "telegram";
import { connectWithSavedSession } from "./client.js";

type DialogRow = {
  id: string;
  title: string;
  unreadCount: number;
  isGroup: boolean;
  isChannel: boolean;
};

type MessageRow = {
  id: number;
  date: string;
  senderId: string | null;
  text: string;
};

async function main() {
  const client = await connectWithSavedSession();

  const dialogs = await client.getDialogs({ limit: 20 });
  const rows: DialogRow[] = dialogs.map((d) => ({
    id: d.id?.toString() ?? "",
    title: d.title ?? d.name ?? "(unknown)",
    unreadCount: d.unreadCount ?? 0,
    isGroup: d.isGroup ?? false,
    isChannel: d.isChannel ?? false,
  }));

  console.log("Dialogs (up to 20):\n", JSON.stringify(rows, null, 2));

  const first = dialogs[0];
  if (!first) {
    await client.disconnect();
    return;
  }

  const messages = await client.getMessages(first.entity!, { limit: 10 });
  const messageRows: MessageRow[] = messages.map((m) => ({
    id: m.id,
    date: m.date ? new Date(m.date * 1000).toISOString() : "",
    senderId: m.senderId?.toString() ?? null,
    text: m.message?.toString() ?? "",
  }));

  console.log(`\nLast 10 messages in "${first.title ?? first.name}":\n`, JSON.stringify(messageRows, null, 2));

  // Raw API example — full account profile
  const fullUser = await client.invoke(new Api.users.GetFullUser({ id: "me" }));
  console.log("\nYour account (users.GetFullUser):\n", JSON.stringify(fullUser, null, 2));

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
