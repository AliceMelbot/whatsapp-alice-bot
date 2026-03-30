import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import express from 'express';
import QRCode from 'qrcode';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE44_API_URL = process.env.BASE44_API_URL || '';
const BASE44_API_KEY = process.env.BASE44_API_KEY || '';

let qrCodeData = null;
let sock = null;
let isConnected = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_info_baileys');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: Browsers.macOS('Desktop'),
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeData = await QRCode.toDataURL(qr);
      console.log('QR Code gerado!');
    }

    if (connection === 'open') {
      isConnected = true;
      qrCodeData = null;
      console.log('Conectado ao WhatsApp!');
    }

    if (connection === 'close') {
      isConnected = false;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log('Reconectando...');
        setTimeout(startBot, 5000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    if (!text) return;
    console.log(`Mensagem de ${sender}: ${text}`);

    try {
      const response = await fetch(`${BASE44_API_URL}/api/functions/whatsappAliceResponse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${BASE44_API_KEY}`,
        },
        body: JSON.stringify({ message: text, from: sender }),
      });

      const data = await response.json();
      const reply = data.response || 'Oi! Estou aqui.';

      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
      await sock.sendMessage(sender, { text: reply });
    } catch (error) {
      console.error('Erro:', error);
    }
  });
}

app.get('/', (req, res) => res.json({ status: 'online', connected: isConnected }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/status', (req, res) => res.json({ connected: isConnected }));
app.get('/qrcode', (req, res) => {
  if (isConnected) return res.json({ connected: true, message: 'Já conectado!' });
  if (!qrCodeData) return res.json({ waiting: true, message: 'Gerando QR Code, aguarde 30 segundos e recarregue.' });
  res.send(`<html><body style="background:#000;display:flex;align-items:center;justify-content:center;height:100vh"><img src="${qrCodeData}" style="width:300px"/></body></html>`);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  startBot();
});
