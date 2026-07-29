import { NextRequest, NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const origin = req.nextUrl.origin;
  if (code) {
    const supabase = createUserClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${origin}/dashboard`);
}
