# CSB User Registration & Phone Verification Plan

## Context

Add a complete secure user registration, email verification, phone verification, and Custom Mode access control system to Chat Shit Bob. This enables per-user Custom Mode functionality with strong security guarantees.

## Existing Patterns to Reuse

- **SQLite + migrations**: `lib/migrations.js`, `migrations/*.sql`, `lib/sqlite.js` (parameterized queries)
- **Rate limiting**: `lib/rateLimitStore.js` with `createRateLimitStore()`
- **HMAC tokens**: `app.js` `generatePageToken()` pattern for session tokens
- **Repository pattern**: `lib/repositories/` factory functions
- **Frontend overlay**: `setDisplay()` toggle pattern (no routing framework)
- **Security headers**: Already applied globally in `app.js`

## Dependencies (Confirmed)

- `bcrypt` — password hashing with cost factor 12
- `nodemailer` — email OTP delivery (configured via env: MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS)
- `libphonenumber-js` — strict E.164 phone validation

No zero-dependency fallback needed — all three are explicitly approved.

## Phase 1: Database Schema

**Migration `009_users.sql`**
```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  phone_number TEXT NOT NULL DEFAULT '',
  phone_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL DEFAULT '',
  first_login_completed INTEGER NOT NULL DEFAULT 0,
  custom_mode_access_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  last_login_at TEXT NOT NULL DEFAULT '',
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  account_locked_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
```

**Migration `010_otps.sql`**
```sql
CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  otp_type TEXT NOT NULL DEFAULT 'email_verification',
  otp_hash TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  attempts_count INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_otps_user_type ON otps(user_id, otp_type);
CREATE INDEX IF NOT EXISTS idx_otps_expires ON otps(expires_at);
```

**Migration `011_sessions.sql`**
```sql
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
```

## Phase 2: Backend — Repositories

### `lib/repositories/userRepository.js`
Factory returning:
- `createUser({ fullName, email, phone, passwordHash })`
- `findByEmail(email)`
- `findById(id)`
- `markEmailVerified(id)`
- `markPhoneVerified(id)`
- `updateLastLogin(id)`
- `incrementFailedLogin(id)`
- `lockAccount(id, until)`
- `isAccountLocked(id)`
- `updateFirstLogin(id)`
- `enableCustomMode(id)`

### `lib/repositories/otpRepository.js`
Factory returning:
- `createOtp({ userId, type, hash, expiresAt })`
- `findValidOtp(userId, type)`
- `consumeOtp(id)`
- `incrementAttempts(id)`
- `pruneExpired()`

### `lib/repositories/sessionRepository.js`
Factory returning:
- `createSession({ userId, tokenHash, expiresAt })`
- `findByTokenHash(hash)`
- `deleteByTokenHash(hash)`
- `deleteExpired()`
- `deleteByUser(userId)`

## Phase 3: Backend — Services

### `lib/authService.js`
- `hashPassword(password)` — bcrypt with salt rounds 12
- `verifyPassword(password, hash)`
- `generateSessionToken()` — `crypto.randomBytes(32).toString('hex')`
- `hashToken(token)` — SHA-256 for storage
- `generateOtp()` — `crypto.randomInt(100000, 999999).toString()`
- `hashOtp(otp)` — SHA-256 with a pepper from env
- `validatePasswordPolicy(password)` — regex check for 8+, upper, lower, number, special
- `validateEmail(email)` — regex
- `validatePhone(phone)` — E.164 regex or libphonenumber
- `validateName(name)` — 4+ alphanumeric, no special chars
- `sendEmailOtp(email, otp)` — nodemailer or mock transport
- `sendSmsOtp(phone, otp)` — configurable SMS gateway or mock

### `lib/middleware/authMiddleware.js`
- `requireAuth(req, res, next)` — reads `Authorization: Bearer <token>`, verifies session, attaches `req.user`
- `requirePhoneVerified(req, res, next)` — returns 403 if `phone_verified = false`
- `requireCustomModeAccess(req, res, next)` — returns 403 if `custom_mode_access_enabled = false`

## Phase 4: Backend — API Endpoints

All POST endpoints use `publicLimiter` + `requireKnownOrigin` + dedicated rate limiters.

| Method | Path | Auth | Rate Limit | Purpose |
|--------|------|------|------------|---------|
| POST | `/api/auth/register` | none | `registerLimiter` (5/15min per IP) | Create account, send email OTP |
| POST | `/api/auth/verify-email` | none | `otpVerifyLimiter` (5/15min) | Verify email OTP |
| POST | `/api/auth/resend-email-otp` | none | `otpResendLimiter` (3/15min) | Resend email OTP |
| POST | `/api/auth/login` | none | `loginLimiter` (10/15min per IP) | Authenticate, return session token |
| POST | `/api/auth/logout` | Bearer | — | Delete session |
| GET | `/api/auth/me` | Bearer | — | Return current user + verification status |
| POST | `/api/auth/verify-phone` | Bearer | `otpVerifyLimiter` | Verify phone OTP |
| POST | `/api/auth/resend-phone-otp` | Bearer | `otpResendLimiter` | Resend phone OTP |

