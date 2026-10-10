// ============================================================================
// FreeJ2ME Web - HTTP CORS Proxy Bridge
// Enables J2ME MIDlets to execute HTTP/HTTPS requests through the proxy.
// ============================================================================

function getHttpProxyBase() {
    const custom = localStorage.getItem('j2me_custom_proxy');
    if (custom) {
        return custom.startsWith('http') ? custom.replace(/\/$/, '') : `https://${custom.replace(/\/$/, '')}`;
    }
    const isLocalBackend = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && location.port === '7860';
    if (isLocalBackend) {
        return location.origin;
    }
    return 'https://wines-compared-ending-intake.trycloudflare.com';
}

export default {
    async Java_pl_zb3_freej2me_bridge_network_HttpBridge_getProxiedUrl(lib, url) {
        if (!url) return "";
        if (url.includes('/http-proxy?url=')) return url;
        const base = getHttpProxyBase();
        return `${base}/http-proxy?url=${encodeURIComponent(url)}`;
    },

    async Java_pl_zb3_freej2me_bridge_network_HttpBridge_execute(lib, url, method, reqHeaders, reqBody) {
        const base = getHttpProxyBase();
        const proxyUrl = `${base}/http-proxy?url=${encodeURIComponent(url)}`;
        
        const headers = {
            'Bypass-Tunnel-Reminder': 'true'
        };
        if (reqHeaders && reqHeaders.length) {
            for (let i = 0; i < reqHeaders.length; i += 2) {
                headers[reqHeaders[i]] = reqHeaders[i + 1];
            }
        }

        const options = {
            method: method || 'GET',
            headers: headers
        };

        if (reqBody && reqBody.length && method !== 'GET' && method !== 'HEAD') {
            options.body = reqBody;
        }

        const res = await fetch(proxyUrl, options);
        const resBody = await res.arrayBuffer();
        
        const headerPairs = [];
        res.headers.forEach((v, k) => {
            headerPairs.push(k, v);
        });

        return {
            status: res.status,
            statusText: res.statusText,
            headers: headerPairs,
            data: new Uint8Array(resBody)
        };
    }
};
