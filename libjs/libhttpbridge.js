// ============================================================================
// FreeJ2ME Web - HTTP CORS Proxy Bridge
// Enables J2ME MIDlets to execute HTTP/HTTPS requests through the proxy.
// ============================================================================

export default {
    async Java_pl_zb3_freej2me_bridge_network_HttpBridge_execute(lib, url, method, reqHeaders, reqBody) {
        const proxyUrl = `/http-proxy?url=${encodeURIComponent(url)}`;
        
        const headers = {};
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
