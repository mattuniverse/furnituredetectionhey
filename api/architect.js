// /api/architect — conversational AI architect assistant (Claude Haiku)
//
// POST { message, history, context }
//  - message : the user's latest question ("Where should I put the bedroom?")
//  - history : previous turns [{role:"user"|"assistant", content}]
//  - context : string describing the current floorplan (rooms, sizes, types)
//
// Responses carry a friendly, conversational architect voice. The floorplan
// context is injected ahead of the latest user message so Claude speaks to the
// actual design on the canvas.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL_NAME = process.env.MODEL_NAME || "claude-haiku-4-5-20251001";
const MAX_TOKENS = 600;

const SYSTEM_PROMPT =
  "You are a friendly AI architect assistant helping a user design their floorplan. " +
  "Speak naturally and conversationally like a real architect giving advice. " +
  "Be concise but helpful. Use the floorplan context provided to give specific, relevant suggestions.";

function cleanTurns(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-12)
    .map((t) => ({ role: t.role, content: t.content }));
}

async function askClaude(message, history, context) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error("ANTHROPIC_API_KEY is not set");
    err.status = 500;
    throw err;
  }

  const turns = cleanTurns(history);
  const ctxBlock = context && context.trim()
    ? `Here is the current floorplan state:\n${context.trim()}\n\n`
    : "";
  const messages = [
    ...turns,
    { role: "user", content: `${ctxBlock}${message}` },
  ];

  let response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });
  } catch (err) {
    err.status = 502;
    err.message = err.message || "Request to Claude API failed";
    throw err;
  }

  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json()).error?.message || ""; } catch { /* ignore */ }
    const err = new Error(`Claude API error (${response.status}): ${detail}`);
    err.status = 502;
    throw err;
  }

  const messageData = await response.json();
  const reply = (messageData.content || []).map((c) => c.text || "").join("").trim();
  return reply;
}

export default async function handler(req, res) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = JSON.parse(req.body || "{}");
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const reply = await askClaude(message, body.history, body.context);
    res.status(200).json({ reply });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Architect request failed" });
  }
}