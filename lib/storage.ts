import { env } from "cloudflare:workers";
import type { SourceAccessStatus } from "./types";

interface RuntimeEnv {
  DB?: D1Database;
}

interface SourceUrlRow {
  source_url: string;
  first_seen_at: string;
  generate_count: number;
}

const encoder = new TextEncoder();

function getDb() {
  return (env as unknown as RuntimeEnv).DB;
}

async function hashValue(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function ensureStorage() {
  const db = getDb();
  if (!db) {
    return;
  }

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS source_urls (
      url_hash TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_access_status TEXT NOT NULL,
      generate_count INTEGER NOT NULL DEFAULT 1
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      scope TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);
}

export async function getDuplicateInfo(url: string) {
  const db = getDb();
  if (!db) {
    return { isDuplicate: false };
  }

  await ensureStorage();
  const urlHash = await hashValue(url);
  const row = await db
    .prepare(
      "SELECT source_url, first_seen_at, generate_count FROM source_urls WHERE url_hash = ?"
    )
    .bind(urlHash)
    .first<SourceUrlRow>();

  if (!row) {
    return { isDuplicate: false };
  }

  return {
    isDuplicate: true,
    firstSeenAt: row.first_seen_at,
    generateCount: row.generate_count,
  };
}

export async function recordSourceUrl(
  url: string,
  accessStatus: SourceAccessStatus
) {
  const db = getDb();
  if (!db) {
    return;
  }

  await ensureStorage();
  const urlHash = await hashValue(url);
  await db
    .prepare(
      `INSERT INTO source_urls (
        url_hash,
        source_url,
        last_access_status,
        generate_count
      ) VALUES (?, ?, ?, 1)
      ON CONFLICT(url_hash) DO UPDATE SET
        last_generated_at = CURRENT_TIMESTAMP,
        last_access_status = excluded.last_access_status,
        generate_count = source_urls.generate_count + 1`
    )
    .bind(urlHash, url, accessStatus)
    .run();
}

export async function checkRateLimit(
  scope: string,
  limit: number,
  windowSeconds: number
) {
  const db = getDb();
  if (!db) {
    return { allowed: true, remaining: limit };
  }

  await ensureStorage();
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const existing = await db
    .prepare("SELECT window_start, count FROM rate_limits WHERE scope = ?")
    .bind(scope)
    .first<{ window_start: number; count: number }>();

  if (!existing || existing.window_start !== windowStart) {
    await db
      .prepare(
        "INSERT OR REPLACE INTO rate_limits (scope, window_start, count) VALUES (?, ?, 1)"
      )
      .bind(scope, windowStart)
      .run();
    return { allowed: true, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: windowStart + windowSeconds - now,
    };
  }

  await db
    .prepare("UPDATE rate_limits SET count = count + 1 WHERE scope = ?")
    .bind(scope)
    .run();

  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count - 1),
  };
}
