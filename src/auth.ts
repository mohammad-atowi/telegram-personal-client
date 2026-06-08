/**
 * One-time login: phone → code → optional 2FA.
 * Prints TELEGRAM_SESSION — copy it into .env.
 */
import input from "input";
import { createClient } from "./client.js";

async function main() {
  const client = createClient();

  await client.start({
    phoneNumber: async () =>
      await input.text("Phone (international, e.g. +1234567890): "),
    phoneCode: async () => await input.text("Code from Telegram: "),
    password: async () => {
      const pw = await input.text("2FA password (press Enter if none): ");
      return pw || undefined;
    },
    onError: (err) => console.error(err),
  });

  const me = await client.getMe();
  console.log("\nLogged in as:", me?.firstName, me?.username ? `@${me.username}` : "");

  console.log("\nAdd this to your .env:\n");
  console.log(`TELEGRAM_SESSION=${client.session.save()}\n`);

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
