import express from "express";
import cors from "cors";
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE", "OPTIONS"] }));

let sessions = {};

app.get("/", (req, res) =>
  res.json({ name: "SEUBOT Baileys Connector", ok: true, version: "1.0.0" })
);

app.post("/api/sessions/:sessionId/start", async (req, res) => {
  const { sessionId } = req.params;
  if (sessions[sessionId]) return res.json({ ok: true, message: "Sessão já ativa" });

  const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionId}`);
  const sock = makeWASocket({ auth: state, printQRInTerminal: true });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) console.log(`QR ${sessionId}: ${qr.substring(0, 40)}...`);
    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) sessions[sessionId] = null;
    } else if (connection === "open") {
      sessions[sessionId] = sock;
      console.log(`✅ Conectado: ${sessionId}`);
    }
  });

  sessions[sessionId] = sock;
  res.json({ ok: true, message: "Sessão iniciada. Veja o QR no log do Render.", sessionId });
});

app.get("/api/sessions/:sessionId/status", (req, res) => {
  const { sessionId } = req.params;
  const active = !!sessions[sessionId];
  res.json({ ok: active, status: active ? "CONNECTED" : "DISCONNECTED" });
});

app.delete("/api/sessions/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  if (sessions[sessionId]) {
    sessions[sessionId].end();
    delete sessions[sessionId];
  }
  res.json({ ok: true, message: "Sessão encerrada" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 SEUBOT rodando na porta ${PORT}`));
      ok: true,
      message: "Sessão iniciada com sucesso",
      sessionId,
    });
  } catch (error) {
    console.error("Erro ao iniciar sessão:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// verifica status da sessão
app.get("/api/sessions/:sessionId/status", async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const data = await fetch(sessionId);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(404).json({ ok: false, message: "Sessão não encontrada" });
  }
});

// encerra sessão
app.delete("/api/sessions/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const client = await fetch(sessionId);
    await client.close();
    res.json({ ok: true, message: "Sessão encerrada" });
  } catch (err) {
    res.status(404).json({ ok: false, message: "Sessão não encontrada" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 SEUBOT rodando na porta ${PORT}`));
