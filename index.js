import pkg from '@whiskeysockets/baileys';
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = pkg;
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
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
    retryRequestDelayMs: 2000,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('QR Code recebido, gerando imagem...');
      try {
        qrCodeData = await QRCode.toDataURL(qr);
        console.log('QR Code gerado com sucesso!');
      } catch (err) {
        console.error('Erro ao gerar QR:', err);
      }
    }

    if (connection === 'open') {
      isConnected = true;
      qrCodeData = null;
      console.log('Conectado ao WhatsApp!');
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Desconectado. Código:', statusCode, 'Reconectar:', shouldReconnect);
      if (shouldReconnect) {
        await delay(5000);
        startBot();
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
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
      const reply = data.response || 'Desculpa, algo deu errado.';
      await sock.sendMessage(sender, { text: reply });
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
    }
  });
}

app.get('/', (req, res) => {
  res.json({ status: 'Bot rodando', connected: isConnected });
});

app.get('/qrcode', (req, res) => {
  if (!qrCodeData) {
    return res.json({ waiting: true, message: 'Gerando QR Code, aguarde 30 segundos e recarregue.' });
  }
  res.send(`<html><body style="background:#000;display:flex;align-items:center;justify-content:center;height:100vh"><img src="${qrCodeData}" style="width:300px;height:300px"/></body></html>`);
});

app.get('/status', (req, res) => {
  res.json({ connected: isConnected });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  startBot();
});
