import { defineConfig } from 'vite';
import net from 'net';
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

      // HTTP/HTTPS CORS Proxy middleware
      server.middlewares.use('/http-proxy', async (req, res) => {
        try {
          const urlObj = new URL(req.url, 'http://' + req.headers.host);
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
