# 🔐 Auth Gateway

A small authentication gateway that sits in front of your applications. You
register an app, create users, grant access per user-per-app, and hand out an
authorize URL. The gateway authenticates the user and redirects them back to
the app's registered callback with `auth=success` or `auth=failed`.

![Auth Gateway](https://img.shields.io/badge/Auth%20Gateway-Access%20Control-blue?style=for-the-badge&logo=shield)
![Node.js](https://img.shields.io/badge/Node.js-22-green?style=for-the-badge&logo=nodedotjs)
![Docker](https://img.shields.io/badge/Docker-Ready-blue?style=for-the-badge&logo=docker)
![SQLite](https://img.shields.io/badge/Database-SQLite-lightblue?style=for-the-badge&logo=sqlite)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

---

## 🔒 Security

This project was hardened after an initial public release, and the hardening is
covered by the smoke tests so it cannot silently regress. Highlights:

| Area | What it does |
|------|--------------|
| **Admin bootstrap** | No default `admin`/`admin`. The admin is created on first boot from `ADMIN_PASSWORD`, or a strong one-time password is generated and printed to the container log. The server refuses to start on the known public `SESSION_SECRET`. |
| **Session secret** | `SESSION_SECRET` is required and must be ≥ 32 characters. |
| **Open redirect** | Callback `redirect_uri` must exactly match a registered URI. Protocol-relative (`//evil.tld`) and look-alike values are rejected. Existing query strings on a registered callback are preserved. |
| **Proxy awareness** | `TRUST_PROXY` is coerced to a number, so the session cookie gets `Secure` over TLS and the auth log records the real client IP instead of the proxy. |
| **Sessions** | `httpOnly`, `sameSite=lax`, `Secure` over TLS, rolling 24h expiry, SQLite-backed store. |
| **Rate limiting** | Per-IP failed sign-in limits for both the admin and end-user forms. |
| **CSRF / headers** | Same-origin check on state-changing requests, plus CSP, `X-Frame-Options: DENY`, `nosniff`, and `Referrer-Policy`. |
| **Secrets** | Client secrets are stored per app, can be revealed/copied/rotated from the UI, and passwords are bcrypt-hashed. |
| **Integrity** | Every backup is verified by opening the copied file and comparing row counts — never by trusting the source. |

---

## 📸 Screenshots

| Admin login | Dashboard |
|---|---|
| ![Admin login](screenshots/admin-login.png) | ![Dashboard](screenshots/dashboard.png) |

| Users | Apps |
|---|---|
| ![Users](screenshots/users.png) | ![Apps](screenshots/apps.png) |

| Logs | End-user login |
|---|---|
| ![Logs](screenshots/logs.png) | ![User login](screenshots/user-login.png) |

---

## 🚀 Quick Start (Docker)

1. **Configure:**
   ```bash
   git clone https://github.com/Ferns1992/auth-app.git
   cd auth-app
   cp .env.example .env
   # Generate a session secret and paste it into .env:
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   # Optionally set ADMIN_PASSWORD; leave it blank to have one generated and
   # printed in the container log on first boot.
   ```

2. **Run:**
   ```bash
   docker compose up -d --build
   ```

3. **Open** the admin panel at `http://localhost:4040/admin/login` and sign in
   with the admin credentials you configured.

> The admin account is created only on first boot. If you did not set
> `ADMIN_PASSWORD`, grab the generated one from `docker compose logs auth-gateway`.

---

## ⚙️ Configuration

All settings are environment variables (see `.env.example`).

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_SECRET` | *(required)* | ≥ 32 chars. Signs session cookies. Must not be the public placeholder. |
| `ADMIN_USERNAME` | `admin` | Admin username, created on first boot only. |
| `ADMIN_PASSWORD` | *(generated)* | Admin password. Blank ⇒ a strong one-time password is generated and logged. |
| `PORT` | `4040` | HTTP port. |
| `DATA_DIR` | `./data` | Where `auth-gateway.db` and `sessions.db` live. |
| `SESSION_TTL_HOURS` | `24` | End-user session lifetime. |
| `SECURE_COOKIES` | `auto` | `auto` sets the `Secure` cookie attribute whenever the request arrived over TLS. |
| `TRUST_PROXY` | `1` | Reverse-proxy hops to trust for client IP / protocol detection. |
| `MIN_PASSWORD_LENGTH` | `8` | Enforced for admin-created users. |
| `BCRYPT_ROUNDS` | `10` | Password hashing cost. |
| `RATE_LIMIT_WINDOW_MINUTES` | `15` | Sliding window for failed sign-in limits. |
| `RATE_LIMIT_ADMIN_MAX` | `8` | Max failed admin sign-ins per IP per window. |
| `RATE_LIMIT_USER_MAX` | `10` | Max failed end-user sign-ins per IP per window. |

The public base URL used in generated authorize links is set in the admin panel
(**Apps → Base URL**). Leave it blank to auto-detect from the request.

---

## ☁️ Deploying behind a Cloudflare Tunnel (no public port)

`docker-compose.tunnel.yml` is an overlay that removes the loopback port
publish and joins the `cloudflared_default` Docker network, so the app is
reachable **only** through the tunnel and never directly from the internet:

```bash
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d
```

Point a cloudflared ingress rule at the container by name:

```
authgateway.example.com -> http://auth-gateway:4040
```

Then proxy the hostname in Cloudflare as usual.

---

## 💾 Backups

`deploy/auth-gateway-backup.sh` snapshots the database off the running
container, verifies the copy, compacts it, keeps the newest 14 locally, mirrors
to Cloudflare R2, and reads the newest object back to confirm the round trip.
It runs on the host so the R2 credentials are never reachable from the web app.

```bash
# Install
sudo install -m 750 deploy/auth-gateway-backup.sh /usr/local/bin/auth-gateway-backup.sh
sudo install -m 644 deploy/auth-gateway-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now auth-gateway-backup.timer

# Run once, now
sudo systemctl start auth-gateway-backup.service
journalctl -u auth-gateway-backup.service
```

Requires `sqlite3`, `rclone` (with an `R2:` remote), and `docker` on the host.
Verify a restore by reading an object back and opening it:

```bash
rclone cat R2:auth-gateway-backups/<snapshot>.db > /tmp/restore.db
sqlite3 /tmp/restore.db "PRAGMA integrity_check; SELECT COUNT(*) FROM users;"
```

---

## 🧪 Demo data (development only)

```bash
node scripts/seed-demo.js
```

Creates sample users, apps, grants, and a week of auth logs. The demo callbacks
use the reserved `.invalid` TLD (RFC 2606) so they can never resolve — the demo
password is public, so registering a real subdomain as a demo client would be an
authentication bypass. Delete the demo accounts before using this for anything
real.

---

## 🔗 Integration flow

Send the user to the gateway:

```
https://YOUR_GATEWAY/auth/authorize?client_id=CLIENT_ID&redirect_uri=ENCODED_CALLBACK
```

Optionally append `client_secret=SECRET` to require the app's secret. The
gateway authenticates the user and redirects to the **registered** callback:

```
YOUR_CALLBACK?auth=success&user=USERNAME      # allowed
YOUR_CALLBACK?auth=failed&reason=no_access    # user not granted
```

---

## 🗄️ Database schema

SQLite, stored in `DATA_DIR/auth-gateway.db` (Docker volume
`auth-gateway-data`).

| Table | Description |
|-------|-------------|
| `users` | Admins and end-users (bcrypt password hashes). |
| `apps` | Registered applications: name, `client_id`, `client_secret`, `redirect_uri`. |
| `user_apps` | Which users may access which apps (cascades on delete). |
| `auth_logs` | Every auth/admin attempt: user, app, IP, user-agent, success, event, timestamp. |
| `settings` | Key/value config, e.g. the base URL. |

---

## 🧪 Tests

`agw-test.sh` is a self-contained smoke suite that starts the server in a
throwaway container and asserts the security and flow behaviour (redirect
validation, rate limiting, secure cookies, cascades, icons, and more):

```bash
docker run --rm -v "$PWD:/app" -w /app node:22-bookworm-slim bash agw-test.sh
```

---

## ⚠️ Security notes

- 🔑 There is **no** default password. Set `ADMIN_PASSWORD` or record the
  generated one from the first boot log, then keep it out of version control.
- 🌐 Terminate TLS in front of the app and keep `TRUST_PROXY` matched to your
  real proxy hop count, or client IPs and the `Secure` cookie will be wrong.
- 🚫 Do not register real application callbacks in the demo seeder.
- 💾 Back up `DATA_DIR` (or use the included backup script) to preserve users,
  apps, and grants.
- 🔒 The admin panel is protected by authentication, but you can additionally
  restrict it at the proxy (e.g. Cloudflare Access) if you need.

---

## 🛠️ Tech stack

Node.js 22 · Express · SQLite3 · express-session · bcryptjs · EJS · Bootstrap 5

---

## 📄 License

MIT — free for personal or commercial use.

---

<div align="center">

**Made with ❤️ for straightforward application access control**

[![GitHub](https://img.shields.io/github/stars/Ferns1992/auth-app?style=social)](https://github.com/Ferns1992/auth-app)

</div>
