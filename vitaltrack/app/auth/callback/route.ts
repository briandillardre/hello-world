import { NextRequest, NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const origin = req.nextUrl.origin;
  if (!code)
    return NextResponse.redirect(`${origin}/login?error=missing%20code`);
  const supabase = createUserClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error)
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    );
  return NextResponse.redirect(`${origin}/dashboard`);
}
