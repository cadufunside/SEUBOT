
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const wppconnect = require('@wppconnect-team/wppconnect');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || null;

const sessions = {};
const messageBus = {};

function initBus(sessionId) {
  if (!messageBus[sessionId]) {
    messageBus[sessionId] = { sseClients: new Set(), messages: [] };
  }
}
function sseBroadcast(sessionId, payload) {
  initBus(sessionId);
  messageBus[sessionId].messages.push(payload);
  for (const res of messageBus[sessionId].sseClients) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

app.get('/', (_req, res) => res.json({ name: 'SEUBOT WPPConnect Connector', ok: true, version: '1.0.0' }));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.post('/sessions/:sessionId/start', async (req, res) => {
  const { sessionId } = req.params;
  const forced = Boolean(req.query.force === '1');

  if (sessions[sessionId] && !forced) {
    return res.json({ sessionId, status: sessions[sessionId].status || 'connected' });
  }

  try {
    const client = await wppconnect.create({
      session: sessionId,
      useChrome: true,
      browserPathExecutable: CHROME_PATH,
      puppeteerOptions: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--single-process'
        ]
      },
      catchQR: (qrCode, asciiQR) => {
        sessions[sessionId] = sessions[sessionId] || {};
        sessions[sessionId].qr = qrCode;
        sessions[sessionId].status = 'qr';
        sseBroadcast(sessionId, { type: 'qr', qr: qrCode, at: Date.now() });
      },
      statusFind: (status) => {
        sessions[sessionId] = sessions[sessionId] || {};
        sessions[sessionId].status = status;
        sseBroadcast(sessionId, { type: 'status', status, at: Date.now() });
      }
    });

    sessions[sessionId] = {
      ...(sessions[sessionId] || {}),
      client,
      status: sessions[sessionId]?.status || 'starting',
      createdAt: Date.now()
    };

    client.onMessage((message) => {
      const payload = {
        type: 'incoming_message',
        from: message.from,
        body: message.body,
        pushName: message.sender?.pushname || null,
        ts: Date.now()
      };
      sseBroadcast(sessionId, payload);
    });

    return res.json({ sessionId, status: sessions[sessionId].status, qr: sessions[sessionId].qr || null });
  } catch (error) {
    console.error('Erro ao iniciar sessão', error);
    return res.status(500).json({ error: 'Erro ao iniciar sessão', details: String(error) });
  }
});

app.get('/sessions/:sessionId/status', (req, res) => {
  const { sessionId } = req.params;
  const sess = sessions[sessionId];
  if (!sess) return res.status(404).json({ error: 'Sessão não encontrada' });
  res.json({ sessionId, status: sess.status || 'unknown', hasQR: Boolean(sess.qr) });
});

app.delete('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const sess = sessions[sessionId];
    if (sess?.client) {
      await sess.client.close();
    }
    delete sessions[sessionId];
    sseBroadcast(sessionId, { type: 'session_closed', at: Date.now() });
    res.json({ sessionId, status: 'disconnected' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao desconectar' });
  }
});

app.post('/messages/text', async (req, res) => {
  const { sessionId, number, message } = req.body || {};
  if (!sessionId || !number || !message) return res.status(400).json({ error: 'sessionId, number e message são obrigatórios' });
  const sess = sessions[sessionId];
  if (!sess?.client) return res.status(404).json({ error: 'Sessão não conectada' });

  try {
    await sess.client.sendText(`${number}@c.us`, message);
    const payload = { type: 'outgoing_message', to: number, body: message, ts: Date.now() };
    sseBroadcast(sessionId, payload);
    res.json({ success: true });
  } catch (e) {
    console.error('Erro ao enviar mensagem', e);
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

app.get('/messages/:sessionId/stream', (req, res) => {
  const { sessionId } = req.params;
  initBus(sessionId);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  messageBus[sessionId].sseClients.add(res);

  for (const msg of messageBus[sessionId].messages.slice(-50)) {
    res.write(`data: ${JSON.stringify(msg)}\n\n`);
  }

  req.on('close', () => {
    messageBus[sessionId].sseClients.delete(res);
  });
});

app.post('/webhook/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  if (WEBHOOK_SECRET && req.query.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'invalid secret' });
  }
  initBus(sessionId);
  const payload = { type: 'webhook', body: req.body, ts: Date.now() };
  sseBroadcast(sessionId, payload);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🚀 SEUBOT connector running on port ${PORT}`);
});
