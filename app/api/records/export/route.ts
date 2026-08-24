import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "../../../../lib/auth";
import { type GameId, listAccounts, listRecords } from "../../../../lib/gacha-store";

export const runtime = "edge";

type StoredRow = Record<string, string | number | null>;

function isGame(value: unknown): value is GameId {
  return value === "genshin" || value === "wuwa";
}

function portableRecord(row: StoredRow, uid: string) {
  return {
    uid,
    recordId: String(row.record_id ?? ""),
    poolType: String(row.pool_type ?? "unknown"),
    itemId: String(row.item_id ?? "unknown"),
    itemName: String(row.item_name ?? "未知物品"),
    itemType: String(row.item_type ?? "未知"),
    rarity: Number(row.rarity ?? 0),
    pulledAt: String(row.pulled_at ?? ""),
    drawOrder: Number(row.draw_order ?? 0),
    serverId: row.server_id ? String(row.server_id) : undefined,
  };
}

export async function GET(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const accountRows = await listAccounts(user.id);
  const accounts = await Promise.all(accountRows.flatMap((row) => {
    const game = String(row.game);
    const uid = String(row.uid);
    if (!isGame(game) || !/^\d{5,12}$/.test(uid)) return [];
    return [listRecords(user.id, game, uid).then((records) => ({
      game,
      uid,
      records: records.map((record) => portableRecord(record, uid)),
    }))];
  }));

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify({
    format: "startrace-backup",
    version: 1,
    exportedAt,
    accounts,
  }, null, 2);
  const filename = `startrace-backup-${exportedAt.slice(0, 10)}.json`;

  return new NextResponse(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
