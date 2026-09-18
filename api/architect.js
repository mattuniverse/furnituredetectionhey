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

function parseBody(raw) {
  if (raw == null || raw === "" || raw === "{}") return {};
  if (typeof raw === "object" && !Array.isArray(raw) && !Buffer.isBuffer(raw)) return raw;
  const str = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  return JSON.parse(str);
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL_NAME = process.env.MODEL_NAME || "claude-haiku-4-5-20251001";
const MAX_TOKENS = 600;

const SYSTEM_PROMPT =
  "You are a friendly AI architect assistant that can control furniture directly on the user's floorplan canvas. " +
  "Whenever the user asks you to move, place, rotate, remove, or rearrange furniture, respond with ONLY a JSON object and no other text. " +
  'The JSON must match {"message": "...", "actions": [...]}. ' +
  '"message" is a short, friendly explanation of what you changed and why (reference an ergonomic/design principle). ' +
  'Each entry in "actions" is one of: ' +
  '{"action":"move","furnitureId":"<id>","x":<meters>,"y":<meters>} — move a piece; x and y are both optional so you can report just the axis you change. ' +
  '{"action":"rotate","furnitureId":"<id>","degrees":<0-359>} — rotate a piece clockwise in degrees. ' +
  '{"action":"remove","furnitureId":"<id>"} — delete a piece from the canvas. ' +
  '{"action":"add","defId":"<defId>","x":<meters>,"y":<meters>,"rot":<0-359>,"roomId":"<roomId>"} — add a new piece; only use defId values from the furniture library listed in the floorplan state, and only to a roomId that exists. ' +
  "Always copy the exact id and roomId strings shown in the floorplan state \u2014 never invent or repurpose ids. " +
  "Coordinates are meters measured from that room's top-left corner; the room dimensions are provided in the state. " +
  'If the user only asks for advice or a question (no on-canvas change needed), return {"message":"...","actions":[]}. ' +
  "Keep the message under ~3 sentences.";

function extractActions(rawReply) {
  const text = String(rawReply || "").trim();
  if (!text) return { reply: "", actions: [] };
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let obj = null;
  if (fence) {
    try { obj = JSON.parse(fence[1].trim()); } catch (e) { obj = null; }
  }
  if (!obj) {
    const start = text.indexOf("{");
    if (start > -1) {
      try { obj = JSON.parse(text.slice(start)); } catch (e) { obj = null; }
    }
  }
  if (!obj) {
    try { obj = JSON.parse(text); } catch (e) { obj = null; }
  }
  if (obj && typeof obj === "object") {
    const message = typeof obj.message === "string" ? obj.message.trim() : "";
    const actions = Array.isArray(obj.actions) ? obj.actions : [];
    return { reply: message || "Got it.", actions };
  }
  return { reply: rawReply, actions: [] };
}

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
    body = parseBody(req.body);
  } catch (err) {
    console.error("[architect] invalid JSON body:", typeof req.body, String(req.body || "").slice(0, 200));
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  console.log("[architect] ok body, message length:", message.length, "| history:", (body.history || []).length, "| key set:", !!process.env.ANTHROPIC_API_KEY);
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const raw = await askClaude(message, body.history, body.context);
    const { reply, actions } = extractActions(raw);
    console.log("[architect] replied, actions:", Array.isArray(actions) ? actions.length : 0);
    res.status(200).json({ reply, actions });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Architect request failed" });
  }
}