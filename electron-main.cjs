const { app, BrowserWindow, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const sirv = require('sirv');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let localServer = null;
let serverPort = 3000;

// ============================================================================
// 1. Tự động khởi chạy Local Server + WebSocket TCP Proxy ngầm
// ============================================================================
function startEmbeddedServer() {
    return new Promise((resolve, reject) => {
        const distPath = path.join(__dirname, 'dist');
        if (!fs.existsSync(distPath)) {
            console.error('[Error] Thư mục "dist/" chưa có. Cần build trước.');
        }

        const staticHandler = sirv(distPath, {
            single: true,
            dev: false,
            etag: true
        });

        localServer = http.createServer((req, res) => {
            const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

            if (urlObj.pathname === '/http-proxy') {
                const targetUrl = urlObj.searchParams.get('url');
                if (!targetUrl) {
                    res.statusCode = 400;
                    res.end('Missing url');
                    return;
                }
                fetch(targetUrl, {
                    method: req.method,
                    headers: { 'User-Agent': 'Nokia6233/05.10 (J2ME-Online/1.0)' }
                }).then(async fetchRes => {
                    res.statusCode = fetchRes.status;
                    fetchRes.headers.forEach((v, k) => res.setHeader(k, v));
                    const buf = await fetchRes.arrayBuffer();
                    res.end(Buffer.from(buf));
                }).catch(err => {
                    res.statusCode = 502;
                    res.end(err.message);
                });
                return;
            }

            staticHandler(req, res);
        });

        const wss = new WebSocketServer({ noServer: true });

        localServer.on('upgrade', (req, socket, head) => {
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
                    ws.close(1008, 'Missing host/port');
                    return;
                }

                const tcpSocket = net.connect({ host: targetHost, port: targetPort });

                tcpSocket.on('data', chunk => {
                    if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
                });

                ws.on('message', data => {
                    if (tcpSocket.writable) tcpSocket.write(data);
                });

                tcpSocket.on('error', err => {
                    if (ws.readyState === ws.OPEN) ws.close(1011, err.message);
                });

                ws.on('error', () => tcpSocket.destroy());
                tcpSocket.on('close', () => { if (ws.readyState === ws.OPEN) ws.close(); });
                ws.on('close', () => tcpSocket.destroy());
            } catch (err) {
                ws.close(1011, err.message);
            }
        });

        // Tìm port trống
        localServer.listen(0, '127.0.0.1', () => {
            serverPort = localServer.address().port;
            console.log(`[Embedded Server] Running on http://127.0.0.1:${serverPort}`);
            resolve(serverPort);
        });

        localServer.on('error', reject);
    });
}

// ============================================================================
// 2. Tạo Cửa sổ Ứng dụng & Khay hệ thống (System Tray)
// ============================================================================
function createWindow(port) {
    const iconPath = path.join(__dirname, 'app-icon.png');
    const appIcon = nativeImage.createFromPath(iconPath);

    mainWindow = new BrowserWindow({
        width: 480,
        height: 800,
        minWidth: 360,
        minHeight: 500,
        title: 'J2ME Web Emulator (Chạy ngầm 24/7)',
        icon: appIcon,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // CỰC KỲ QUAN TRỌNG: Không bóp nghẹt timer khi cửa sổ bị ẩn xuống tray
            backgroundThrottling: false
        }
    });

    mainWindow.loadURL(`http://127.0.0.1:${port}`);

    // Bấm nút Đóng (X) ➔ Ẩn cửa sổ xuống khay hệ thống, tiếp tục chạy ngầm
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();

            // Hiển thị bóng thông báo nhỏ trên Windows
            if (Notification.isSupported()) {
                new Notification({
                    title: 'J2ME Emulator đang chạy ngầm',
                    body: 'Game vẫn đang hoạt động liên tục. Bấm vào biểu tượng khay hệ thống để mở lại.',
                    icon: appIcon
                }).show();
            }
        }
    });

    createTray(appIcon);
}

function createTray(appIcon) {
    tray = new Tray(appIcon);
    tray.setToolTip('J2ME Web Emulator - Đang chạy ngầm');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '📱 Mở giao diện',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: '🔄 Nạp lại ứng dụng',
            click: () => {
                if (mainWindow) mainWindow.reload();
            }
        },
        { type: 'separator' },
        {
            label: '❌ Thoát hoàn toàn',
            click: () => {
                isQuitting = true;
                if (localServer) localServer.close();
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);

    // Click chuột trái vào tray icon ➔ Bật/Tắt cửa sổ
    tray.on('click', () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// Giới hạn 1 instance duy nhất
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (!mainWindow.isVisible()) mainWindow.show();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(async () => {
        try {
            const port = await startEmbeddedServer();
            createWindow(port);
        } catch (e) {
            console.error('Không thể khởi chạy ứng dụng:', e);
        }
    });

    app.on('window-all-closed', (e) => {
        // Ngăn Electron tự thoát khi tất cả cửa sổ đóng
        e.preventDefault();
    });
}
