# Production Runbook

This app is a single Node.js process that serves both the frontend and the JSON API. In production behind Apache, Apache should terminate TLS and reverse proxy the vhost to the local Node process.

## Assumptions

- Apache is already running and the target vhost already exists.
- The code is deployed at `/opt/csb`.
- You will run the Node app locally on the same host, typically on `127.0.0.1:3000`.
- Node.js `18+` and `npm` are installed.

## 1. Prepare The App

```bash
cd /opt/csb/app
cp env.example .env
```

Edit `/opt/csb/app/.env` and set at least:

- `PORT=3000`
- `ALLOWED_ORIGINS=https://your-domain.example`
- provider API keys
- active contestant and judge model settings

Recommended production values:

```env
PORT=3000
ALLOWED_ORIGINS=https://your-domain.example
HTTP_TIMEOUT_MS=15000
```

If you use the analytics cost and policy features, also set the optional `MODEL_PRICE_*`, `JUDGE_PRICE_USD`, `ANALYTICS_*_BUDGET_USD`, and `ANALYTICS_POLICY_*` variables.

## 2. Install Dependencies

```bash
cd /opt/csb/app
npm ci --omit=dev
```

## 3. Launch The App

Use the production launcher from the repo root:

```bash
/opt/csb/scripts/run-prod.sh
```

Or through npm:

```bash
cd /opt/csb/app
npm run start:prod
```

The launcher:

- loads `/opt/csb/app/.env`
- creates `app/data` and `app/logs` if missing
- installs production dependencies if `node_modules` is missing
- validates that Node.js is version `18+`
- starts `node server.js`

Optional overrides:

```bash
CSB_ENV_FILE=/secure/path/csb.env /opt/csb/scripts/run-prod.sh
CSB_SKIP_INSTALL=1 /opt/csb/scripts/run-prod.sh
NODE_BIN=/usr/bin/node NPM_BIN=/usr/bin/npm /opt/csb/scripts/run-prod.sh
```

## 4. Apache Reverse Proxy

Enable the required modules if they are not already enabled:

```bash
a2enmod proxy proxy_http headers rewrite
systemctl reload apache2
```

Inside the existing vhost, proxy all traffic to the local Node process:

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
RequestHeader set X-Forwarded-Port "443"

ProxyPass / http://127.0.0.1:3000/
ProxyPassReverse / http://127.0.0.1:3000/
```

If the app lives under a subpath like `/csb/` instead of the vhost root, use:

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
RequestHeader set X-Forwarded-Port "443"

ProxyPass /csb/ http://127.0.0.1:3000/
ProxyPassReverse /csb/ http://127.0.0.1:3000/
```

Then reload Apache:

```bash
systemctl reload apache2
```

## 5. Keep The App Running

The clean production setup is a systemd service. Example unit:

```ini
[Unit]
Description=Chat Shit Bob
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/csb/app
ExecStart=/opt/csb/scripts/run-prod.sh
Restart=always
RestartSec=5
User=www-data
Group=www-data
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Save it as `/etc/systemd/system/chat-shit-bob.service`, then:

```bash
systemctl daemon-reload
systemctl enable --now chat-shit-bob
systemctl status chat-shit-bob
```

## 6. Verify

Local process:

```bash
curl -I http://127.0.0.1:3000/
curl http://127.0.0.1:3000/api/stats
```

Through Apache:

```bash
curl -I https://your-domain.example/
curl https://your-domain.example/api/stats
```

## 7. Operational Notes

- Persisted app data is stored in `/opt/csb/app/data`.
- If `sqlite3` is available at runtime, the app prefers SQLite at `app/data/csb.sqlite`.
- If `sqlite3` is unavailable, the app falls back to JSON files in `app/data/`.
- `ALLOWED_ORIGINS` should match the public Apache vhost hostname, not `localhost`.
- If you rotate `.env`, restart the Node process or systemd service.

## 8. Common Failures

- `Environment file not found`
  Create `/opt/csb/app/.env` first.

- `Node.js 18+ is required`
  Upgrade Node before launching.

- Browser requests blocked by CORS
  Set `ALLOWED_ORIGINS` to the exact HTTPS origin served by Apache.

- Apache returns `502` or `503`
  The Node process is not running or is not listening on the configured `PORT`.
