import express from "express";
import cors from "cors";
import { create, fetch } from "@wppconnect-team/wppconnect";

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// health check
app.get("/", (req, res) => {
  res.json({ name: "SEUBOT WPPConnect Connector", ok: true, version: "1.0.0" });
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

// cria sessão e gera QR Code
app.post("/api/sessions/:sessionId/start", async (req, res) => {
  const sessionId = req.params.sessionId;
  console.log("Iniciando sessão:", sessionId);

  try {
    const client = await create({
      session: sessionId,
      catchQR: (base64Qr) => {
        console.log("QR recebido:", base64Qr.substring(0, 40) + "...");
      },
      statusFind: (status) => console.log("Status:", status),
    });

    return res.json({
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
