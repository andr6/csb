# OAuth Sign-In Plan — Google, Facebook, Instagram

## Context

Add OAuth 2.0 social sign-in so users can authenticate with Google, Facebook, or Instagram instead of (or in addition to) email/password. This lowers friction for new users and is a standard expectation for modern apps.

## Design Decisions

1. **Zero new runtime dependencies.** Implement OAuth 2.0 authorization-code flow manually using Node's built-in `https` module. This avoids pulling in Passport and provider-specific packages. The exchange logic is ~80 lines per provider.
2. **Phone verification still required.** OAuth grants identity, not a verified phone number. OAuth users must still complete phone OTP before Custom Mode is unlocked. This preserves the existing security model.
3. **Linking, not parallel auth.** If an OAuth account's email matches an existing local account, we link them (same user row). Otherwise we create a new user with an empty password_hash.
4. **Instagram uses Basic Display API.** It returns only `user_id` and `username` — no email. For Instagram we generate a placeholder email and require the user to update it via account settings before phone verification.

## Database Changes

**Migration `014_oauth.sql`**
```sql
ALTER TABLE users ADD COLUMN oauth_provider TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN oauth_subject TEXT DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_subject) WHERE oauth_provider != '';
```

## Backend Changes

### `lib/config.js`
Add OAuth environment variables:
```js
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
const FACEBOOK_APP_ID = String(process.env.FACEBOOK_APP_ID || "").trim();
const FACEBOOK_APP_SECRET = String(process.env.FACEBOOK_APP_SECRET || "").trim();
const INSTAGRAM_APP_ID = String(process.env.INSTAGRAM_APP_ID || "").trim();
const INSTAGRAM_APP_SECRET = String(process.env.INSTAGRAM_APP_SECRET || "").trim();
const OAUTH_REDIRECT_BASE = String(process.env.OAUTH_REDIRECT_BASE || "").trim();
```

### `lib/repositories/userRepository.js`
Add methods:
- `findByOAuth(provider, subject)` — look up user by OAuth pair
- `linkOAuth(id, provider, subject)` — attach OAuth credentials to existing user
- `createOAuthUser({ fullName, email, provider, subject })` — create user with empty password_hash

### `lib/oauthService.js` (new)
Handles the OAuth 2.0 dance for all three providers:
- `buildGoogleAuthUrl(state, redirectUri)` → returns Google's OAuth consent URL
- `exchangeGoogleCode(code, redirectUri)` → POST to token endpoint, then GET userinfo
- Same pattern for Facebook and Instagram
- Returns normalized `{ provider, subject, email, fullName, picture }`

### `app.js` — new endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/auth/oauth/:provider/start` | none | Redirects to provider consent screen with PKCE-like state |
| GET | `/api/auth/oauth/:provider/callback` | none | Exchanges code for token, fetches profile, creates/links user, issues session |

Callback flow:
1. Validate `state` against the stored value (5-minute TTL in-memory Map)
2. Exchange `code` for access token via provider token endpoint
3. Fetch user profile from provider userinfo endpoint
4. If `email` returned: find existing user by email → link OAuth if not already linked → issue session
5. If no email (Instagram): create user with placeholder email `instagram_{subject}@oauth.local` → user must update email in account settings
6. Return HTML that posts the session token to the parent window and closes the popup

### `lib/middleware/authMiddleware.js`
No changes — OAuth users get sessions the same way local users do.

## Frontend Changes

### `public/index.html`
Add OAuth buttons to the login and register views:
```html
<div class="auth-oauth">
  <div class="auth-oauth-sep"><span>or</span></div>
  <button class="auth-oauth-btn google" onclick="startOAuth('google')">Sign in with Google</button>
  <button class="auth-oauth-btn facebook" onclick="startOAuth('facebook')">Sign in with Facebook</button>
  <button class="auth-oauth-btn instagram" onclick="startOAuth('instagram')">Sign in with Instagram</button>
</div>
```

Add CSS for OAuth button styling (matching existing dark theme, provider brand colors as borders).

### `public/app.js`
Add functions:
- `startOAuth(provider)` — opens a centered popup to `/api/auth/oauth/${provider}/start`, polls for completion
- `handleOAuthCallback(token, user)` — receives token from popup, stores in localStorage, sets `_currentUser`, refreshes page
- `checkOauthPopupResult()` — reads `?oauth_token=...&oauth_user=...` from URL on page load (for popup close-and-redirect flow)

The popup flow:
1. `startOAuth('google')` opens `window.open('/api/auth/oauth/google/start', 'oauth', 'width=500,height=600')`
2. Provider redirects back to callback endpoint
3. Callback endpoint renders a small HTML page that calls `window.opener.postMessage({ token, user }, '*')` then `window.close()`
4. Parent window listens for `message` event, extracts token, calls `handleOAuthCallback`

## Environment Variables Required

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `FACEBOOK_APP_ID` | Facebook App ID |
| `FACEBOOK_APP_SECRET` | Facebook App secret |
| `INSTAGRAM_APP_ID` | Instagram Basic Display App ID |
| `INSTAGRAM_APP_SECRET` | Instagram Basic Display App secret |
| `OAUTH_REDIRECT_BASE` | Base URL for callbacks, e.g. `https://chatshitbob.com` |

If any provider's credentials are missing, its button is hidden automatically.

## Verification

1. Run all tests: `NODE_ENV=test node --test` (existing tests should still pass — auth middleware mock covers OAuth)
2. Manual test with Interceptor:
   - Open app with no OAuth env vars → buttons should not appear
   - Set Google credentials → click "Sign in with Google" → verify popup opens to Google consent screen
   - Complete OAuth flow → verify user is logged in, session token stored
   - Verify phone verification overlay still appears for OAuth users
   - Verify linking: create local account with email X, then OAuth with same email X → should link to same user

## Critical Files to Modify

| File | Change |
|------|--------|
| `migrations/014_oauth.sql` | New — oauth columns |
| `lib/config.js` | Add OAuth env vars |
| `lib/repositories/userRepository.js` | Add OAuth lookup/link methods |
| `lib/oauthService.js` | New — provider exchange logic |
| `app.js` | Add `/api/auth/oauth/*` endpoints |
| `public/index.html` | Add OAuth buttons to auth overlay |
| `public/app.js` | Add popup flow and callback handling |
| `test/auth.test.js` | Add OAuth callback tests |
