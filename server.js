
const express = require('express');
const cors = require('cors');
const WPPConnect = require('@wppconnect-team/wppconnect');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const sessions = new Map();

function getOrCreateSessionBucket(sessionId){
  if(!sessions.has(sessionId)){
    sessions.set(sessionId, { client: null, state: 'CLOSED', lastQr: null, sseClients: new Set() });
  }
  return sessions.get(sessionId);
}

function broadcast(sessionId, event, data){
  const bucket = sessions.get(sessionId);
  if(!bucket) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for(const res of bucket.sseClients){
    try{ res.write(payload); } catch(e){}
  }
}

app.get('/', (_req,res)=> res.json({name:'SEUBOT WPPConnect Connector', ok:true, version:'1.0.0'}));
app.get('/healthz', (_req,res)=> res.status(200).send('ok'));

app.post('/api/sessions/:sessionId/start', async (req,res)=>{
  const { sessionId } = req.params;
  const bucket = getOrCreateSessionBucket(sessionId);
  if(bucket.client){
    return res.json({ ok:true, status: bucket.state || 'CONNECTED', message: 'Sessão já iniciada' });
  }
  try{
    bucket.state = 'STARTING';
    const client = await WPPConnect.create({
      session: sessionId,
      catchQR: (qrCode, ascii)=>{
        bucket.lastQr = qrCode;
        bucket.state = 'QRCODE';
        broadcast(sessionId, 'qr', { qr: qrCode });
      },
      statusFind: (statusSession, session)=>{
        bucket.state = statusSession;
        broadcast(sessionId, 'status', { status: statusSession, session });
      },
      headless: true,
      devtools: false,
      useChrome: true,
      puppeteerOptions: {
        args: [
          '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas','--no-first-run','--no-zygote',
          '--single-process','--disable-gpu'
        ],
        executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable'
      }
    });
    bucket.client = client;
    bucket.state = 'STARTED';
    client.onMessage(async (message)=>{
      broadcast(sessionId, 'incoming_message', {
        from: message.from, body: message.body,
        name: message.notifyName || message.sender?.pushname || '',
        timestamp: message.t
      });
    });
    res.json({ ok:true, status: bucket.state, message:'Sessão iniciada. Escaneie o QR.' });
  }catch(err){
    console.error('Erro ao iniciar sessão', err);
    bucket.state = 'ERROR';
    res.status(500).json({ ok:false, error:'FAILED_TO_START', details: String(err?.message || err) });
  }
});

app.get('/api/sessions/:sessionId/status', async (req,res)=>{
  const { sessionId } = req.params;
  const bucket = getOrCreateSessionBucket(sessionId);
  const connected = !!bucket.client && ['ISLOGGED','CONNECTED','CONNECTEDLL','QRREADSUCCESS'].includes((bucket.state||'').toUpperCase());
  res.json({ sessionId, status: bucket.state || 'CLOSED', connected });
});

app.get('/api/sessions/:sessionId/qr', (req,res)=>{
  const { sessionId } = req.params;
  const bucket = sessions.get(sessionId);
  if(!bucket || !bucket.lastQr) return res.status(404).json({ ok:false, error:'NO_QR_AVAILABLE' });
  res.json({ ok:true, qr:`data:image/png;base64,${bucket.lastQr}` });
});

app.delete('/api/sessions/:sessionId', async (req,res)=>{
  const { sessionId } = req.params;
  const bucket = sessions.get(sessionId);
  if(!bucket) return res.json({ ok:true, message:'Já encerrada' });
  try{ if(bucket.client){ await bucket.client.close(); } }catch(e){}
  for(const r of bucket.sseClients){ try{ r.end(); }catch(e){} }
  sessions.delete(sessionId);
  res.json({ ok:true, message:'Sessão encerrada' });
});

app.post('/api/messages/text', async (req,res)=>{
  const { sessionId, number, message } = req.body || {};
  if(!sessionId || !number || !message) return res.status(400).json({ ok:false, error:'MISSING_FIELDS' });
  const bucket = sessions.get(sessionId);
  if(!bucket || !bucket.client) return res.status(404).json({ ok:false, error:'SESSION_NOT_FOUND' });
  try{
    const to = String(number).replace(/\D/g,'');
    await bucket.client.sendText(`${to}@c.us`, message);
    broadcast(sessionId, 'outgoing_message', { to, message, timestamp: Date.now() });
    res.json({ ok:true, sent:true });
  }catch(err){
    console.error('Erro ao enviar mensagem', err);
    res.status(500).json({ ok:false, error:'SEND_FAILED', details: String(err?.message || err) });
  }
});

app.get('/api/messages/:sessionId/stream', (req,res)=>{
  const { sessionId } = req.params;
  const bucket = getOrCreateSessionBucket(sessionId);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  bucket.sseClients.add(res);
  res.write(`event: hello\ndata: ${JSON.stringify({ sessionId, status: bucket.state })}\n\n`);
  req.on('close', ()=>{
    bucket.sseClients.delete(res);
    try{ res.end(); }catch(e){}
  });
});

app.use((req,res)=> res.status(404).json({ ok:false, error:'NOT_FOUND', path:req.path }));

app.listen(PORT, ()=> console.log(`✅ SEUBOT backend ON :${PORT}`));
