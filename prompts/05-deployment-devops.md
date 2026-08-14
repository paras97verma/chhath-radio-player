# CHHATH RADIO — Deployment & DevOps Specification

## 1. Deployment Architecture

Recommended:

```text
Internet
   │
   ▼
Reverse Proxy / CDN
   │
   ├── Next.js
   │
   └── FastAPI
          │
          ▼
      PostgreSQL
```

---

# 2. Environments

Maintain:

```text
development
staging
production
```

Never use production credentials locally.

---

# 3. Environment Variables

Provide:

```text
.env.example
```

Example categories:

```text
DATABASE_URL=
SECRET_KEY=
PUBLIC_BASE_URL=
APP_ENV=
```

Never commit real secrets.

---

# 4. Docker

Provide Dockerfiles for:

```text
frontend
backend
```

and a development:

```text
docker-compose.yml
```

if useful.

---

# 5. Local Development

A new developer should be able to:

```bash
git clone ...
cp .env.example .env
docker compose up
```

or follow a documented equivalent.

---

# 6. Database

Production:

```text
PostgreSQL
```

Migrations:

```bash
alembic upgrade head
```

Never manually modify production schema.

---

# 7. CI

CI should run:

```text
lint
typecheck
unit tests
backend tests
database migration test
build
Playwright
accessibility
```

---

# 8. Build

Frontend production build must complete successfully.

Backend must start successfully.

---

# 9. Health Checks

Implement:

```text
GET /health
GET /health/ready
```

`/health` should verify application process health.

`/health/ready` may verify required dependencies such as PostgreSQL.

---

# 10. Logging

Use structured logs.

Include:

```text
timestamp
level
request_id
endpoint
status
duration
```

Never log:

- passwords
- secrets
- authorization headers
- private tokens

---

# 11. Monitoring

Minimum:

- uptime monitoring
- application error logging
- database health
- API latency

Optional:

- Sentry
- OpenTelemetry
- Grafana

Only add complexity when useful.

---

# 12. Backups

Production PostgreSQL must have automated backups.

Define:

- backup frequency
- retention
- restore procedure

A backup is not considered valid until restore testing is performed periodically.

---

# 13. Database Migration Safety

Before production migration:

```text
backup
→ staging migration
→ tests
→ production migration
```

Avoid destructive migrations without a rollback/recovery strategy.

---

# 14. CDN

Static assets should be CDN-friendly.

Do not proxy YouTube media through your infrastructure.

---

# 15. HTTPS

Production must use HTTPS.

Redirect HTTP to HTTPS.

---

# 16. Security Headers

Configure appropriate headers such as:

```text
Content-Security-Policy
X-Content-Type-Options
Referrer-Policy
Strict-Transport-Security
```

CSP must permit the official YouTube embed/API domains required by the implementation.

Do not blindly copy an incompatible CSP.

---

# 17. CORS

Restrict backend CORS to known frontend origins.

Do not use:

```text
Access-Control-Allow-Origin: *
```

for authenticated admin APIs.

---

# 18. Rate Limiting

Consider rate limits for:

- admin login
- admin mutations
- expensive public endpoints

Do not make normal radio usage frustrating.

---

# 19. Deploy Process

Recommended:

```text
commit
 ↓
CI
 ↓
staging
 ↓
smoke tests
 ↓
production
 ↓
production smoke
```

---

# 20. Rollback

Document how to:

- rollback frontend
- rollback backend
- recover database
- disable problematic songs

A bad deployment should be reversible.

---

# 21. Song Emergency Controls

Admin should be able to quickly disable a broken/unavailable song without redeploying the application.

---

# 22. Production Smoke Test

After deployment:

```text
homepage
API health
catalog
player initialization
play
queue
channel
Ghat Mode
mobile
```

must be verified.

---

# 23. Domain

Production should use a clean dedicated domain.

Example concept:

```text
chhathradio.example
```

Use the final chosen domain consistently across:

- canonical URLs
- metadata
- API configuration
- sharing

---

# 24. DevOps Principle

Infrastructure should remain boring.

Spend complexity budget on:

- user experience
- reliable playback
- beautiful 3D atmosphere

not unnecessary infrastructure.
