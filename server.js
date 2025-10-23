const express = require("express");
const cors = require("cors");
const wppconnect = require("@wppconnect-team/wppconnect");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const sessoes = {};

app.get("/api/sessions/:sessionId/start", async (req, res) => {
  const { sessionId } = req.params;

  try {
    await wppconnect.create({
      session: sessionId,
      headless: true,
      useChrome: true,
      debug: false,
      catchQR: (base64Qr, asciiQR) => {
        console.log("QR gerado para:", sessionId);
        sessoes[sessionId] = base64Qr;
      },
      statusFind: (statusSession) => {
        console.log("Status:", statusSession);
      }
    });

    res.json({ ok: true, message: "Sessão iniciada com sucesso" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/sessions/:sessionId/qr", (req, res) => {
  const { sessionId } = req.params;
  const qr = sessoes[sessionId];
  if (qr) return res.json({ ok: true, qr });
  res.status(404).json({ ok: false, message: "QR ainda não disponível" });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ SEUBOT rodando na porta ${PORT}`));
