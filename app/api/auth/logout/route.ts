import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, revokeRequestSession } from "../../../../lib/auth";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  await revokeRequestSession(request);
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
