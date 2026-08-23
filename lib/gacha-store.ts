import { env } from "cloudflare:workers";

export type GameId = "genshin" | "wuwa";

export type NormalizedRecord = {
  uid: string;
  recordId: string;
  poolType: string;
  itemId: string;
  itemName: string;
  itemType: string;
  rarity: number;
  pulledAt: string;
  drawOrder: number;
  serverId?: string;
  raw?: unknown;
};

type D1Row = Record<string, string | number | null>;

type PreparedRecords = {
  records: NormalizedRecord[];
  ignored: number;
};

const createRecordsSql = `CREATE TABLE IF NOT EXISTS gacha_records (
  owner_key TEXT NOT NULL,
  game TEXT NOT NULL CHECK (game IN ('genshin', 'wuwa')),
  uid TEXT NOT NULL,
  record_id TEXT NOT NULL,
  pool_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL,
  rarity INTEGER NOT NULL,
  pulled_at TEXT NOT NULL,
  draw_order INTEGER NOT NULL DEFAULT 0,
  server_id TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, game, uid, record_id)
)`;

const createBatchesSql = `CREATE TABLE IF NOT EXISTS upload_batches (
  owner_key TEXT NOT NULL,
  game TEXT NOT NULL CHECK (game IN ('genshin', 'wuwa')),
  uid TEXT NOT NULL,
  source TEXT NOT NULL,
  last_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, game, uid)
)`;

let schemaReady = false;

function db(): D1Database {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB as D1Database;
}

export async function ensureSchema() {
  if (schemaReady) return;
  const database = db();
  await database.batch([
    database.prepare(createRecordsSql),
    database.prepare(createBatchesSql),
  ]);
  const columns = await database.prepare("PRAGMA table_info(gacha_records)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "draw_order")) {
    await database.prepare("ALTER TABLE gacha_records ADD COLUMN draw_order INTEGER NOT NULL DEFAULT 0").run();
  }
  await database.batch([
    database
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_gacha_records_account_time ON gacha_records(owner_key, game, uid, pulled_at)",
      ),
    database
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_gacha_records_account_pool ON gacha_records(owner_key, game, uid, pool_type)",
      ),
  ]);
  schemaReady = true;
}

