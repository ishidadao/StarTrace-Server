import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const gachaRecords = sqliteTable(
  "gacha_records",
  {
    ownerKey: text("owner_key").notNull(),
    game: text("game", { enum: ["genshin", "wuwa"] }).notNull(),
    uid: text("uid").notNull(),
    recordId: text("record_id").notNull(),
    poolType: text("pool_type").notNull(),
    itemId: text("item_id").notNull(),
    itemName: text("item_name").notNull(),
    itemType: text("item_type").notNull(),
    rarity: integer("rarity").notNull(),
    pulledAt: text("pulled_at").notNull(),
    drawOrder: integer("draw_order").notNull().default(0),
    serverId: text("server_id"),
    rawJson: text("raw_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerKey, table.game, table.uid, table.recordId] }),
    index("idx_gacha_records_account_time").on(
      table.ownerKey,
      table.game,
      table.uid,
      table.pulledAt,
    ),
    index("idx_gacha_records_account_pool").on(
      table.ownerKey,
      table.game,
      table.uid,
      table.poolType,
    ),
  ],
);

export const uploadBatches = sqliteTable(
  "upload_batches",
  {
    ownerKey: text("owner_key").notNull(),
    game: text("game", { enum: ["genshin", "wuwa"] }).notNull(),
    uid: text("uid").notNull(),
    source: text("source").notNull(),
    lastCount: integer("last_count").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerKey, table.game, table.uid] }),
  ],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_users_username").on(table.username)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("idx_sessions_user").on(table.userId),
    index("idx_sessions_expires").on(table.expiresAt),
  ],
);

export const authLoginAttempts = sqliteTable(
  "auth_login_attempts",
  {
    username: text("username").primaryKey(),
    failures: integer("failures").notNull(),
    windowStarted: text("window_started").notNull(),
  },
);
