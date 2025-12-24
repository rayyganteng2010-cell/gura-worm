// api/chat.js
function dataUrlToInlineData(dataUrl) {
  const m = /^data:(.*?);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

async function geminiGenerateTextOrVision({ apiKey, message, imageDataUrl }) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const parts = [];
  if (message) parts.push({ text: message });

  if (imageDataUrl) {
    const inline = dataUrlToInlineData(imageDataUrl);
    if (inline) parts.push({ inline_data: inline });
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
    }),
  });

  const bodyText = await resp.text();
  let json = {};
  try { json = JSON.parse(bodyText); } catch {}

  if (!resp.ok) {
    throw new Error(json?.error?.message || `Gemini error ${resp.status}: ${bodyText.slice(0, 200)}`);
  }

  const out =
    json?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join("\n") || "";

  return out.trim();
}

async function geminiGenerateImage({ apiKey, prompt }) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
  });

  const bodyText = await resp.text();
  let json = {};
  try { json = JSON.parse(bodyText); } catch {}

  if (!resp.ok) {
    throw new Error(json?.error?.message || `Gemini image error ${resp.status}: ${bodyText.slice(0, 200)}`);
  }

  const parts = json?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p?.inline_data?.data);
  const txtPart = parts.find((p) => p?.text);

  const text = (txtPart?.text || "Selesai.").trim();
  if (!imgPart) throw new Error("Model tidak mengembalikan gambar. Akses image generation belum aktif.");

  const mime = imgPart.inline_data.mimeType || "image/png";
  const b64 = imgPart.inline_data.data;
  return { text, imageDataUrl: `data:${mime};base64,${b64}` };
}

async function fetchMagicStudioImage(prompt) {
  const url = `https://api.elrayyxml.web.id/api/ai/magicstudio?prompt=${encodeURIComponent(prompt)}`;
  const resp = await fetch(url);

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`MagicStudio error ${resp.status}: ${t.slice(0, 200)}`);
  }

  const contentType = resp.headers.get("content-type") || "image/png";
  if (!contentType.startsWith("image/")) {
    const t = await resp.text();
    throw new Error(`MagicStudio bukan image. CT=${contentType}. Body=${t.slice(0, 200)}`);
  }

  const ab = await resp.arrayBuffer();
  const b64 = Buffer.from(ab).toString("base64");
  return `data:${contentType};base64,${b64}`;
}

async function fetchPinterestGallery(q) {
  const url = `https://api-faa.my.id/faa/pinterest?q=${encodeURIComponent(q)}`;
  const resp = await fetch(url);

  const bodyText = await resp.text();
  let json = {};
  try { json = JSON.parse(bodyText); } catch {}

  if (!resp.ok) throw new Error(`Pinterest error ${resp.status}: ${bodyText.slice(0, 200)}`);
  if (!json?.status || !Array.isArray(json?.result)) throw new Error(`Pinterest format invalid: ${bodyText.slice(0, 200)}`);
  if (json.result.length === 0) throw new Error("Tidak ada hasil foto.");

  return json.result;
}

async function handler(req, res) {
  try {
    // TEST endpoint
    if (req.method === "GET") return res.status(200).json({ ok: true, route: "/api/chat" });
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY env var" });

    const body = await readJsonBody(req);
    const msg = typeof body.message === "string" ? body.message.trim() : "";
    const imageDataUrl =
      typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;

    // /foto -> gallery
    if (msg.toLowerCase().startsWith("/foto")) {
      const q = msg.replace(/^\/foto\s*/i, "").trim();
      if (!q) return res.status(400).json({ error: "Query kosong. Contoh: /foto davina karamoy" });

      const urls = await fetchPinterestGallery(q);
      return res.status(200).json({ text: `Hasil foto untuk: "${q}"`, gallery: urls });
    }

    // /image -> MagicStudio
    if (msg.toLowerCase().startsWith("/image")) {
      const prompt = msg.replace(/^\/image\s*/i, "").trim();
      if (!prompt) return res.status(400).json({ error: "Prompt kosong. Contoh: /image mobil harimau" });

      const img = await fetchMagicStudioImage(prompt);
      return res.status(200).json({ text: `Hasil image (MagicStudio) untuk: "${prompt}"`, image: img });
    }

    // /img -> Gemini image
    if (msg.toLowerCase().startsWith("/img")) {
      const prompt = msg.replace(/^\/img\s*/i, "").trim();
      if (!prompt) return res.status(400).json({ error: "Prompt kosong. Contoh: /img kucing cyber merah neon" });

      const out = await geminiGenerateImage({ apiKey, prompt });
      return res.status(200).json({ text: out.text, image: out.imageDataUrl });
    }

    // normal chat + optional vision
    const systemHint = `
Kamu adalah Valkyz AI gaya terminal.
Jawab santai tapi jelas.
Kalau mengirim kode: WAJIB bungkus pakai triple backticks (```).
Jika user mengirim gambar, jelaskan isi gambar dan jawab pertanyaannya.
Command:
- /foto <query>
- /img <prompt> (Gemini image)
- /image <prompt> (MagicStudio)
`.trim();

    const finalMessage = msg ? `${systemHint}\n\nUser: ${msg}` : systemHint;
    const outText = await geminiGenerateTextOrVision({ apiKey, message: finalMessage, imageDataUrl });

    return res.status(200).json({ text: outText });
  } catch (err) {
    console.error("API CRASH:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}

// ✅ IMPORTANT: export handler dulu, baru tempelin config (biar gak ke-overwrite)
module.exports = handler;
module.exports.config = { runtime: "nodejs" };
