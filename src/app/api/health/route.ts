import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// Same contract as the standalone backend's GET /health — used by Kubernetes
// probes and manual smoke tests. 200 only when the database answers.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pool.query("SELECT 1");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}
