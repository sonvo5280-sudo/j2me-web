// ============================================================================
// FreeJ2ME Web - WebSocket TCP Socket Bridge for Online Games
// Enables J2ME MIDlets (Ninja School, Dragon Boy, Avatar, TibiaME, etc.)
// to connect directly to online game servers via WebSocket TCP Proxy.
// ============================================================================

class SocketConnectionState {
    constructor(id, host, port) {
        this.id = id;
        this.host = host;
        this.port = port;
        this.ws = null;
        this.isOpen = false;
        this.isClosed = false;
        this.error = null;

        // Byte queue for received data
        this.chunks = [];
        this.chunkOffset = 0;
        this.totalAvailable = 0;

        // Waiting readers (Java threads waiting for socket data)
        this.pendingReaders = [];
    }

    pushData(u8) {
        if (!u8 || u8.length === 0) return;
        this.chunks.push(u8);
        this.totalAvailable += u8.length;
        this.notifyReaders();
    }

    notifyReaders() {
        while (this.pendingReaders.length > 0 && (this.totalAvailable > 0 || this.isClosed)) {
            const waiter = this.pendingReaders.shift();
            waiter();
        }
    }

    readSingleByte() {
        if (this.totalAvailable === 0) {
            return this.isClosed ? -1 : null;
        }

        const chunk = this.chunks[0];
        const val = chunk[this.chunkOffset++];
        this.totalAvailable--;

        if (this.chunkOffset >= chunk.length) {
            this.chunks.shift();
            this.chunkOffset = 0;
        }

        return val;
    }

    readInto(javaArray, off, len) {
        if (this.totalAvailable === 0) {
            return this.isClosed ? -1 : null;
        }

        let bytesToRead = Math.min(len, this.totalAvailable);
        let bytesCopied = 0;

        while (bytesCopied < bytesToRead && this.chunks.length > 0) {
            const chunk = this.chunks[0];
            const availableInChunk = chunk.length - this.chunkOffset;
            const take = Math.min(availableInChunk, bytesToRead - bytesCopied);

            copyBytesToJava(javaArray, off + bytesCopied, chunk, this.chunkOffset, take);

            this.chunkOffset += take;
            this.totalAvailable -= take;
            bytesCopied += take;

            if (this.chunkOffset >= chunk.length) {
                this.chunks.shift();
                this.chunkOffset = 0;
            }
        }

        return bytesCopied;
    }

    close() {
        this.isClosed = true;
        this.isOpen = false;
        if (this.ws) {
            try {
                this.ws.close();
            } catch (_) {}
            this.ws = null;
        }
        this.notifyReaders();
    }
}

function copyBytesToJava(javaByteArray, targetOff, srcBytes, srcOff, count) {
    if (ArrayBuffer.isView(javaByteArray) || (javaByteArray && javaByteArray.buffer instanceof ArrayBuffer)) {
        const targetView = new Uint8Array(javaByteArray.buffer, (javaByteArray.byteOffset || 0) + targetOff, count);
        targetView.set(srcBytes.subarray(srcOff, srcOff + count));
        return;
    }
    for (let i = 0; i < count; i++) {
        javaByteArray[targetOff + i] = (srcBytes[srcOff + i] << 24) >> 24;
    }
}

function extractBytesFromJava(javaByteArray, off, len) {
    if (ArrayBuffer.isView(javaByteArray) || (javaByteArray && javaByteArray.buffer instanceof ArrayBuffer)) {
        const view = new Uint8Array(javaByteArray.buffer, (javaByteArray.byteOffset || 0) + off, len);
        return new Uint8Array(view); // Clones into isolated buffer so subsequent Java mutations do not corrupt the packet
    }
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        u8[i] = javaByteArray[off + i] & 0xFF;
    }
    return u8;
}

const activeSockets = new Map();
let nextSocketId = 1;

function getProxyBase() {
    const custom = localStorage.getItem('j2me_custom_proxy');
    if (custom) return custom.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/\/$/, '');

    const isLocalBackend = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && location.port === '7860';
    if (isLocalBackend) {
        return location.host;
    }
    return 'j2me-proxy.sonvo5280.workers.dev';
}

