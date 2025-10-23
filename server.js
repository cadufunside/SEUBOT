import express from "express";
import cors from "cors";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE", "OPTIONS"] }));

// memória simples: socket por sessão + último QR
const sessions = new Map();         // sessionId -> sock
const sessionState = new Map();     // sessionId -> { connected?:bool, qr?:string }

app.get("/", (_, res) => {
  res.json({ name: "SEUBOT Baileys Connector", ok: true, version: "1.0.0" });
});

// Iniciar sessão (gera QR e conecta)
app.post("/api/sessions/:sessionId/start", async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (sessions.has(sessionId)) {
      return res.json({ ok: true, status: "ALREADY_RUNNING", sessionId });
    }

    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionId}`);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false, // QR iremos expor via API
      browser: ["SEUBOT", "Chrome", "1.0.0"]
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        sessionState.set(sessionId, { ...sessionState.get(sessionId), qr });
      }

      if (connection === "open") {
        sessionState.set(sessionId, { connected: true });
        console.log(`✅ Conectado: ${sessionId}`);
      }

      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        sessions.delete(sessionId);
        if (!loggedOut) {
          // ficará “sem conexão”; app pode chamar /start de novo
          sessionState.set(sessionId, { connected: false });
        } else {
          sessionState.delete(sessionId);
        }
      }
    });

    sessions.set(sessionId, sock);
    sessionState.set(sessionId, { connected: false });
    res.json({ ok: true, message: "Sessão iniciada", sessionId });
  } catch (err) {
    console.error("start error:", err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// QR atual (para renderizar no app)
app.get("/api/sessions/:sessionId/qr", (req, res) => {
  const { sessionId } = req.params;
  const st = sessionState.get(sessionId);
  if (st?.qr) return res.json({ ok: true, qr: st.qr });
  return res.status(404).json({ ok: false, error: "QR indisponível" });
});

// Status da sessão
app.get("/api/sessions/:sessionId/status", (req, res) => {
  const { sessionId } = req.params;
  const st = sessionState.get(sessionId);
  res.json({
    ok: !!st,
    connected: !!st?.connected,
    hasQR: !!st?.qr
  });
});

// Encerrar sessão (logout)
app.delete("/api/sessions/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sock = sessions.get(sessionId);
    if (sock) {
      await sock.logout();
      try { sock.end?.(); } catch {}
      sessions.delete(sessionId);
    }
    sessionState.delete(sessionId);
    res.json({ ok: true, message: "Sessão encerrada" });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 SEUBOT rodando na porta ${PORT}`));