**Auth enforcement (entire app):**
- `GET /api/config` — include `user: { id, name, emailVerified, phoneVerified, customModeEnabled }` if session exists
- ALL existing endpoints get `requireAuth` middleware except `/api/config`, `/api/auth/*`, and `/api/health`
- Frontend: entire arena is hidden behind auth overlay until logged in
- Custom Mode is additionally protected by `requirePhoneVerified` middleware
- Frontend Custom Mode UI is hidden when `user.phoneVerified === false`

## Phase 5: Frontend — Auth UI

### New HTML in `public/index.html`
Fixed overlay `#authOverlay` (z-index above everything):
- **Registration view**: name, email, password, confirm password, phone inputs + validation messages
- **Email OTP view**: 6-digit code input + resend button
- **Login view**: email + password
- **Phone OTP view**: 6-digit code input + resend button (shown after first login)

### New JS in `public/app.js`
- `initAuth()` — check `/api/auth/me`, show overlay if unauthenticated
- `register()`, `verifyEmailOtp()`, `login()`, `verifyPhoneOtp()`
- `resendEmailOtp()`, `resendPhoneOtp()`
- Input validators (frontend mirror of backend rules)
- `attachAuthHeader()` — add `Authorization: Bearer <token>` to all API calls if logged in
- Session token stored in `localStorage` (`csb_session_token`)

### Custom Mode integration
- `setMode('custom')` checks `currentUser.phoneVerified`; if false, shows phone verification overlay
- `getActiveCriteria()` and judge calls already protected by backend middleware

## Phase 6: Security & Logging

- **Password hashing**: bcrypt with cost factor 12 (or `crypto.scrypt` if zero-dependency required)
- **OTP hashing**: SHA-256 with env `OTP_PEPPER` before storage
- **Session tokens**: 32-byte random, hashed before DB storage, 24h expiry
- **Rate limiting**: Per-IP for registration/login, per-user for OTP verify/resend
- **Generic errors**: "Invalid credentials" for login failures, "Unable to send" for email/SMS errors
- **Security events logged**: failed login, OTP exhausted, account lock, suspicious registration patterns
- **CSRF**: `X-Page-Token` already required on POSTs; session endpoints add `requireKnownOrigin`
- **No enumeration**: Registration returns generic success even if email exists (but don't create duplicate)

## Phase 7: Tests

New test files:
- `test/auth.test.js` — registration validation, email OTP flow, login, phone OTP flow, session expiry
- `test/authMiddleware.test.js` — `requireAuth`, `requirePhoneVerified`, token validation
- `test/userRepository.test.js` — CRUD, verification flags, account locking
- `test/otpRepository.test.js` — create, verify, expiry, attempt limits

All existing 59 tests must still pass.

## Critical Files to Modify

| File | Change |
|------|--------|
| `migrations/009_users.sql` | New |
| `migrations/010_otps.sql` | New |
| `migrations/011_sessions.sql` | New |
| `lib/repositories/userRepository.js` | New |
| `lib/repositories/otpRepository.js` | New |
| `lib/repositories/sessionRepository.js` | New |
| `lib/authService.js` | New |
| `lib/middleware/authMiddleware.js` | New |
| `lib/config.js` | Add auth env vars |
| `app.js` | Add auth endpoints, protect Custom Mode |
| `public/index.html` | Add auth overlay |
| `public/app.js` | Auth UI + session handling + Custom Mode guards |
| `test/auth.test.js` | New |
| `test/authMiddleware.test.js` | New |
| `package.json` | Add bcrypt, nodemailer |

## Verification

1. Run all tests: `NODE_ENV=test node --test` (existing + new)
2. Manual flow test via Interceptor:
   - Register → receive email OTP → verify → login → receive phone OTP → verify → access Custom Mode
   - Attempt Custom Mode without phone verification → expect 403
3. Security checks:
   - Brute-force login blocked by rate limiter
   - Expired OTP rejected
   - Weak password rejected
   - Invalid email format rejected
   - Session token invalid after logout

## Decisions Made

1. **Password hashing**: `bcrypt` with cost factor 12
2. **Phone validation**: `libphonenumber-js` for strict E.164
3. **Auth scope**: Entire app requires login (not just Custom Mode)
4. **Email/SMS delivery**: Real SMTP + SMS gateway via environment variables (`MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `SMS_API_KEY`)
