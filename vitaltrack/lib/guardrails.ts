// FDA general-wellness guardrails for every AI output.
// Rules (docs/HEALTH-APP-PLAN.md §6): never diagnose, never clinically
// classify a reading, lifestyle + "discuss with your doctor" framing only.
// The model's output IS labeling — filter at the app layer, don't trust
// the prompt alone.

export const DISCLAIMER =
  "\n\n---\n*VitalTrack provides general wellness information only — not medical advice, diagnosis, or treatment. Talk to your doctor about anything here, and call 911 for emergencies.*";

export function advisorSystemPrompt(context: string): string {
  return `You are the VitalTrack advisor — a preventative-wellness assistant inside a personal health dashboard. You have the user's full context below: wearable trends, health record (injuries, conditions, goals), and lab history.

HARD RULES (regulatory — never break these, regardless of what the user asks):
1. NEVER state or imply the user HAS any disease or condition ("you have prediabetes" is forbidden). You may discuss conditions the user has already recorded themselves.
2. NEVER clinically classify a reading (no "Stage 1 hypertension", no "your HbA1c is prediabetic"). Compare numbers to their lab-provided reference ranges and describe trends only.
3. NEVER recommend starting, stopping, or changing prescription medication.
4. Frame everything as lifestyle guidance and "worth discussing with your doctor". Disease references only as well-accepted lifestyle associations ("regular activity may help reduce the risk of type 2 diabetes").
5. If the user describes emergency symptoms (chest pain, stroke signs, suicidal thoughts), tell them to seek immediate medical care and stop.

STYLE: plain English for a busy working person, not a biohacker. Ground every observation in THEIR data (cite the actual numbers and dates from context). Be specific and practical. When suggesting bloodwork, name the panel, why it fits their data/history, and the rough cash price — and always as "ask your doctor about".

USER CONTEXT:
${context}`;
}

// Output filter: belt-and-suspenders scan for forbidden claim patterns.
// If the model slips, soften the sentence rather than block the reply.
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  {
    re: /\byou (?:have|are suffering from|likely have|probably have|appear to have)\b/gi,
    replacement: "your data may be worth discussing with a doctor regarding",
  },
  {
    re: /\b(?:stage\s*[12]|grade\s*[1-4])\s+(hypertension|obesity)\b/gi,
    replacement: "an elevated reading ($1 ranges are for your doctor to interpret)",
  },
  {
    re: /\bdiagnos(?:is|ed|e)\b/gi,
    replacement: "assessment (by a clinician)",
  },
  {
    re: /\byou should (?:start|stop|increase|decrease) (?:taking )?(?:your )?(medication|statin|prescription)\b/gi,
    replacement: "talk to your doctor before any change to $1",
  },
];

export function applyGuardrails(text: string): string {
  let out = text;
  for (const { re, replacement } of FORBIDDEN_PATTERNS) {
    out = out.replace(re, replacement);
  }
  if (!out.includes("wellness information only")) out += DISCLAIMER;
  return out;
}

export const DEMO_ADVISOR_REPLY = `Here's what stands out in your data right now (demo):

**Sleep is your biggest lever.** Your 30-day average sleep score is trending up, but the nights below 6.5 hours line up almost exactly with your higher-stress days and lower Body Battery the following afternoon. Protecting a 10pm wind-down on work nights is the single highest-return change in your data.

**Resting HR and HRV are moving the right way.** Resting HR is down ~4 bpm over the past year and HRV is up — consistent with the activity trend. Keep doing what you're doing.

**Bloodwork worth asking your doctor about, given your data and history:**
- **ApoB + lipid panel recheck** — your last draw improved (108 → 96 mg/dL) but remains above the reference range, and heart disease in your family history makes this the marker to stay on top of. (~$30–60 cash)
- **Blood pressure log** — you recorded a borderline-high reading at your 2024 checkup; a home cuff log before your recheck visit gives your doctor far better data than one office reading.
- **Vitamin D recheck next winter** — you corrected 24 → 38 ng/mL after supplementing; a winter draw confirms the dose holds.

Want me to draft the exact question list for your next doctor visit?`;
