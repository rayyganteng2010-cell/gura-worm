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
  return normalizeIp(req.socket?.remoteAddress || req.ip || "");
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

  console.log("Auth check:", { name, ipClient, ipRequest });

  if (!name) return { ok: false, status: 401, reason: "LOGIN REQUIRED (NAMA KOSONG)" };
  
  // Untuk development/testing, boleh bypass IP check
  if (!ipClient && process.env.NODE_ENV === "development") {
    console.log("Development mode: bypassing IP check");
  } else if (!ipClient) {
    return { ok: false, status: 401, reason: "LOGIN REQUIRED (IP KOSONG)" };
  }

  // Jika ada IP client di body, validasi dengan IP request
  if (ipClient && ipRequest && ipRequest !== ipClient) {
    console.log(`IP mismatch: request=${ipRequest}, client=${ipClient}`);
    // Boleh bypass untuk testing
    if (process.env.NODE_ENV !== "development") {
      return { 
        ok: false, 
        status: 401, 
        reason: "AKSES DITOLAK (IP TIDAK SAMA)", 
        ip: ipRequest 
      };
    }
  }

  try {
    const db = await fetchDbFromGist();
    const users = Array.isArray(db.users) ? db.users : [];

    const match = users.find(
      (u) => normalizeName(u.name) === name && (!ipClient || normalizeIp(u.ip) === ipClient)
    );

    if (!match) {
      console.log(`User not found: ${name} with IP ${ipClient}`);
      console.log("Available users:", users.map(u => ({ name: u.name, ip: u.ip })));
      return { ok: false, status: 401, reason: "AKSES DITOLAK (NAMA/IP TIDAK COCOK)" };
    }

    console.log(`Auth successful for user: ${match.name}`);
    return { ok: true, user: match.name, ip: ipRequest || ipClient };
  } catch (error) {
    console.error("Auth error:", error);
    return { ok: false, status: 500, reason: "Gagal mengakses database" };
  }
}

/* ============================
   HIDDEN PROMPT
=============================== */
const HIDDEN_CONTEXT = `JULUKAN MU ADALAH RAY-GPT.`;

/* ============================
   DEEPSEEK STREAM (FIXED)
=============================== */
async function deepseekAI({ message, conversationId = null }) {
  if (!message) throw new Error("Message is required.");

  const convId = conversationId || Crypto.randomUUID();
  
  console.log("Calling DeepSeek API with convId:", convId);
  console.log("Message length:", message.length);

  try {
    const resp = await fetch("https://notegpt.io/api/v2/chat/stream", {
      method: "GET",
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

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error("DeepSeek API error:", resp.status, errorText);
      throw new Error(`DeepSeek API error: ${resp.status} - ${errorText}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let text = "";
    let reasoning = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        const payload = line.replace("data:", "").trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload);
          if (parsed.text) text += parsed.text;
          if (parsed.reasoning) reasoning += parsed.reasoning;
        } catch (e) {
          console.warn("Failed to parse chunk:", payload);
        }
      }
    }

    // Decode any remaining data
    const finalChunk = decoder.decode();
    if (finalChunk) {
      const lines = finalChunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const payload = line.replace("data:", "").trim();
          if (payload && payload !== "[DONE]") {
            try {
              const parsed = JSON.parse(payload);
              if (parsed.text) text += parsed.text;
              if (parsed.reasoning) reasoning += parsed.reasoning;
            } catch {}
          }
        }
      }
    }

    console.log("DeepSeek response received. Text length:", text.length);

    return {
      text: text.trim() || "Tidak ada respon dari AI",
      reasoning: reasoning.trim() || null,
      conversationId: convId,
    };
  } catch (error) {
    console.error("DeepSeek API call failed:", error);
    throw error;
  }
}

/* ============================
   CORS HEADER (FIX for frontend)
=============================== */
const BASE_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/* ============================
   VERCEL HANDLER (MAIN)
=============================== */
export default async function handler(req) {
  // Handle OPTIONS for CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: BASE_HEADERS,
    });
  }

  try {
    if (req.method !== " POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }), 
        {
          status: 405,
          headers: BASE_HEADERS,
        }
      );
    }

    // Parse request body
    let body;
    try {
      body = await req.json();
      console.log("Request body received:", { 
        name: body?.name, 
        message: body?.message ? `${body.message.substring(0, 50)}...` : 'empty',
        conversationId: body?.conversationId 
      });
    } catch (parseError) {
      console.error("Failed to parse JSON:", parseError);
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        {
          status: 400,
          headers: BASE_HEADERS,
        }
      );
    }

    // Verify authentication
    const gate = await verifyGate(req, body);
    if (!gate.ok) {
      console.log("Auth failed:", gate.reason);
      return new Response(
        JSON.stringify({ 
          error: gate.reason, 
          ip: gate.ip || null,
          debug: process.env.NODE_ENV === "development" ? gate : undefined
        }),
        {
          status: gate.status || 401,
          headers: BASE_HEADERS,
        }
      );
    }

    // Validate message
    const { message, conversationId } = body;
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Message tidak boleh kosong" }),
        {
          status: 400,
          headers: BASE_HEADERS,
        }
      );
    }

    console.log("Processing message for user:", gate.user);

    // Prepare full prompt
    const fullPrompt = `${HIDDEN_CONTEXT}\n\nPERTANYAAN WARGA : [${message.trim()}]`;
    
    // Call DeepSeek API
    const result = await deepseekAI({ 
      message: fullPrompt, 
      conversationId 
    });

    console.log("AI response generated, length:", result.text.length);

    return new Response(
      JSON.stringify({
        text: result.text,
        reasoning: result.reasoning,
        conversationId: result.conversationId,
        timestamp: new Date().toISOString(),
      }),
      { 
        status: 200, 
        headers: BASE_HEADERS 
      }
    );
  } catch (error) {
    console.error("Handler error:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message || "Internal server error",
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      }),
      {
        status: 500,
        headers: BASE_HEADERS,
      }
    );
  }
}