export async function hashSyncKey(value: string) {
  const bytes = new TextEncoder().encode(value.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function wuwaNaturalKey(record: NormalizedRecord) {
  return JSON.stringify([
    record.poolType,
    record.pulledAt,
    record.itemId,
    record.rarity,
  ]);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function prepareWuwaRecords(
  database: D1Database,
  ownerKey: string,
  uid: string,
  incoming: NormalizedRecord[],
): Promise<PreparedRecords> {
  const existingResult = await database
    .prepare(
      `SELECT pool_type, item_id, rarity, pulled_at
       FROM gacha_records
       WHERE owner_key = ? AND game = 'wuwa' AND uid = ?`,
    )
    .bind(ownerKey, uid)
    .all<D1Row>();

  const existingCounts = new Map<string, number>();
  for (const row of existingResult.results) {
    const key = JSON.stringify([
      String(row.pool_type),
      String(row.pulled_at),
      String(row.item_id),
      Number(row.rarity),
    ]);
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }

  const incomingGroups = new Map<string, NormalizedRecord[]>();
  for (const record of incoming) {
    const key = wuwaNaturalKey(record);
    const group = incomingGroups.get(key);
    if (group) group.push(record);
    else incomingGroups.set(key, [record]);
  }

  const prepared: NormalizedRecord[] = [];
  let ignored = 0;
  for (const [key, group] of incomingGroups) {
    // Wuthering Waves history is immutable. Once a natural record identity is
    // present, later snapshots may update its metadata but must not increase
    // its multiplicity. This blocks clients whose synthetic IDs change when
    // newer pulls are prepended, while preserving genuine repeated items in a
    // ten-pull on their first upload.
    const existingCount = existingCounts.get(key) ?? 0;
    const acceptedCount = existingCount > 0
      ? Math.min(existingCount, group.length)
      : group.length;
    const digest = await sha256(key);

    for (let index = 0; index < acceptedCount; index += 1) {
      prepared.push({
        ...group[index],
        recordId: `wuwa:v2:${digest}:${index + 1}`,
      });
    }
    ignored += group.length - acceptedCount;
  }

  return { records: prepared, ignored };
}

export async function upsertRecords(args: {
  ownerKey: string;
  game: GameId;
  uid: string;
  source: string;
  records: NormalizedRecord[];
}) {
  await ensureSchema();
  const database = db();
  const now = new Date().toISOString();
  const prepared = args.game === "wuwa"
    ? await prepareWuwaRecords(database, args.ownerKey, args.uid, args.records)
    : { records: args.records, ignored: 0 };
  let written = 0;

  for (let offset = 0; offset < prepared.records.length; offset += 150) {
    const chunk = prepared.records.slice(offset, offset + 150);
    const statements = chunk.map((record) =>
      database
        .prepare(
          `INSERT INTO gacha_records (
            owner_key, game, uid, record_id, pool_type, item_id, item_name,
            item_type, rarity, pulled_at, draw_order, server_id, raw_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(owner_key, game, uid, record_id) DO UPDATE SET
            pool_type = excluded.pool_type,
            item_id = excluded.item_id,
            item_name = excluded.item_name,
            item_type = excluded.item_type,
            rarity = excluded.rarity,
            pulled_at = excluded.pulled_at,
            draw_order = excluded.draw_order,
            server_id = excluded.server_id,
            raw_json = excluded.raw_json`,
        )
        .bind(
          args.ownerKey,
          args.game,
          args.uid,
          record.recordId,
          record.poolType,
          record.itemId,
          record.itemName,
          record.itemType,
          record.rarity,
          record.pulledAt,
          record.drawOrder,
          record.serverId ?? null,
          record.raw === undefined ? null : JSON.stringify(record.raw),
          now,
        ),
    );
    await database.batch(statements);
    written += chunk.length;
  }

  await database
    .prepare(
      `INSERT INTO upload_batches (owner_key, game, uid, source, last_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_key, game, uid) DO UPDATE SET
         source = excluded.source,
         last_count = excluded.last_count,
         updated_at = excluded.updated_at`,
    )
    .bind(args.ownerKey, args.game, args.uid, args.source, written, now)
    .run();

  return { written, ignored: prepared.ignored };
}

export async function listAccounts(ownerKey: string, game?: GameId) {
  await ensureSchema();
  const query = game
    ? db()
        .prepare(
          `SELECT r.game, r.uid, COUNT(*) AS total, MAX(r.pulled_at) AS last_pull,
             COALESCE(b.updated_at, '') AS updated_at
           FROM gacha_records r
           LEFT JOIN upload_batches b
             ON b.owner_key = r.owner_key AND b.game = r.game AND b.uid = r.uid
           WHERE r.owner_key = ? AND r.game = ?
           GROUP BY r.game, r.uid, b.updated_at
           ORDER BY b.updated_at DESC, r.uid`,
        )
        .bind(ownerKey, game)
    : db()
        .prepare(
          `SELECT r.game, r.uid, COUNT(*) AS total, MAX(r.pulled_at) AS last_pull,
             COALESCE(b.updated_at, '') AS updated_at
           FROM gacha_records r
           LEFT JOIN upload_batches b
             ON b.owner_key = r.owner_key AND b.game = r.game AND b.uid = r.uid
           WHERE r.owner_key = ?
           GROUP BY r.game, r.uid, b.updated_at
           ORDER BY b.updated_at DESC, r.game, r.uid`,
        )
        .bind(ownerKey);
  const result = await query.all<D1Row>();
  return result.results;
}

export async function listRecords(ownerKey: string, game: GameId, uid: string) {
  await ensureSchema();
  const result = await db()
    .prepare(
      `SELECT record_id, pool_type, item_id, item_name, item_type, rarity,
         pulled_at, draw_order, server_id
       FROM gacha_records
       WHERE owner_key = ? AND game = ? AND uid = ?
       ORDER BY pulled_at DESC, draw_order ASC, record_id DESC`,
    )
    .bind(ownerKey, game, uid)
    .all<D1Row>();
  return result.results;
}

export async function migrateLegacyOwner(legacyOwnerKey: string, userId: string) {
  await ensureSchema();
  if (!legacyOwnerKey || legacyOwnerKey === userId) return 0;
  const database = db();
  const countRow = await database
    .prepare("SELECT COUNT(*) AS total FROM gacha_records WHERE owner_key = ?")
    .bind(legacyOwnerKey)
    .first<{ total: number }>();
  const total = Number(countRow?.total ?? 0);
  if (!total) return 0;

  await database.batch([
    database
      .prepare(`INSERT OR IGNORE INTO gacha_records (
        owner_key, game, uid, record_id, pool_type, item_id, item_name,
        item_type, rarity, pulled_at, draw_order, server_id, raw_json, created_at
      )
      SELECT ?, game, uid, record_id, pool_type, item_id, item_name,
        item_type, rarity, pulled_at, draw_order, server_id, raw_json, created_at
      FROM gacha_records WHERE owner_key = ?`)
      .bind(userId, legacyOwnerKey),
    database
      .prepare(`INSERT OR REPLACE INTO upload_batches (
        owner_key, game, uid, source, last_count, updated_at
      )
      SELECT ?, game, uid, source, last_count, updated_at
      FROM upload_batches WHERE owner_key = ?`)
      .bind(userId, legacyOwnerKey),
    database.prepare("DELETE FROM upload_batches WHERE owner_key = ?").bind(legacyOwnerKey),
    database.prepare("DELETE FROM gacha_records WHERE owner_key = ?").bind(legacyOwnerKey),
  ]);
  return total;
}
