import { createClient } from "./client.js";

async function main() {
  const client = createClient();
  await client.connect();
  console.log("Connected to Telegram:", client.connected);
  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
