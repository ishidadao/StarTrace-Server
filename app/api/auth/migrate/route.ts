import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "../../../../lib/auth";
import { hashSyncKey, migrateLegacyOwner } from "../../../../lib/gacha-store";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const body = await request.json() as { legacyKey?: string };
    const legacyKey = body.legacyKey?.trim() ?? "";
    if (legacyKey.length < 12) {
      return NextResponse.json({ error: "旧同步密钥至少需要 12 个字符" }, { status: 400 });
    }
    const migrated = await migrateLegacyOwner(await hashSyncKey(legacyKey), user.id);
    return NextResponse.json({ ok: true, migrated });
  } catch {
    return NextResponse.json({ error: "迁移旧同步空间失败" }, { status: 400 });
  }
}
