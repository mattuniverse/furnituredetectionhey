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
//
// The assistant returns ONLY a JSON object of the form
//   {"message":"...","actions":[ ... ]}
// so the browser can apply furniture actions directly to the canvas. The raw
// Claude reply is passed back as `raw` (alongside `reply` and `actions`) so the
// client can log what the model actually produced during debugging.

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
const MAX_TOKENS = 900;

const sliceStr = (s, n) => String(s || "").slice(0, n || 250);

// Strict JSON-only contract. The model must reply with ONE JSON object and
// nothing else — no markdown code fences, no leading prose, no "Here is the
// JSON:" preamble. It should default to ACTING on the canvas (making sensible
// ergonomic assumptions) and ask at most ONE clarifying question.
const SYSTEM_PROMPT =
  "You are an AI architect assistant in a web app that lets you edit a floor plan canvas directly by controlling furniture. " +
  "Your output contract is STRICT: every reply must be exactly ONE JSON object and NOTHING else — " +
  "no markdown code fences, no ```json blocks, no text before or after the JSON, no bullet lists, no 'Here is the JSON:' prefixes, no quoting. " +
  "The very first character of your reply must be '{' and nothing may follow the closing '}'. Everything outside the JSON is discarded, so never send it.\n" +
  'The JSON must have exactly this shape: {"message":"...","actions":[...]}. "message" is a short (2-3 sentence), friendly explanation of what you did and why, referencing an ergonomic or design principle. ' +
  '"actions" is an array (possibly empty) of action objects:\n' +
  '  - move:  {"action":"move","furnitureId":"<exact id>","x":<meters>,"y":<meters>}  — x and y are optional; include only the axis you change.\n' +
  '  - rotate: {"action":"rotate","furnitureId":"<exact id>","degrees":<0-359>}  — clockwise in degrees.\n' +
  '  - remove: {"action":"remove","furnitureId":"<exact id>"}  — delete a piece.\n' +
  '  - add:   {"action":"add","defId":"<defId from library>","x":<meters>,"y":<meters>,"rot":<0-359>,"roomId":"<exact roomId>"}  — add a new piece; only use defId values from the furniture library and roomIds that exist.\n' +
  "Always copy id, roomId, and defId strings EXACTLY from the floorplan state below — never invent, guess, or repurpose ids. " +
  "Coordinates are meters measured from that room's top-left corner; room dimensions are provided in the state.\n" +
  "Prefer ACTING over asking. When the user gives enough context, make a sensible ergonomic placement decision and apply it immediately; if a detail is missing or ambiguous, make reasonable assumptions, briefly state them in \"message\", and proceed. " +
  "Ask AT MOST ONE clarifying question, and only when the request is impossible without it. " +
  'If the user only wants advice or information (no on-canvas change), return {"message":"...","actions":[]}.\n' +
  'Valid example (ids are placeholders — use the real ids from your state): ' +
  '{"message":"I moved the sofa to the opposite wall and rotated it 90\u00B0 for a better TV sight line, keeping a 90cm walkway to the door.","actions":[{"action":"move","furnitureId":"a1b2c3","x":0.4,"y":2.3},{"action":"rotate","furnitureId":"a1b2c3","degrees":90}]}';

function extractActions(rawReply) {
  const text = String(rawReply || "").trim();
  if (!text) return { reply: "", actions: [], raw: rawReply };

  // Try, in order: ```json fenced block, first "{..." onwards, whole text.
  let obj = null;
  const candidates = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  const start = text.indexOf("{");
  if (start > -1) candidates.push(text.slice(start));
  candidates.push(text);

  for (const c of candidates) {
    if (!c) continue;
    try { obj = JSON.parse(c); if (obj && typeof obj === "object" && !Array.isArray(obj)) break; }
    catch (e) { obj = null; }
  }

  if (obj && typeof obj === "object") {
    let actions = Array.isArray(obj.actions) ? obj.actions : [];
    if (!actions.length && obj.action && typeof obj.action === "string") actions = [obj];
    if (!actions.length && obj.actions && typeof obj.actions === "object" && !Array.isArray(obj.actions)) actions = [obj.actions];
    actions = actions.filter((a) => a && typeof a === "object");
    const message =
      typeof obj.message === "string" && obj.message.trim()
        ? obj.message.trim()
        : typeof obj.reply === "string" && obj.reply.trim()
          ? obj.reply.trim()
          : "Got it.";
    console.log(`[architect] parse OK -> actions: ${actions.length}, message: ${sliceStr(message, 120)}`);
    return { reply: message, actions, raw: rawReply };
  }

  console.warn(`[architect] Claude reply was NOT JSON: ${sliceStr(text, 300)}`);
  return { reply: rawReply, actions: [], raw: rawReply };
}

function cleanTurns(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-12)
    .map((t) => ({ role: t.role, content: t.content }));
}

// Reinforces the JSON-only contract right next to the live request, where
// model compliance is strongest. Not persisted in chat history.
const OUTPUT_REMINDER =
  "\n\nRemember: reply with ONLY a single JSON object of the form {\"message\":\"...\",\"actions\":[...]} — no markdown, no code fences, no prose before or after. The first character must be '{'.";

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
    { role: "user", content: `${ctxBlock}${message}${OUTPUT_REMINDER}` },
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
    const { reply, actions, raw: passthrough } = extractActions(raw);
    console.log("[architect] replied, actions:", Array.isArray(actions) ? actions.length : 0);
    res.status(200).json({ reply, actions, raw: passthrough });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Architect request failed" });
  }
}