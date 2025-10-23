import express from "express";
import cors from "cors";
import { create, fetch } from "@wppconnect-team/wppconnect";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/sessions/:sessionId/start", async (req, res) => {
  const { sessionId } = req.params;
  try {
    const client = await create({
      session: sessionId,
      catchQR: (base64Qr, asciiQR) => {
        console.log("QR gerado para:", sessionId);
        app.set("qr_" + sessionId, base64Qr);
      },
      statusFind: (status) => console.log("Status:", status)
    });
    res.json({ ok: true, message: "Sessão iniciada", sessionId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/sessions/:sessionId/qr", (req, res) => {
  const { sessionId } = req.params;
  const qr = app.get("qr_" + sessionId);
  if (qr) return res.json({ ok: true, qr });
  res.status(404).json({ ok: false, message: "QR ainda não disponível" });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 SEUBOT rodando na porta ${PORT}`));
