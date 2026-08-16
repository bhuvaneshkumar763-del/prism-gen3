# `src/platform/`

The browser-API adapter boundary. This is the *only* place allowed to
import `chrome`/`browser` APIs on behalf of the engine — it implements the
port interfaces `src/engine/` defines (storage, messaging, tab info, etc.)
using real extension APIs.

This is the seam a future non-extension surface (a mobile app, a different
browser's extension APIs, a bookmarklet) would replace with its own
adapter, without touching `src/engine/` at all.

`entrypoints/`-layer code wires a platform adapter instance into the
engine at startup — the engine never reaches into `src/platform/` or
`entrypoints/` on its own.
