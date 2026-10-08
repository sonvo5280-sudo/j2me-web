import http from 'http';
import net from 'net';
import tls from 'tls';
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

  // HTTP / HTTPS CORS Proxy (Full support for GET, POST, HEAD, PUT, binary body & headers)
  if (urlObj.pathname === '/http-proxy') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      const targetUrl = urlObj.searchParams.get('url');
      if (!targetUrl) {
        res.statusCode = 400;
        res.end('Missing url parameter');
        return;
      }

      // Collect request body for POST/PUT requests
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const hasBody = chunks.length > 0 && req.method !== 'GET' && req.method !== 'HEAD';
      const body = hasBody ? Buffer.concat(chunks) : undefined;

      const forwardedHeaders = {};
      for (const [k, v] of Object.entries(req.headers)) {
        const lower = k.toLowerCase();
        if (!['host', 'origin', 'referer', 'connection', 'content-length'].includes(lower)) {
          forwardedHeaders[k] = v;
        }
      }
      if (!forwardedHeaders['user-agent']) {
        forwardedHeaders['user-agent'] = 'Nokia6233/05.10 (J2ME-Online/1.0)';
      }

      const fetchRes = await fetch(targetUrl, {
        method: req.method,
        headers: forwardedHeaders,
        body: body,
        redirect: 'follow'
      });

      res.statusCode = fetchRes.status;
      fetchRes.headers.forEach((v, k) => {
        const lower = k.toLowerCase();
        if (!['content-encoding', 'transfer-encoding', 'access-control-allow-origin'].includes(lower)) {
          res.setHeader(k, v);
        }
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
    const isSsl = url.searchParams.get('ssl') === 'true' || url.searchParams.get('tls') === 'true' || targetPort === 443;

    if (!targetHost || isNaN(targetPort)) {
      ws.close(1008, 'Missing host or port');
      return;
    }

    console.log(`[TCP Proxy] Connecting to ${targetHost}:${targetPort} (SSL: ${isSsl})...`);

    const socketConnector = isSsl ? tls.connect : net.connect;
    const connectOptions = isSsl
      ? { host: targetHost, port: targetPort, rejectUnauthorized: false }
      : { host: targetHost, port: targetPort };

    const tcpSocket = socketConnector(connectOptions, () => {
      console.log(`[TCP Proxy] Connected to ${targetHost}:${targetPort} (SSL: ${isSsl})`);
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
