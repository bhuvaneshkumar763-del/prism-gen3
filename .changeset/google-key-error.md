---
"prism-gen3": patch
---

**A dead Google key now says so.** When Google's free key stops working, the bubble says the free key isn't working, gives Google's reason, and points to the Google Cloud provider in Settings as the way to keep translating. It used to say only "The translation service rejected the request (HTTP 400)."

Google answers a bad key with HTTP 400 "API key not valid", not 401/403, so Prism never fetched a new key in that case. It now does, while a 400 for any other reason (a malformed request) leaves the key alone. Google's reason text was also being dropped, because its errors come back as `[code, "message"]` rather than `{error: {message}}`; it is now read.
