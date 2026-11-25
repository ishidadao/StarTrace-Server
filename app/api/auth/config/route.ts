import { NextResponse } from "next/server";
import { isRegistrationEnabled } from "../../../../lib/auth";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json(
    { registrationEnabled: isRegistrationEnabled() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
