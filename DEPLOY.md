# Deploying The Enshittifier

## Prerequisites
- Node.js 18+ on your VPS
- Nginx (or Caddy) as reverse proxy
- Cloudflare DNS pointing to your VPS

## Quick Start

```bash
# 1. Upload the enshittifier/ folder to your VPS
scp -r enshittifier/ user@your-vps:/opt/enshittifier

# 2. SSH in and install dependencies
ssh user@your-vps
cd /opt/enshittifier
npm install

# 3. Copy and edit config
cp .env.example .env
nano .env

# 4. Test it
node server.js
# Visit http://your-vps-ip:3000 to verify

# 5. Set up pm2 for production
npm install -g pm2
pm2 start server.js --name enshittifier
pm2 save
pm2 startup  # follow the instructions it prints
```

## Nginx Config

Add this to your Nginx sites config (alongside your existing site):

```nginx
server {
    listen 80;
    server_name enshittifier.net www.enshittifier.net;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 10s;
        proxy_read_timeout 15s;
        proxy_send_timeout 10s;
    }
}
```

Then: `sudo nginx -t && sudo systemctl reload nginx`

Cloudflare will handle SSL termination, so Nginx only needs to listen on port 80.

## Cloudflare Settings

1. **DNS**: A record pointing to your VPS IP, proxy enabled (orange cloud)
2. **SSL/TLS**: Set to "Flexible" (Cloudflare→your VPS is HTTP, browser→Cloudflare is HTTPS)
3. **Caching**:
   - Page Rule: `enshittifier.net/?url=*` → Cache Level: Everything, Edge TTL: 1 hour
   - This caches proxied pages at Cloudflare's edge, massively reducing VPS load
4. **Rate Limiting** (optional): Add a Cloudflare rate limit rule as a second layer
5. **Under Attack Mode**: Available in Security settings if you get DDoS'd

## Monitoring

Check server health:
```bash
curl http://localhost:3000/health
```

Returns JSON with bandwidth usage, cache size, and circuit breaker status.

## Emergency: Circuit Breaker

If traffic gets out of control:

```bash
# Option 1: Environment variable
CIRCUIT_BREAKER=true pm2 restart enshittifier

# Option 2: Edit .env and restart
echo "CIRCUIT_BREAKER=true" >> .env
pm2 restart enshittifier
```

This disables the proxy entirely and only serves the landing page (static, nearly zero cost).

## File Structure

```
enshittifier/
├── server.js          # Node.js proxy server (~250 lines)
├── package.json
├── .env.example       # Config template
├── DEPLOY.md          # This file
└── public/
    ├── index.html     # Landing page + interactive demo
    ├── enshittify.css  # Injected into proxied pages
    └── enshittify.js   # Injected into proxied pages
```

## Cost Estimate

- VPS: $4/mo (Kamatera, already running)
- Bandwidth: $0 (5TB/mo included, daily cap set to 100GB = ~3TB/mo max)
- Cloudflare: $0 (free tier)
- Domain: ~$10/yr for .net
- **Total: ~$4/mo + domain**