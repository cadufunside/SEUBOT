import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import wppconnect from "wppconnect";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const sessions = {};

// Criar nova sessão
app.post("/sessions/:sessionId/start", async (req, res) => {
  const { sessionId } = req.params;
  if (sessions[sessionId]) {
    return res.json({ status: "already_connected" });
  }
  try {
    const client = await wppconnect.create({
      session: sessionId,
      catchQR: (qrCode) => {
        sessions[sessionId] = { qr: qrCode, status: "waiting_qr" };
      },
      statusFind: (statusSession) => {
        sessions[sessionId] = { ...sessions[sessionId], status: statusSession };
      },
    });
    sessions[sessionId].client = client;
    res.json({ sessionId, status: "starting", qr: sessions[sessionId].qr });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao iniciar sessão" });
  }
});

// Status da sessão
app.get("/sessions/:sessionId/status", (req, res) => {
  const { sessionId } = req.params;
  if (!sessions[sessionId]) return res.status(404).json({ error: "Sessão não encontrada" });
  res.json({ sessionId, status: sessions[sessionId].status || "desconectado" });
});

// Enviar mensagem
app.post("/messages/text", async (req, res) => {
  const { sessionId, number, message } = req.body;
  try {
    const client = sessions[sessionId]?.client;
    if (!client) return res.status(404).json({ error: "Sessão não conectada" });
    await client.sendText(`${number}@c.us`, message);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Erro ao enviar mensagem" });
  }
});

// Desconectar sessão
app.delete("/sessions/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  try {
    const client = sessions[sessionId]?.client;
    if (client) await client.close();
    delete sessions[sessionId];
    res.json({ status: "disconnected" });
  } catch {
    res.status(500).json({ error: "Erro ao desconectar" });
  }
});

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
