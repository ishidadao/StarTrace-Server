import { NextRequest, NextResponse } from "next/server";
import { loginUser, setSessionCookie } from "../../../../lib/auth";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { username?: string; password?: string };
    const session = await loginUser(body.username ?? "", body.password ?? "");
    const response = NextResponse.json({
      user: session.user,
      accessToken: session.token,
      expiresAt: session.expiresAt,
    });
    setSessionCookie(response, session.token);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录失败" },
      { status: 401 },
    );
  }
}
