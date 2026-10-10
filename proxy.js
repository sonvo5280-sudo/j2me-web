import http from 'http';
import net from 'net';
import tls from 'tls';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 7860;

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // CORS Preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Health check
  if (urlObj.pathname === '/' || urlObj.pathname === '/healthz') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('J2ME Android Dedicated Proxy is running 24/7!');
    return;
  }

  // HTTP CORS Proxy (/http-proxy?url=...)
  if (urlObj.pathname === '/http-proxy') {
    const targetUrl = urlObj.searchParams.get('url');
    if (!targetUrl) {
      res.statusCode = 400;
      res.end('Missing url parameter');
      return;
    }

    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const hasBody = chunks.length > 0 && req.method !== 'GET' && req.method !== 'HEAD';
      const body = hasBody ? Buffer.concat(chunks) : undefined;

      const ignoredHeaders = [
        'host', 'origin', 'referer', 'connection', 'content-length',
        'accept-encoding', 'cookie', 'sec-ch-ua', 'sec-ch-ua-mobile',
        'sec-ch-ua-platform', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site'
      ];

      const forwardedHeaders = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (!ignoredHeaders.includes(k.toLowerCase())) {
          forwardedHeaders[k] = v;
        }
      }

      forwardedHeaders['user-agent'] = 'Nokia6233/05.10 (J2ME-Online/1.0)';
      forwardedHeaders['accept-encoding'] = 'identity';

      const fetchRes = await fetch(targetUrl, {
        method: req.method,
        headers: forwardedHeaders,
        body: body,
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });

      res.statusCode = fetchRes.status;
      fetchRes.headers.forEach((v, k) => {
        const lower = k.toLowerCase();
        if (!['content-encoding', 'transfer-encoding', 'access-control-allow-origin', 'content-length'].includes(lower)) {
          res.setHeader(k, v);
        }
      });

      const buf = await fetchRes.arrayBuffer();
      res.setHeader('Content-Length', buf.byteLength);
      res.end(Buffer.from(buf));
    } catch (e) {
      res.statusCode = 502;
      res.end('Proxy Error: ' + e.message);
    }
    return;
  }

  res.statusCode = 404;
  res.end('Not Found');
});

// WebSocket TCP Proxy
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

    // Bidirectional Keepalive Ping/Pong handling
    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify({ type: 'ping' })); } catch (_) {}
      }
    }, 25000);

    tcpSocket.on('data', (chunk) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(chunk, { binary: true });
      }
    });

    ws.on('message', (data) => {
      // Intercept string heartbeat pings so they don't pollute game data
      if (typeof data === 'string' || (data instanceof Buffer && data.length < 50 && data.toString().startsWith('{'))) {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'ping') {
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'pong' }));
            return;
          }
          if (parsed.type === 'pong') return;
        } catch (_) {}
      }

      if (tcpSocket.writable) {
        tcpSocket.write(data);
      }
    });

    const cleanup = () => {
      clearInterval(pingInterval);
      tcpSocket.destroy();
      if (ws.readyState === ws.OPEN) ws.close();
    };

    tcpSocket.on('error', (err) => {
      console.warn(`[TCP Proxy] TCP error (${targetHost}:${targetPort}):`, err.message);
      cleanup();
    });

    ws.on('error', () => cleanup());
    tcpSocket.on('close', () => cleanup());
    ws.on('close', () => cleanup());
  } catch (err) {
    console.error('[TCP Proxy Error]', err);
    ws.close(1011, err.message);
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 J2ME Dedicated Proxy Server is running on port ${PORT}`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`👉 ws://localhost:${PORT}/tcp-proxy`);
  console.log(`======================================================\n`);
});
