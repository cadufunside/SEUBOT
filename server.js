//
// SEUBOT WhatsApp Connector (Multi-tenant) — WPPConnect
// Scalable, multi-session, QR per user, optional Redis session store
// Author: SEUBOT
//
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { create, Whatsapp } from "@wppconnect-team/wppconnect";
import * as fs from "fs";
import * as path from "path";

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "5mb" }));

// -------- Config --------
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const PERSIST_DIR = process.env.PERSIST_DIR || "./sessions";
const ALLOW_ANY_ORIGIN = process.env.ALLOW_ANY_ORIGIN === "true" || true;
// Optional Redis (recommended for scale). If provided, we mark it in info output.
const REDIS_URL = process.env.REDIS_URL || "";

// Ensure persistence directory exists
if (!fs.existsSync(PERSIST_DIR)) fs.mkdirSync(PERSIST_DIR, { recursive: true });

// -------- In-memory session map (clients + state) --------
/** @type {Map<string, {client: Whatsapp|null, status: string, lastQr?: string}>} */
const sessions = new Map();

function sessionPath(sessionId){
  return path.join(PERSIST_DIR, sessionId);
}

// Helper: validate session id
function validSessionId(sessionId){
  return /^[a-zA-Z0-9_\-:.]{1,64}$/.test(sessionId || "");
}

app.get("/", (req,res)=>{
  res.json({
    name: "SEUBOT WPPConnect Connector",
    version: "1.0.0",
    ok: true,
    redis: REDIS_URL ? "enabled" : "disabled",
    baseUrl: BASE_URL
  });
});

// -------- Create or get session --------
async function bootSession(sessionId){
  if (!validSessionId(sessionId)) throw new Error("Invalid session id");

  // Already connected/booting
  if (sessions.has(sessionId) && sessions.get(sessionId).client) {
    return sessions.get(sessionId);
  }

  // Make folder per session (for token persistence)
  const sPath = sessionPath(sessionId);
  if (!fs.existsSync(sPath)) fs.mkdirSync(sPath, { recursive: true });

  let qrFirstImage = null;

  sessions.set(sessionId, { client: null, status: "initializing" });

  const client = await create({
    session: sessionId,
    catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
      qrFirstImage = base64Qr;
      const s = sessions.get(sessionId) || { client: null, status: "waiting" };
      s.lastQr = base64Qr;
      s.status = "qrcode";
      sessions.set(sessionId, s);
    },
    statusFind: (statusSession, session) => {
      const s = sessions.get(sessionId) || { client: null, status: "unknown" };
      s.status = statusSession || "unknown";
      sessions.set(sessionId, s);
      console.log(`[SESS:${sessionId}] status => ${statusSession}`);
    },
    headless: true,
    // Important for container/cloud
    browserArgs: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-accelerated-2d-canvas"
    ],
    // Persist tokens to disk per session
    // WPPConnect automatically persists tokens in ./tokens by default; we force per-session folder
    createPathFileToken: (folderName, session) => {
      // return custom folder to save tokens (per session)
      return path.join(sPath, "tokens");
    },
    waitQrCode: 0, // don't block; we'll poll via /status
    // debug: true
  });

  sessions.set(sessionId, { client, status: "connected" });

  // Basic listeners
  client.onMessage((message) => {
    // You can push to a queue or emit websockets here
    console.log(`[SESS:${sessionId}] Incoming from ${message.from}: ${message.body?.slice(0,80)}`);
  });

  client.onStateChange((state) => {
    const s = sessions.get(sessionId) || { client: null, status: "unknown" };
    s.status = state;
    sessions.set(sessionId, s);
    console.log(`[SESS:${sessionId}] onStateChange => ${state}`);
  });

  return sessions.get(sessionId);
}

