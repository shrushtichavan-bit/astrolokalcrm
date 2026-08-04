import { NextResponse } from "next/server";
import { intakeLead } from "@/lib/intake";

// Public lead-intake endpoint — replaces both the standalone backend service
// (backend/server.js) and the Supabase Edge Function. Google Forms Apps
// Scripts, Pabbly, and any other external system POST here. Status codes and
// body shapes match the Edge Function so existing callers keep working:
// 201 created, 409 duplicate blocked, 400 invalid, 500 unexpected.

export const dynamic = "force-dynamic";

// External posters are server-side (Apps Script, Pabbly), so CORS is mostly
// moot — headers kept anyway so a browser-based caller doesn't mysteriously
// fail where the Edge Function (which sent them) worked.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    // fall through with empty payload — intakeLead returns the 400
  }

  try {
    const result = await intakeLead(payload);
    if (result.kind === "invalid") {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400, headers: CORS_HEADERS });
    }
    if (result.kind === "blocked") {
      return NextResponse.json(
        { ok: false, blocked: true, reason: result.reason, matched_lead_id: result.matched_lead_id },
        { status: 409, headers: CORS_HEADERS },
      );
    }
    return NextResponse.json(
      { ok: true, status: "created", id: result.id, lead_id: result.lead_id },
      { status: 201, headers: CORS_HEADERS },
    );
  } catch (err) {
    console.error("intake-lead error:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
