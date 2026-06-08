import "dotenv/config";
import { TelegramClient } from "telegram";
import { LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} in .env (see .env.example)`);
  }
  return value;
}

export function getApiCredentials(): { apiId: number; apiHash: string } {
  const apiId = Number(requireEnv("TELEGRAM_API_ID"));
  if (!Number.isFinite(apiId)) {
    throw new Error("TELEGRAM_API_ID must be a number");
  }
  return { apiId, apiHash: requireEnv("TELEGRAM_API_HASH") };
}

export function createClient(sessionString = ""): TelegramClient {
  const { apiId, apiHash } = getApiCredentials();
  // Port 80 MTProto is often blocked; WSS uses 443 and usually works.
  const useWSS = process.env.TELEGRAM_USE_WSS !== "false";
  return new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
    useWSS,
  });
}

export async function connectWithSavedSession(options?: {
  /** Ignore background update-loop TIMEOUT noise during long exports */
  ignoreUpdateTimeouts?: boolean;
}): Promise<TelegramClient> {
  const session = requireEnv("TELEGRAM_SESSION");
  const client = createClient(session);

  if (options?.ignoreUpdateTimeouts) {
    client.setLogLevel(LogLevel.ERROR);
    client._errorHandler = async (error: Error) => {
      if (error.message === "TIMEOUT") return;
      console.error(error);
    };
  }

  await client.connect();
  if (!(await client.isUserAuthorized())) {
    throw new Error("Session invalid or expired. Run: npm run auth");
  }
  return client;
}
