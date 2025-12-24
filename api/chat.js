export const config = { runtime: "nodejs" };

function dataUrlToInlineData(dataUrl) {
  // data:image/png;base64,AAA...
  const m = /^data:(.*?);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
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

  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error?.message || `Gemini error ${resp.status}`);

  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text)
      .filter(Boolean)
      .join("\n") || "";

  return text.trim();
}

async function geminiGenerateImage({ apiKey, prompt }) {
  // Native image generation model (Nano Banana) via generateContent 2
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
      // beberapa implementasi gak wajib, tapi aman kalau lu mau output IMAGE:
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  });

  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error?.message || `Gemini image error ${resp.status}`);

  const parts = json?.candidates?.[0]?.content?.parts || [];

  // cari inline_data image (base64)
  const imgPart = parts.find((p) => p?.inline_data?.data);
  const txtPart = parts.find((p) => p?.text);

  const text = txtPart?.text?.trim() || "Selesai, ini hasil gambarnya.";
  if (!imgPart) {
    // kalau model/akses lu belum support image output, kasih info jelas
    throw new Error("Model tidak mengembalikan gambar. Pastikan pakai 'gemini-2.5-flash-image' atau akses image generation aktif.");
  }

  const mime = imgPart.inline_data.mimeType || "image/png";
  const b64 = imgPart.inline_data.data;

  return {
    text,
    imageDataUrl: `data:${mime};base64,${b64}`,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY env var" });

    const { message, image } = req.body || {};
    const msg = typeof message === "string" ? message.trim() : "";
    const imageDataUrl = typeof image === "string" && image.startsWith("data:image/")
      ? image
      : null;

    // command generate image
    if (msg.toLowerCase().startsWith("/img")) {
      const prompt = msg.replace(/^\/img\s*/i, "").trim();
      if (!prompt) return res.status(400).json({ error: "Prompt kosong. Contoh: /img kucing cyber merah neon" });

      const out = await geminiGenerateImage({ apiKey, prompt });
      return res.status(200).json({ text: out.text, image: out.imageDataUrl });
    }

    // normal chat (text + optional vision)
    const systemHint = `
Kamu adalah Valkyz AI. Jawab santai tapi jelas.
Jika ada gambar, jelaskan isi gambar dan jawab pertanyaan user.
Jika user minta generate gambar, arahkan pakai: /img <prompt>.
`.trim();

    const finalMessage = msg ? `${systemHint}\n\nUser: ${msg}` : systemHint;

    const text = await geminiGenerateTextOrVision({
      apiKey,
      message: finalMessage,
      imageDataUrl,
    });

    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
