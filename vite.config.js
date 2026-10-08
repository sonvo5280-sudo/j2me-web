import { defineConfig } from 'vite';
import net from 'net';
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';

function j2meNetworkProxyPlugin() {
  return {
    name: 'j2me-network-proxy',
    closeBundle() {
      // Tự động copy các file lõi giả lập vào thư mục dist khi build
      const distDir = path.resolve('dist');
      if (fs.existsSync(distDir)) {
        ['freej2me-web.jar', 'init.zip', 'apps'].forEach(item => {
          const src = path.resolve(item);
          const dst = path.resolve(distDir, item);
          if (fs.existsSync(src)) {
            fs.cpSync(src, dst, { recursive: true, force: true });
          }
        });
        console.log('[Build] Đã copy đầy đủ freej2me-web.jar, init.zip và apps vào dist/');
      }
    },
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on('upgrade', (req, socket, head) => {
        try {
          const url = new URL(req.url, 'http://' + req.headers.host);
          if (url.pathname === '/tcp-proxy') {
            wss.handleUpgrade(req, socket, head, (ws) => {
              wss.emit('connection', ws, req);
            });
          }
        } catch (e) {
          console.error('[TCP Proxy Upgrade Error]', e);
        }
      });

      wss.on('connection', (ws, req) => {
        try {
          const url = new URL(req.url, 'http://' + req.headers.host);
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

          ws.on('message', (data, isBinary) => {
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
            console.warn(`[TCP Proxy] WS error:`, err.message);
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

      // HTTP/HTTPS CORS Proxy middleware with body & headers forwarding
      server.middlewares.use('/http-proxy', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        const urlObj = new URL(req.url, 'http://' + req.headers.host);
        const targetUrl = urlObj.searchParams.get('url');
        if (!targetUrl) {
          res.statusCode = 400;
          res.end('Missing url parameter');
          return;
        }

        try {
          console.log(`[Vite HTTP Proxy] ${req.method} -> ${targetUrl}`);

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
            const lower = k.toLowerCase();
            if (!ignoredHeaders.includes(lower)) {
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
          console.log(`[Vite HTTP Proxy OK] ${targetUrl} (Status: ${fetchRes.status}, Size: ${buf.byteLength} bytes)`);
        } catch (e) {
          console.error(`[Vite HTTP Proxy Error] ${targetUrl}:`, e.message);
          res.statusCode = 502;
          res.end(e.message);
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [j2meNetworkProxyPlugin()],
  server: {
    port: 5173,
    open: false
  },
  assetsInclude: ['**/*.jar', '**/*.wasm', '**/*.zip']
});
