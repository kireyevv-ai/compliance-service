# Staging Deployment

Target: one Russian Ubuntu/Debian-like VPS running the Next.js app, PostgreSQL, and one scan worker.

Do not deploy customer data, evidence, logs, screenshots, or backups outside Russian infrastructure.

## 1. VPS

Minimum practical beta box:

- 2 CPU cores;
- 4 GB RAM;
- 30+ GB disk;
- Ubuntu/Debian-like Linux;
- public domain pointing to the VPS;
- SSH access for the staging admin.

## 2. System packages

Install Node.js 20+ or 22+, PostgreSQL, Nginx, Certbot, and system Chromium.

Example package names may vary by distro:

```bash
sudo apt update
sudo apt install -y postgresql nginx certbot python3-certbot-nginx chromium
node --version
chromium --version
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the system Chromium binary, for example `/usr/bin/chromium`.

## 3. PostgreSQL

Create a staging database and user on the VPS PostgreSQL instance. Keep credentials only in `.env`.

```bash
sudo -u postgres psql
```

Then create the database/user using local admin policy. Do not commit DB credentials.

## 4. Project

Clone or copy the project to the VPS.

```bash
npm ci
```

## 5. Environment

Create `.env` on the VPS:

```bash
DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/DB_NAME
NODE_ENV=production
PORT=3000
DEV_USER_EMAIL=beta@example.local
BETA_ACCESS_PASSWORD=change-this
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
SCAN_WORKER_IDLE_DELAY_MS=2000
SCAN_STALE_RUNNING_THRESHOLD_MS=1800000
```

`BETA_ACCESS_PASSWORD` is the closed beta gate. It is not a user account system.

## 6. Migrations and build

```bash
npm run db:migrate
npm run build
```

## 7. systemd processes

Use two processes: web and worker.

Example web unit:

```ini
[Unit]
Description=RF Compliance MVP web
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/rf-compliance
EnvironmentFile=/opt/rf-compliance/.env
ExecStart=/usr/bin/npm start
Restart=always
User=rfcompliance

[Install]
WantedBy=multi-user.target
```

Example worker unit:

```ini
[Unit]
Description=RF Compliance MVP scan worker
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/rf-compliance
EnvironmentFile=/opt/rf-compliance/.env
ExecStart=/usr/bin/npm run worker
Restart=always
User=rfcompliance

[Install]
WantedBy=multi-user.target
```

Enable both:

```bash
sudo systemctl enable --now rf-compliance-web
sudo systemctl enable --now rf-compliance-worker
sudo systemctl status rf-compliance-web
sudo systemctl status rf-compliance-worker
```

Worker health for closed beta is checked through `systemctl status` and structured worker logs.

On startup the worker marks stale `RUNNING` scans older than `SCAN_STALE_RUNNING_THRESHOLD_MS` as `FAILED`. This is the safer closed-beta choice because a crashed scan may have partial facts/evidence already written.

## 8. Reverse proxy and HTTPS

Recommended path: Nginx in front of Next.js.

```nginx
server {
  server_name staging.example.ru;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Issue HTTPS on the VPS:

```bash
sudo certbot --nginx -d staging.example.ru
```

## 9. Health check

```bash
curl https://staging.example.ru/api/health
```

Expected safe shape:

```json
{"status":"ok"}
```

## 10. Smoke test

1. Open the staging URL over HTTPS.
2. Enter the beta access password.
3. Submit a known validation site with a selected `site_type`.
4. Confirm the scan page starts as `QUEUED` or `RUNNING`.
5. Confirm the worker completes it.
6. Reopen the results URL.
7. Confirm no secrets appear in UI, API responses, or logs.

## 11. Reboot check

```bash
sudo reboot
```

After reconnecting:

```bash
sudo systemctl status rf-compliance-web
sudo systemctl status rf-compliance-worker
curl https://staging.example.ru/api/health
```

## 12. Backups

Use `pg_dump` on the VPS and store backups only in Russian infrastructure.

Example manual backup:

```bash
pg_dump "$DATABASE_URL" > /var/backups/rf-compliance/staging-$(date +%F).sql
```

Schedule it with cron or a systemd timer according to VPS policy. Do not commit backups to Git.

## 13. Data retention

Closed beta currently stores Scan, Facts, Evidence, Findings, and minimal user/site metadata in PostgreSQL.

Screenshot storage is deferred unless explicitly added later. Browser/runtime temporary files should remain temporary and be removed by the OS/browser process lifecycle.
