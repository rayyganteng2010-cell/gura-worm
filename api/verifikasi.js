export const config = { runtime: "nodejs" };

const GIST_ID = process.env.GIST_ID || "04d2d40f0be0a14315de1839c3dd19ec";
const GIST_FILE = process.env.GIST_FILE || "manage_worm_db.json";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ""; // opsional

function normalizeName(s) {
  return String(s || "").trim().toLowerCase();
}

function normalizeIp(ip) {
  let x = String(ip || "").trim();
  if (x.startsWith("::ffff:")) x = x.replace("::ffff:", "");
  return x;
}

function getClientIpFromReq(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return normalizeIp(String(xff).split(",")[0].trim());
  return normalizeIp(req.socket?.remoteAddress || "");
}

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
  if (!file) throw new Error(`File ${GIST_FILE} tidak ada di Gist`);

  return JSON.parse(file.content);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, reason: "Method not allowed" });
    }

    const body = req.body || {};
    const name = normalizeName(body.name);
    const ipFromClient = normalizeIp(body.ip);

    if (!name) return res.status(400).json({ ok: false, reason: "Nama kosong" });
    if (!ipFromClient) return res.status(400).json({ ok: false, reason: "IP (ipify) kosong" });

    // IP yang server lihat dari request user (anti spoof)
    const ipFromReq = getClientIpFromReq(req);

    // Kalau Vercel kasih IP request, wajib match sama ipify
    // (kalau gak match = dianggap spoof / proxy mismatch)
    if (ipFromReq && ipFromReq !== ipFromClient) {
      return res.status(401).json({
        ok: false,
        reason: "GAGAL LOGIN (IP TIDAK SAMA DENGAN SERVER)",
        ip: ipFromReq,
      });
    }

    const db = await fetchDbFromGist();
    const users = Array.isArray(db.users) ? db.users : [];

    const match = users.find(
      (u) => normalizeName(u.name) === name && normalizeIp(u.ip) === ipFromClient
    );

    if (!match) {
      return res.status(401).json({
        ok: false,
        reason: "GAGAL LOGIN (NAMA/IP TIDAK COCOK)",
        ip: ipFromReq || ipFromClient,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "LOGIN BERHASIL",
      user: match.name,
      ip: ipFromReq || ipFromClient,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: e?.message || "Server error" });
  }
}
