import express from "express";
import cors from "cors";
import { create, fetch } from "@wppconnect-team/wppconnect";

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE", "OPTIONS"] }));

// Health check
app.get("/healthz", (req, res) => res.json({ ok: true }));

// Inicia sessão e gera QR Code
app.post("/api/sessions/:sessionId/start", async (req, res) => {
  const sessionId = req.params.sessionId;

  try {
    const client = await create({
      session: sessionId,
      catchQR: (base64Qr) => {
        console.log("QR RECEBIDO:", base64Qr.substring(0, 50) + "...");
      },
      statusFind: (status) => console.log("STATUS:", status),
    });

    return res.json({
      ok: true,
      message: "Sessão iniciada com sucesso",
      sessionId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Verifica status da sessão
app.get("/api/sessions/:sessionId/status", async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const data = await fetch(sessionId);
    res.json({ ok: true, data });
  } catch {
    res.status(404).json({ ok: false, message: "Sessão não encontrada" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 SEUBOT rodando na porta ${PORT}`));
