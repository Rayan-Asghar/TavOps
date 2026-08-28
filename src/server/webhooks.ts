import { log } from "@/lib/logger";

/**
 * Outbound delivery to chat.
 *
 * The team is spread across Discord, WhatsApp, Slack and the room. Building a
 * bot for each is three integrations to maintain to reach one team, so the
 * shape here is deliberately asymmetric: **input converges** on one surface
 * (the app, on a phone) and **output fans out** to whatever people read.
 *
 * Discord and Slack both take an incoming webhook with a JSON body, so both
 * cost one integration between them. WhatsApp has no webhook without the
 * Business API — that gap is real, and the digest is served at /digest so it
 * can be pasted in until somebody decides the API is worth the setup.
 */

/** Discord rejects a message body over 2000 characters. */
const DISCORD_LIMIT = 1900;

function targets(): string[] {
  return (process.env.DIGEST_WEBHOOK_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * Splits on line boundaries so a project never straddles two messages.
 * A single line longer than the limit is hard-cut rather than dropped.
 */
export function chunk(text: string, limit = DISCORD_LIMIT): string[] {
  const out: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (line.length > limit) {
      if (current) {
        out.push(current);
        current = "";
      }
      for (let i = 0; i < line.length; i += limit) {
        out.push(line.slice(i, i + limit));
      }
      continue;
    }
    if (current.length + line.length + 1 > limit) {
      out.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }

  if (current) out.push(current);
  return out;
}

/**
 * Body shape per provider.
 *
 * Keyed off the host rather than sending both `content` and `text` and hoping
 * each side ignores the other's field — guessing at another service's
 * tolerance for unknown keys is how integrations break on someone else's
 * deploy. An unrecognised host gets both, which is the only useful guess left.
 */
function bodyFor(url: string, message: string): string {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  })();

  if (host.endsWith("discord.com") || host.endsWith("discordapp.com")) {
    return JSON.stringify({ content: message });
  }
  if (host.endsWith("slack.com")) {
    return JSON.stringify({ text: message });
  }
  return JSON.stringify({ content: message, text: message });
}

export type DeliveryResult = {
  delivered: number;
  failed: number;
  configured: number;
};

/**
 * Posts a message to every configured webhook.
 *
 * Never throws: a chat webhook being down must not fail the cron run that
 * produced the message, or a broken Discord integration would also stop the
 * sweeps that share the schedule.
 */
export async function deliver(message: string): Promise<DeliveryResult> {
  const urls = targets();
  if (urls.length === 0) {
    log.info("webhook.skipped", { reason: "DIGEST_WEBHOOK_URLS is not set" });
    return { delivered: 0, failed: 0, configured: 0 };
  }

  const parts = chunk(message);
  let delivered = 0;
  let failed = 0;

  for (const url of urls) {
    try {
      // Sequential within a target: chat webhooks are rate limited, and two
      // halves of one digest arriving out of order reads as nonsense.
      for (const part of parts) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: bodyFor(url, part),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
      }
      delivered++;
    } catch (err) {
      failed++;
      // The URL itself is a credential, so only its host is logged.
      const host = (() => {
        try {
          return new URL(url).host;
        } catch {
          return "invalid-url";
        }
      })();
      log.error("webhook.failed", { host, err });
    }
  }

  return { delivered, failed, configured: urls.length };
}
