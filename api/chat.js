// api/chat.js — 100% Vercel Compatible (Node 18+ Runtime)

/* ============================
   IMPORTS (ESM)
=============================== */
import Crypto from "crypto";

/* ============================
   CONFIG GATE
=============================== */
const GIST_ID = process.env.GIST_ID || "04d2d40f0be0a14315de1839c3dd19ec";
const GIST_FILE = process.env.GIST_FILE || "manage_worm_db.json";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

/* Normalize */
function normalizeName(s) {
  return String(s || "").trim().toLowerCase();
}
function normalizeIp(ip) {
  let x = String(ip || "").trim();
  if (x.startsWith("::ffff:")) x = x.replace("::ffff:", "");
  return x;
}

/* FIXED: Vercel Node Runtime doesn't use req.headers.get() */
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return normalizeIp(xff.split(",")[0].trim());
  return normalizeIp(req.ip || "");
}

/* ============================
   LOAD DB FROM GIST
=============================== */
async function fetchDbFromGist() {
  const url = `https://api.github.com/gists/${GIST_ID}?v=${Date.now()}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "rayy-worm-auth",
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const r = await fetch(url, { headers, cache: "no-store" });
  if (!r.ok) throw new Error(`GitHub API error: ${r.status}`);

  const gist = await r.json();
  const file = gist.files?.[GIST_FILE];
  if (!file) throw new Error(`File ${GIST_FILE} tidak ditemukan`);

  return JSON.parse(file.content);
}

/* ============================
   AUTH GATE
=============================== */
async function verifyGate(req, body) {
  const name = normalizeName(body?.name);
  const ipClient = normalizeIp(body?.ip);
  const ipRequest = getClientIp(req);

  if (!name) return { ok: false, status: 401, reason: "LOGIN REQUIRED (NAMA KOSONG)" };
  if (!ipClient) return { ok: false, status: 401, reason: "LOGIN REQUIRED (IP KOSONG)" };

  if (ipRequest && ipRequest !== ipClient)
    return { ok: false, status: 401, reason: "AKSES DITOLAK (IP TIDAK SAMA)", ip: ipRequest };

  const db = await fetchDbFromGist();
  const users = Array.isArray(db.users) ? db.users : [];

  const match = users.find(
    (u) => normalizeName(u.name) === name && normalizeIp(u.ip) === ipClient
  );

  if (!match)
    return { ok: false, status: 401, reason: "AKSES DITOLAK (NAMA/IP TIDAK COCOK)" };

  return { ok: true, user: match.name, ip: ipRequest };
}

/* ============================
   HIDDEN PROMPT
=============================== */
const HIDDEN_CONTEXT = `
JULUKAN MU ADALAH RAY-GPT.
`;

/* ============================
   DEEPSEEK STREAM (VERCEL SAFE)
=============================== */
async function deepseekAI({ message, conversationId = null }) {
  if (!message) throw new Error("Message is required.");

  const convId = conversationId || Crypto.randomUUID();

  const resp = await fetch("https://notegpt.io/api/v2/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "ray-vercel-client",
    },
    body: JSON.stringify({
      message,
      language: "id",
      model: "deepseek-reasoner",
      tone: "default",
      length: "moderate",
      conversation_id: convId,
    }),
  });

  if (!resp.ok) throw new Error("DeepSeek API error: " + resp.status);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();

  let text = "";
  let reasoning = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;

      const payload = line.replace("data:", "").trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.text) text += parsed.text;
        if (parsed.reasoning) reasoning += parsed.reasoning;
      } catch {}
    }
  }

  return {
    text: text.trim(),
    reasoning: reasoning.trim() || null,
    conversationId: convId,
  };
}

/* ============================
   CORS HEADER (FIX for frontend)
=============================== */
const BASE_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

/* ============================
   VERCEL HANDLER (MAIN)
=============================== */
export default async function handler(req) {
  try {
    if (req.method !== "POST")
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: BASE_HEADERS,
      });

    const body = await req.json();

    const gate = await verifyGate(req, body);
    if (!gate.ok)
      return new Response(JSON.stringify({ error: gate.reason, ip: gate.ip || null }), {
        status: gate.status || 401,
        headers: BASE_HEADERS,
      });

    const { message, conversationId } = body;
    if (!message)
      return new Response(JSON.stringify({ error: "Message tidak boleh kosong" }), {
        status: 400,
        headers: BASE_HEADERS,
      });

    const fullPrompt = `
${HIDDEN_CONTEXT}

PERTANYAAN WARGA : [${message}]
    `.trim();

    const result = await deepseekAI({ message: fullPrompt, conversationId });

    return new Response(
      JSON.stringify({
        text: result.text,
        reasoning: result.reasoning,
        conversationId: result.conversationId,
        length: fullPrompt.length,
      }),
      { status: 200, headers: BASE_HEADERS }
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: BASE_HEADERS,
    });
  }
}
