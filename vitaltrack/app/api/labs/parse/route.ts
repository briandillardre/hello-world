// Lab PDF upload → Claude document parsing → biomarker rows.
// BYO-labs is the zero-partnership MVP: user uploads any Quest/Labcorp/
// hospital PDF; we extract structured biomarkers and store them.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getUserId, createUserClient } from "@/lib/supabase-server";
import { isMock } from "@/lib/supabase";
import type { ParsedLab } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const MAX_PDF_BYTES = 15 * 1024 * 1024;

const PARSE_TOOL: Anthropic.Tool = {
  name: "record_lab_results",
  description: "Record the structured biomarkers extracted from a lab report",
  input_schema: {
    type: "object" as const,
    properties: {
      source_lab: { type: "string", description: "Lab name, e.g. Quest Diagnostics" },
      collected_at: { type: "string", description: "Specimen collection date YYYY-MM-DD" },
      biomarkers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            loinc: { type: ["string", "null"] },
            value: { type: "number" },
            unit: { type: ["string", "null"] },
            ref_low: { type: ["number", "null"] },
            ref_high: { type: ["number", "null"] },
          },
          required: ["name", "value"],
        },
      },
    },
    required: ["biomarkers"],
  },
};

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json(
      { error: "Lab parsing needs ANTHROPIC_API_KEY set" },
      { status: 503 }
    );

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".pdf"))
    return NextResponse.json({ error: "upload a PDF" }, { status: 400 });
  if (file.size > MAX_PDF_BYTES)
    return NextResponse.json({ error: "PDF too large (15MB max)" }, { status: 400 });

  const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  let parsed: ParsedLab;
  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      tools: [PARSE_TOOL],
      tool_choice: { type: "tool", name: "record_lab_results" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: b64 },
            },
            {
              type: "text",
              text: "Extract every quantitative biomarker from this lab report: analyte name, numeric value, unit, reference range low/high (null when absent), LOINC code if printed. Also the lab name and specimen collection date. Skip qualitative results.",
            },
          ],
        },
      ],
    });
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) throw new Error("no tool output");
    const input = toolUse.input as Record<string, unknown>;
    parsed = {
      source_lab: typeof input.source_lab === "string" ? input.source_lab : null,
      collected_at:
        typeof input.collected_at === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(input.collected_at)
          ? input.collected_at
          : null,
      biomarkers: (Array.isArray(input.biomarkers) ? input.biomarkers : [])
        .filter(
          (b): b is Record<string, unknown> =>
            !!b && typeof b === "object" && typeof (b as Record<string, unknown>).name === "string" &&
            typeof (b as Record<string, unknown>).value === "number"
        )
        .map((b) => ({
          name: String(b.name).slice(0, 120),
          loinc: typeof b.loinc === "string" ? b.loinc : null,
          value: b.value as number,
          unit: typeof b.unit === "string" ? b.unit : null,
          ref_low: typeof b.ref_low === "number" ? b.ref_low : null,
          ref_high: typeof b.ref_high === "number" ? b.ref_high : null,
        })),
    };
  } catch (err) {
    console.error("lab parse error", err);
    return NextResponse.json({ error: "could not parse PDF" }, { status: 502 });
  }

  if (!parsed.biomarkers.length)
    return NextResponse.json(
      { error: "no biomarkers found in this PDF" },
      { status: 422 }
    );

  // Demo mode: return the parse so the UI can show it, but nothing persists.
  if (isMock) return NextResponse.json({ ok: true, demo: true, parsed });

  const supabase = createUserClient();
  const { data: report, error: reportError } = await supabase
    .from("lab_reports")
    .insert({
      user_id: userId,
      source_lab: parsed.source_lab,
      collected_at: parsed.collected_at,
      parsed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (reportError || !report)
    return NextResponse.json(
      { error: reportError?.message ?? "insert failed" },
      { status: 500 }
    );

  const { error: bioError } = await supabase.from("biomarkers").insert(
    parsed.biomarkers.map((b) => ({
      ...b,
      report_id: report.id,
      user_id: userId,
      collected_at: parsed.collected_at,
    }))
  );
  if (bioError)
    return NextResponse.json({ error: bioError.message }, { status: 500 });

  await supabase.from("events").insert({
    user_id: userId,
    ts: parsed.collected_at
      ? `${parsed.collected_at}T09:00:00Z`
      : new Date().toISOString(),
    kind: "lab_draw",
    title: `Bloodwork — ${parsed.source_lab ?? "lab report"}`,
    detail: `${parsed.biomarkers.length} markers parsed from upload`,
  });

  return NextResponse.json({ ok: true, parsed, report_id: report.id });
}
