import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = performance.now();

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("series")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[Supabase health check] Query failed.", {
        code: error.code,
        message: error.message,
        details: error.details,
      });

      return NextResponse.json(
        { ok: false, message: "Supabase query failed." },
        { status: 500 },
      );
    }

    console.info("[Supabase health check] Connection succeeded.", {
      recordFound: data !== null,
      durationMs: Math.round(performance.now() - startedAt),
    });

    // The record itself stays in the server process and is never returned.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Supabase health check] Connection failed.", error);

    return NextResponse.json(
      { ok: false, message: "Supabase connection failed." },
      { status: 500 },
    );
  }
}
