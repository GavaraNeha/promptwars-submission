# Security Notes — Smart Bharat Civic Assistant

This document describes the security architecture, known trade-offs, and
recommended mitigations for the Smart Bharat application.

---

## API Key Exposure (Client-Side Architecture)

Smart Bharat is a **client-side SPA** deployed on static hosting (Vercel /
Firebase Hosting). Both the **Gemini API key** and the **Firebase config** are
bundled into the JavaScript that runs in the user's browser.

### Why this is acceptable for Firebase

Firebase API keys are **not secrets** — they are project identifiers. Security
is enforced by **Firestore Security Rules** (see `firestore.rules`), not by
hiding the key. This is Google's [recommended architecture][1] for web apps.

### Why the Gemini API key needs extra care

The Gemini API key **is** a secret — anyone who extracts it from the JS bundle
can call the API on your quota. Mitigations:

| Mitigation | Status |
|---|---|
| **API key restrictions** in Google Cloud Console (HTTP referrer, IP) | ⚠️ Recommended — set up manually |
| **Quota / rate limits** in Google Cloud Console | ⚠️ Recommended — set up manually |
| **Client-side rate limiting** (debounce, cooldown) | ✅ Implemented in App.jsx |
| **Move to a backend proxy** (Cloud Function / Edge Function) | 🔜 Recommended for production |

> **For production deployments**, create a thin Cloud Function or Vercel Edge
> Function that proxies Gemini requests. This keeps the API key server-side.

[1]: https://firebase.google.com/docs/projects/api-keys

---

## Input Sanitization

All user text is sanitized through `src/utils/sanitize.js` before reaching
the Gemini API or Firestore:

- **HTML tag stripping** — removes `<script>`, `<img onerror>`, etc.
- **Control character removal** — strips C0 control codes (except newlines/tabs)
- **Length enforcement** — chat queries capped at 1,000 chars; Firestore fields
  capped individually (query: 1000, title: 200, description: 2000)
- **Tracking ID format validation** — must match `SB-[A-Z0-9]{6}` exactly
- **Gemini safety settings** — `HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE` on
  all harm categories

---

## Firestore Security Rules

The file `firestore.rules` enforces:

1. **Read**: Any user can look up a complaint by its tracking ID (2.2B possible
   combinations provide security-through-obscurity, similar to Google Docs
   shareable links).
2. **Create**: Validated field schema — all required fields must exist, status
   must be `"Submitted"`, category and language must be from allowed sets,
   string lengths are capped.
3. **Update**: Only the `status` field can be changed, and only to valid values.
4. **Delete**: Blocked entirely from client.
5. **Default deny**: All other collections are locked.

### Deploying the rules

```bash
# If you have the Firebase CLI installed:
firebase deploy --only firestore:rules
```

Or paste the contents of `firestore.rules` into the Firebase Console →
Firestore → Rules tab.

---

## Console Logging

Production-sensitive data is **not** logged to the browser console:
- Gemini raw responses are logged at `debug` level only
- API keys and Firebase config are never logged
- Errors are caught and surfaced to the user as friendly messages

---

## Recommendations for Production

1. **Restrict the Gemini API key** in Google Cloud Console to your domain.
2. **Set up App Check** on Firebase to verify requests come from your app.
3. **Move Gemini calls to a backend proxy** to keep the key server-side.
4. **Add Firebase Authentication** if you want per-user complaint tracking.
5. **Enable Cloud Audit Logging** for Firestore to monitor abuse.
