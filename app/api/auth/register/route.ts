import { NextRequest, NextResponse } from "next/server";
import {
  isRegistrationEnabled,
  readCredentials,
  registerUser,
  setSessionCookie,
} from "../../../../lib/auth";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  if (!isRegistrationEnabled()) {
    // Finish small uploads before responding: the local Workers proxy can
    // otherwise abort forwarding an early response while its body is in flight.
    const reader = request.body?.getReader();
    if (reader) {
      try {
        let bytes = 0;
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 4096) {
            await reader.cancel();
            break;
          }
        }
      } catch {
        // Registration stays closed even when the upload is interrupted.
      } finally {
        reader.releaseLock();
      }
    }
    return NextResponse.json(
      { error: "注册未开放" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

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
