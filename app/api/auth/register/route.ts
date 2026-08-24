import { NextRequest, NextResponse } from "next/server";
import { readCredentials, registerUser, setSessionCookie } from "../../../../lib/auth";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  try {
    const body = await readCredentials(request);
    const session = await registerUser(body.username, body.password);
    const response = NextResponse.json({
      user: session.user,
      accessToken: session.token,
      expiresAt: session.expiresAt,
    }, { status: 201 });
    setSessionCookie(response, session.token);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "注册失败" },
      { status: 400 },
    );
  }
}
