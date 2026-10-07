import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sirv from 'sirv';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 7860;
const distPath = path.join(__dirname, 'dist');

if (!fs.existsSync(distPath)) {
  console.error('[Error] Thư mục "dist/" chưa tồn tại. Vui lòng chạy "npm run build" trước khi start server!');
  process.exit(1);
}

// Static file handler for production dist
const staticHandler = sirv(distPath, {
  single: true,
  dev: false,
  etag: true
});

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // HTTP CORS Proxy
  if (urlObj.pathname === '/http-proxy') {
    try {
      const targetUrl = urlObj.searchParams.get('url');
      if (!targetUrl) {
        res.statusCode = 400;
        res.end('Missing url parameter');
        return;
      }

      const fetchRes = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'User-Agent': 'Nokia6233/05.10 (J2ME-Online/1.0)',
        }
      });

      res.statusCode = fetchRes.status;
      fetchRes.headers.forEach((v, k) => {
        res.setHeader(k, v);
      });
      const buf = await fetchRes.arrayBuffer();
      res.end(Buffer.from(buf));
    } catch (e) {
      res.statusCode = 502;
      res.end(e.message);
    }
    return;
  }

  // Health check endpoint
  if (urlObj.pathname === '/healthz') {
    res.statusCode = 200;
    res.end('OK');
    return;
  }

  // Serve static files
  staticHandler(req, res);
});

// WebSocket TCP Proxy Server
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/tcp-proxy') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  } catch (e) {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const targetHost = url.searchParams.get('host');
    const targetPort = parseInt(url.searchParams.get('port'), 10);

    if (!targetHost || isNaN(targetPort)) {
      ws.close(1008, 'Missing host or port');
      return;
    }

    console.log(`[TCP Proxy] Connecting to ${targetHost}:${targetPort}...`);
    const tcpSocket = net.connect({ host: targetHost, port: targetPort }, () => {
      console.log(`[TCP Proxy] Connected to ${targetHost}:${targetPort}`);
    });

    tcpSocket.on('data', (chunk) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(chunk, { binary: true });
      }
    });

    ws.on('message', (data) => {
      if (tcpSocket.writable) {
        tcpSocket.write(data);
      }
    });

    tcpSocket.on('error', (err) => {
      console.warn(`[TCP Proxy] TCP error (${targetHost}:${targetPort}):`, err.message);
      if (ws.readyState === ws.OPEN) {
        ws.close(1011, err.message);
      }
    });

    ws.on('error', (err) => {
      tcpSocket.destroy();
    });

    tcpSocket.on('close', () => {
      if (ws.readyState === ws.OPEN) ws.close();
    });

    ws.on('close', () => {
      tcpSocket.destroy();
    });
  } catch (err) {
    console.error('[TCP Proxy Error]', err);
    ws.close(1011, err.message);
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 J2ME Web Emulator Production Server is running on port ${PORT}`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`🌐 Online TCP Proxy active on ws://localhost:${PORT}/tcp-proxy\n`);
});
