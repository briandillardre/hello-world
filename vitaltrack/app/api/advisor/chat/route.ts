// AI advisor: Claude with the user's FULL context (wearables + record +
// labs) and wellness guardrails on every output. Demo mode / missing API
// key returns a canned reply so the product works with zero env vars.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getUserId } from "@/lib/supabase-server";
import { buildUserContext } from "@/lib/context";
import {
  advisorSystemPrompt,
  applyGuardrails,
  DEMO_ADVISOR_REPLY,
  DISCLAIMER,
} from "@/lib/guardrails";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let messages: ChatMessage[];
  try {
    const body = await req.json();
    messages = (body.messages as ChatMessage[]) ?? [];
    if (!Array.isArray(messages) || !messages.length) throw new Error();
    messages = messages.slice(-20).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content).slice(0, 8000),
    }));
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      reply: DEMO_ADVISOR_REPLY + DISCLAIMER,
      demo: true,
    });
  }

  try {
    const context = await buildUserContext(userId);
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: advisorSystemPrompt(context),
      messages,
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return NextResponse.json({ reply: applyGuardrails(text) });
  } catch (err) {
    console.error("advisor error", err);
    return NextResponse.json(
      { error: "advisor unavailable, try again" },
      { status: 502 }
    );
  }
}