async function createSocketConnection(host, port, isSsl = false) {
    const id = nextSocketId++;
    const state = new SocketConnectionState(id, host, port);
    activeSockets.set(id, state);

    const proxyHost = getProxyBase();
    const isLocal = proxyHost.startsWith('localhost') || proxyHost.startsWith('127.0.0.1');
    const wsProtocol = isLocal ? (location.protocol === 'https:' ? 'wss:' : 'ws:') : 'wss:';
    const sslParam = isSsl ? '&ssl=true' : '';
    const wsUrl = `${wsProtocol}//${proxyHost}/tcp-proxy?host=${encodeURIComponent(host)}&port=${port}${sslParam}`;

    return new Promise((resolve, reject) => {
        try {
            const ws = new WebSocket(wsUrl);
            ws.binaryType = 'arraybuffer';
            state.ws = ws;

            let hasOpened = false;

            ws.onopen = () => {
                hasOpened = true;
                state.isOpen = true;
                console.log(`[SocketBridge] Online connection established to ${host}:${port} (SSL: ${Boolean(isSsl)}, ID: ${id})`);
                resolve(id);
            };

            ws.onmessage = async (event) => {
                if (event.data instanceof ArrayBuffer) {
                    state.pushData(new Uint8Array(event.data));
                } else if (event.data instanceof Blob) {
                    const buf = await event.data.arrayBuffer();
                    state.pushData(new Uint8Array(buf));
                } else if (typeof event.data === 'string') {
                    try {
                        const parsed = JSON.parse(event.data);
                        if (parsed.type === 'ready') return;
                    } catch (_) {}
                    const enc = new TextEncoder().encode(event.data);
                    state.pushData(enc);
                }
            };

            ws.onerror = (err) => {
                console.warn(`[SocketBridge] Socket error on ${host}:${port}:`, err);
                state.error = err;
                if (!hasOpened) {
                    activeSockets.delete(id);
                    reject(new Error(`Cannot connect to game server ${host}:${port}`));
                }
            };

            ws.onclose = () => {
                console.log(`[SocketBridge] Socket closed for ${host}:${port} (ID: ${id})`);
                state.close();
            };
        } catch (e) {
            activeSockets.delete(id);
            reject(e);
        }
    });
}

export default {
    async Java_pl_zb3_freej2me_bridge_network_SocketBridge_open(lib, host, port) {
        let isSsl = false;
        if (typeof host === 'string' && host.startsWith('ssl:')) {
            host = host.substring(4);
            isSsl = true;
        }
        if (port === 443) {
            isSsl = true;
        }
        return createSocketConnection(host, port, isSsl);
    },

    async Java_pl_zb3_freej2me_bridge_network_SocketBridge_openSsl(lib, host, port, isSsl) {
        return createSocketConnection(host, port, Boolean(isSsl));
    },

    async Java_pl_zb3_freej2me_bridge_network_SocketBridge_read(lib, socketId) {
        const state = activeSockets.get(socketId);
        if (!state) return -1;

        const val = state.readSingleByte();
        if (val !== null) return val;

        // Block & wait for next packet
        return new Promise((resolve) => {
            state.pendingReaders.push(() => {
                const byteVal = state.readSingleByte();
                resolve(byteVal !== null ? byteVal : -1);
            });
        });
    },

    async Java_pl_zb3_freej2me_bridge_network_SocketBridge_readBlock(lib, socketId, targetBytes, off, len) {
        const state = activeSockets.get(socketId);
        if (!state) return -1;

        if (len <= 0) return 0;

        const count = state.readInto(targetBytes, off, len);
        if (count !== null) return count;

        // Block & wait for next packet
        return new Promise((resolve) => {
            state.pendingReaders.push(() => {
                const res = state.readInto(targetBytes, off, len);
                resolve(res !== null ? res : -1);
            });
        });
    },

    async Java_pl_zb3_freej2me_bridge_network_SocketBridge_available(lib, socketId) {
        const state = activeSockets.get(socketId);
        if (!state) return 0;
        return state.totalAvailable;
    },

    async Java_pl_zb3_freej2me_bridge_network_SocketBridge_write(lib, socketId, dataBytes, off, len) {
        const state = activeSockets.get(socketId);
        if (!state || !state.isOpen || !state.ws) {
            throw new Error(`Socket ${socketId} is not connected`);
        }

        const u8 = extractBytesFromJava(dataBytes, off, len);
        state.ws.send(u8);
    },

    async Java_pl_zb3_freej2me_bridge_network_SocketBridge_close(lib, socketId) {
        const state = activeSockets.get(socketId);
        if (state) {
            state.close();
            activeSockets.delete(socketId);
        }
    }
};