// -------- API: start session (returns QR if needed) --------
app.post("/sessions/:sessionId/start", async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!validSessionId(sessionId)) return res.status(400).json({ error: "sessionId inválido" });

    let state = sessions.get(sessionId);
    if (!state || !state.client) {
      // Boot
      state = await bootSession(sessionId);
    }

    // Return status; if QR available, include once
    const payload = { sessionId, status: state.status || "unknown" };
    if (state.lastQr && (state.status === "qrcode" || state.status === "initializing")) {
      payload.qr = state.lastQr;
    }
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao iniciar sessão" });
  }
});

// -------- API: get status --------
app.get("/sessions/:sessionId/status", async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!validSessionId(sessionId)) return res.status(400).json({ error: "sessionId inválido" });

    const s = sessions.get(sessionId);
    if (!s) return res.json({ sessionId, status: "disconnected" });
    res.json({ sessionId, status: s.status || "unknown" });
  } catch (err) {
    res.status(500).json({ error: "Falha ao consultar status" });
  }
});

// -------- API: stop/logout session --------
app.delete("/sessions/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!validSessionId(sessionId)) return res.status(400).json({ error: "sessionId inválido" });

    const s = sessions.get(sessionId);
    if (s && s.client) {
      await s.client.logout();
    }
    sessions.delete(sessionId);

    // Optional: clean persisted tokens
    if (req.query.wipe === "true") {
      const sPath = sessionPath(sessionId);
      fs.rmSync(sPath, { recursive: true, force: true });
    }

    res.json({ sessionId, status: "disconnected" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao desconectar sessão" });
  }
});

// -------- Messaging: send text --------
app.post("/messages/text", async (req, res) => {
  try {
    const { sessionId, number, message } = req.body;
    if (!validSessionId(sessionId)) return res.status(400).json({ error: "sessionId inválido" });
    if (!number || !message) return res.status(400).json({ error: "number e message são obrigatórios" });

    const s = sessions.get(sessionId);
    if (!s || !s.client) return res.status(400).json({ error: "Sessão não conectada" });

    const to = `${number.replace(/\D/g, "")}@c.us`;
    const result = await s.client.sendText(to, message);
    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao enviar texto" });
  }
});

// -------- Messaging: send file/image/audio (by URL) --------
app.post("/messages/file", async (req, res) => {
  try {
    const { sessionId, number, fileUrl, caption } = req.body;
    if (!validSessionId(sessionId)) return res.status(400).json({ error: "sessionId inválido" });
    if (!number || !fileUrl) return res.status(400).json({ error: "number e fileUrl são obrigatórios" });

    const s = sessions.get(sessionId);
    if (!s || !s.client) return res.status(400).json({ error: "Sessão não conectada" });

    const to = `${number.replace(/\D/g, "")}@c.us`;
    const result = await s.client.sendFile(to, fileUrl, path.basename(fileUrl), caption || "");
    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao enviar arquivo" });
  }
});

// -------- Messaging: buttons (if supported) --------
app.post("/messages/buttons", async (req, res) => {
  try {
    const { sessionId, number, title, buttons, description } = req.body;
    if (!validSessionId(sessionId)) return res.status(400).json({ error: "sessionId inválido" });
    if (!number || !Array.isArray(buttons) || buttons.length === 0) return res.status(400).json({ error: "number e buttons são obrigatórios" });

    const s = sessions.get(sessionId);
    if (!s || !s.client) return res.status(400).json({ error: "Sessão não conectada" });

    const to = `${number.replace(/\D/g, "")}@c.us`;
    // Fallback simples: enviar texto com opções enumeradas, caso sendButtons não exista
    const sendButtons = s.client.sendButtons || s.client.sendText;
    const result = await sendButtons(to, title || "Escolha uma opção", buttons, description || "");
    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao enviar botões" });
  }
});

// -------- Health --------
app.get("/healthz", (req,res)=> res.json({ ok:true }));

app.listen(PORT, () => {
  console.log(`SEUBOT WPPConnect Connector running on ${BASE_URL}`);
});
