import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "../../../../lib/auth";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const user = await authenticateRequest(request);
  return user
    ? NextResponse.json({ user })
    : NextResponse.json({ error: "未登录" }, { status: 401 });
}
