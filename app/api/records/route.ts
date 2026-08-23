import { NextRequest, NextResponse } from "next/server";
import {
  type GameId,
  listAccounts,
  listRecords,
  type NormalizedRecord,
  upsertRecords,
} from "../../../lib/gacha-store";
import { authenticateRequest } from "../../../lib/auth";
import { addIconUrls } from "../../../lib/item-icons";
import { assignDrawOrders, canonicalPool } from "../../../lib/gacha-stats";
import { addUpStatuses } from "../../../lib/up-status";

export const runtime = "edge";

function validGame(value: unknown): value is GameId {
  return value === "genshin" || value === "wuwa";
}

function isUid(value: unknown): value is string {
  return typeof value === "string" && /^\d{5,12}$/.test(value);
}

function boundedText(value: unknown, maximum: number, fallback = "") {
  const normalized = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  return normalized && normalized.length <= maximum ? normalized : fallback;
}

function cleanRecord(value: unknown, uid: string, game: GameId): NormalizedRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const rowUid = String(row.uid ?? row.playerId ?? uid);
  if (rowUid !== uid) return null;

  const recordId = boundedText(row.recordId ?? row.id, 160);
  const pulledAt = boundedText(row.pulledAt ?? row.time, 32);
  if (!/^[A-Za-z0-9:_-]+$/.test(recordId)) return null;
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(pulledAt)) return null;

  const rarity = Number(row.rarity ?? row.rank_type ?? row.qualityLevel ?? 0);
  if (!Number.isInteger(rarity) || rarity < 3 || rarity > 5) return null;

  const rawPoolType = boundedText(row.poolType ?? row.gacha_type ?? row.cardPoolType, 40, "unknown");
  return {
    uid,
    recordId,
    poolType: canonicalPool(game, rawPoolType),
    itemId: boundedText(row.itemId ?? row.item_id ?? row.resourceId, 80, "unknown"),
    itemName: boundedText(row.itemName ?? row.name, 80, "未知物品"),
    itemType: boundedText(row.itemType ?? row.item_type ?? row.resourceType, 40, "未知"),
    rarity,
    pulledAt,
    drawOrder: 0,
    serverId: boundedText(row.serverId, 40) || undefined,
  };
}

export async function GET(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const gameParam = request.nextUrl.searchParams.get("game");
  const uid = request.nextUrl.searchParams.get("uid");
  if (gameParam && !validGame(gameParam)) {
    return NextResponse.json({ error: "不支持的游戏" }, { status: 400 });
  }

  const accounts = await listAccounts(user.id);
  if (!uid) return NextResponse.json({ accounts });
  if (!gameParam || !validGame(gameParam) || !isUid(uid)) {
    return NextResponse.json({ error: "game 与 uid 参数无效" }, { status: 400 });
  }

  const storedRecords = await listRecords(user.id, gameParam, uid);
  const [recordsWithIcons, recordsWithUpStatuses] = await Promise.all([
    addIconUrls(gameParam, storedRecords),
    addUpStatuses(gameParam, storedRecords),
  ]);
  const records = recordsWithIcons.map((record, index) => ({
    ...record,
    up_status: recordsWithUpStatuses[index]?.up_status ?? "unknown",
    up_label: recordsWithUpStatuses[index]?.up_label ?? "待判定",
    up_detail: recordsWithUpStatuses[index]?.up_detail ?? "缺少判定信息",
  }));
  return NextResponse.json({ accounts, records });
}

export async function POST(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "请求体不得超过 8 MiB" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求不是有效 JSON" }, { status: 400 });
  }

  const game = body.game;
  const uid = String(body.uid ?? "");
  const rows = body.records;
  if (!validGame(game) || !isUid(uid) || !Array.isArray(rows)) {
    return NextResponse.json({ error: "必须提供有效的 game、uid 与 records" }, { status: 400 });
  }
  if (rows.length === 0 || rows.length > 10000) {
    return NextResponse.json({ error: "单次上传应包含 1–10000 条记录" }, { status: 400 });
  }

  const records = rows.map((row) => cleanRecord(row, uid, game));
  if (records.some((row) => row === null)) {
    return NextResponse.json(
      { error: "记录格式无效，或记录中的 UID 与本次上传 UID 不一致" },
      { status: 422 },
    );
  }

  const validRecords = records as NormalizedRecord[];
  const drawOrders = assignDrawOrders(validRecords, game);
  const orderedRecords = validRecords.map((record, index) => ({
    ...record,
    drawOrder: drawOrders[index],
  }));

  const result = await upsertRecords({
    ownerKey: user.id,
    game,
    uid,
    source: boundedText(body.source, 40, "desktop"),
    records: orderedRecords,
  });

  return NextResponse.json({
    ok: true,
    game,
    uid,
    written: result.written,
    ignoredDuplicates: result.ignored,
  });
}
