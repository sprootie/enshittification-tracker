const net = require('net');
const dns = require('dns');
const { SocksClient } = require('socks');

// Creates a local unauthenticated SOCKS5 proxy that forwards
// connections through an upstream authenticated SOCKS5 proxy.
// This is needed because Chromium doesn't support SOCKS5 auth.

let server = null;
let localPort = 0;

/**
 * Parse a SOCKS5 proxy URL into components.
 * e.g. "socks5://user:pass@host:port" → { host, port, userId, password }
 */
function parseProxyUrl(proxyUrl) {
  const url = new URL(proxyUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 1080,
    userId: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

/**
 * Start a local SOCKS5 proxy on a random port that forwards
 * through the given upstream proxy. Returns the local port.
 */
function start(upstreamProxyUrl) {
  return new Promise((resolve, reject) => {
    const upstream = parseProxyUrl(upstreamProxyUrl);

    server = net.createServer((clientSocket) => {
      // Minimal SOCKS5 server implementation
      clientSocket.once('data', (greeting) => {
        // Client greeting — respond with "no auth required"
        clientSocket.write(Buffer.from([0x05, 0x00]));

        clientSocket.once('data', async (request) => {
          // Parse SOCKS5 connect request
          const cmd = request[1]; // 0x01 = CONNECT
          const addrType = request[3];
          let destHost, destPort;

          if (addrType === 0x01) {
            // IPv4
            destHost = `${request[4]}.${request[5]}.${request[6]}.${request[7]}`;
            destPort = request.readUInt16BE(8);
          } else if (addrType === 0x03) {
            // Domain name
            const len = request[4];
            destHost = request.slice(5, 5 + len).toString();
            destPort = request.readUInt16BE(5 + len);
          } else if (addrType === 0x04) {
            // IPv6
            destHost = Array.from(request.slice(4, 20)).map(b => b.toString(16).padStart(2, '0')).join(':');
            destPort = request.readUInt16BE(20);
          } else {
            clientSocket.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0,0,0,0, 0,0]));
            return;
          }

          if (cmd !== 0x01) {
            clientSocket.end(Buffer.from([0x05, 0x07, 0x00, 0x01, 0,0,0,0, 0,0]));
            return;
          }

          try {
            // Resolve hostname to IP locally (PIA requires pre-resolved IPs)
            let resolvedHost = destHost;
            if (net.isIP(destHost) === 0) {
              try {
                const addrs = await dns.promises.resolve4(destHost);
                if (addrs.length > 0) resolvedHost = addrs[0];
              } catch {}
            }

            // Connect through the upstream authenticated SOCKS5 proxy
            const { socket: upstreamSocket } = await SocksClient.createConnection({
              proxy: {
                host: upstream.host,
                port: upstream.port,
                type: 5,
                userId: upstream.userId,
                password: upstream.password,
              },
              command: 'connect',
              destination: { host: resolvedHost, port: destPort },
              timeout: 15000,
            });

            // Send success response to client
            const reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0,0,0,0, 0,0]);
            clientSocket.write(reply);

            // Pipe bidirectionally
            clientSocket.pipe(upstreamSocket);
            upstreamSocket.pipe(clientSocket);

            clientSocket.on('error', () => upstreamSocket.destroy());
            upstreamSocket.on('error', () => clientSocket.destroy());
            clientSocket.on('close', () => upstreamSocket.destroy());
            upstreamSocket.on('close', () => clientSocket.destroy());
          } catch (err) {
            // Connection failed
            const reply = Buffer.from([0x05, 0x05, 0x00, 0x01, 0,0,0,0, 0,0]);
            clientSocket.end(reply);
          }
        });
      });

      clientSocket.on('error', () => {});
    });

    server.listen(0, '127.0.0.1', () => {
      localPort = server.address().port;
      resolve(localPort);
    });

    server.on('error', reject);
  });
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
}

function getLocalProxy() {
  return localPort ? `socks5://127.0.0.1:${localPort}` : null;
}

module.exports = { start, stop, getLocalProxy };
