// /api/detect-furniture — sends the room photo to the Anthropic Claude vision API
// (claude-haiku-4-5-20251001) for furniture/fixture detection. No ONNX backend involved.
// Response shape matches what the frontend scanFurniture() consumes
// ({ detections, predictions, imageWidth, imageHeight, unmappedClasses }),
// so no client changes are needed.

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
const MAX_TOKENS = 1024;

const VALID_FURNITURE_IDS = [
  "sofa_2", "sofa_3", "chair", "armchair", "table_rect", "table_round",
  "coffee", "desk", "tv", "bed_s", "bed_d", "bed_k", "cabinet", "wall_cab",
  "toilet", "sink", "bathtub", "plant", "shelf", "wardrobe", "door", "window",
  "rug", "wall",
];

const SYSTEM_PROMPT = `Detect all furniture items in this room image.
Return JSON only: array of objects with {label, confidence, bbox: {x,y,width,height}}.

Rules:
- (x, y) is the CENTER of each item's bounding box in pixels, on the imageWidth/imageHeight scale provided.
- Only report items you can actually see and localize; do not hallucinate typical room contents.
- Return valid JSON only: [{"label": "...", "confidence": 0.0, "bbox": {"x": 0, "y": 0, "width": 0, "height": 0}}]`;

function readJpegDims(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker >= 0xd0 && marker <= 0xd7) { i += 2; continue; }
    if (marker === 0x01) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function imageInfo(data) {
  const buf = Buffer.from(data, "base64");
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { mediaType: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const dims = readJpegDims(buf);
    if (dims) return { mediaType: "image/jpeg", ...dims };
  }
  if (
    buf.length > 10 &&
    (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a")
  ) {
    return { mediaType: "image/gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  const err = new Error("Unsupported image format (expected JPEG, PNG, or GIF)");
  err.status = 400;
  throw err;
}

function labelToFurnitureId(label) {
  const t = String(label || "").trim().toLowerCase();
  if (!t) return null;
  if (VALID_FURNITURE_IDS.includes(t)) return t;
  if (/window/.test(t)) return "window";
  if (/door/.test(t)) return "door";
  if (/wall\s*cab|wall_cab|cupboard/.test(t)) return "wall_cab";
  if (/wardrobe|closet/.test(t)) return "wardrobe";
  if (/wall/.test(t)) return "wall";
  if (/loveseat|sofa_2/.test(t)) return "sofa_2";
  if (/sofa|couch/.test(t)) return "sofa_3";
  if (/armchair/.test(t)) return "armchair";
  if (/coffee\s*table|coffee/.test(t)) return "coffee";
  if (/round\s*table|table_round/.test(t)) return "table_round";
  if (/desk/.test(t)) return "desk";
  if (/table/.test(t)) return "table_rect";
  if (/chair|stool/.test(t)) return "chair";
  if (/king/.test(t)) return "bed_k";
  if (/single|twin/.test(t)) return "bed_s";
  if (/bed/.test(t)) return "bed_d";
  if (/cabinet/.test(t)) return "cabinet";
  if (/shelf|bookcase/.test(t)) return "shelf";
  if (/sink/.test(t)) return "sink";
  if (/toilet|commode/.test(t)) return "toilet";
  if (/bathtub|bath\s*tub|shower/.test(t)) return "bathtub";
  if (/plant|potted/.test(t)) return "plant";
  if (/rug|carpet/.test(t)) return "rug";
  if (/tv|television/.test(t)) return "tv";
  return null;
}

function parseClaudeJson(raw) {
  let text = (raw || "").trim();
  if (text.startsWith("```")) {
    text = text.split("```")[1] || text;
    if (text.startsWith("json")) text = text.slice(4);
  }
  text = text.trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const err = new Error("Could not parse detection response.");
    err.status = 502;
    throw err;
  }
  if (Array.isArray(parsed)) return { detections: parsed, unmapped: [] };
  if (parsed && typeof parsed === "object") {
    return {
      detections: Array.isArray(parsed.detections) ? parsed.detections : [],
      unmapped: Array.isArray(parsed.unmappedClasses) ? parsed.unmappedClasses : [],
    };
  }
  return { detections: [], unmapped: [] };
}

function bboxOf(d) {
  const b = d && typeof d === "object" ? (d.bbox || d) : {};
  return {
    x: Number(b.x) || 0,
    y: Number(b.y) || 0,
    width: Number(b.width) || 0,
    height: Number(b.height) || 0,
  };
}

async function detectWithClaude(imageBase64) {
  const { mediaType, width, height } = imageInfo(imageBase64);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error("ANTHROPIC_API_KEY is not set");
    err.status = 500;
    throw err;
  }

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
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
              { type: "text", text: `imageWidth: ${width}\nimageHeight: ${height}\n\nDetect all furniture items in this room image and return the JSON array.` },
            ],
          },
        ],
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

  const message = await response.json();
  const raw = (message.content || []).map((c) => c.text || "").join("").trim();
  const { detections: detected, unmapped } = parseClaudeJson(raw);

  const unmappedClasses = [...unmapped];
  const cleaned = [];
  for (const d of detected) {
    if (!d || typeof d !== "object") continue;
    const label = (d.label || d.class || "").trim();
    const furnitureId = labelToFurnitureId(label || d.furnitureId);
    if (!furnitureId) {
      if (label && !unmappedClasses.includes(label)) unmappedClasses.push(label);
      continue;
    }
    const box = bboxOf(d);
    cleaned.push({
      furnitureId,
      class: label,
      confidence: typeof d.confidence === "number" ? d.confidence : 0.9,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });
  }

  return {
    detections: cleaned,
    predictions: cleaned.map((d) => ({
      class: d.class,
      confidence: d.confidence,
      x: d.x,
      y: d.y,
      width: d.width,
      height: d.height,
    })),
    imageWidth: width,
    imageHeight: height,
    unmappedClasses,
  };
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
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const { image } = body;
  if (!image || typeof image !== "string") {
    res.status(400).json({ error: "Missing image (base64 string)" });
    return;
  }

  try {
    const result = await detectWithClaude(image);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Detection failed" });
  }
}