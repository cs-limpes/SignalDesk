import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sourceUrls = sqliteTable("source_urls", {
  urlHash: text("url_hash").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastGeneratedAt: text("last_generated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastAccessStatus: text("last_access_status").notNull(),
  generateCount: integer("generate_count").notNull().default(1),
});

export const rateLimits = sqliteTable("rate_limits", {
  scope: text("scope").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
