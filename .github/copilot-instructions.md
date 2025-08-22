# Copilot Instructions for DelayRelay

This project is a Node.js RTMP proxy that adds a configurable stream delay between OBS and Twitch, without requiring a stream restart. It is designed for reliability, protocol compliance, and runtime configurability. All code uses Yarn and ES6 modules.

## Architecture Overview

-  **RelayServer** (`src/relayServer.js`): Listens for incoming RTMP connections from OBS. Creates a `Connection` for each client.
-  **Connection** (`src/connections/connection.js`): Manages a single OBS client, relays RTMP chunks, and handles buffering for delay.
-  **RtmpConnection** (`src/connections/rtmpConnection.js`): Integrates with an internal RTMP protocol implementation in `src/rtmp/` for parsing/handshake. The AMF0 encode/decode implementation is vendored at `src/rtmp/amf.js` (Apache-2.0) and retains original attribution.
-  **StreamBuffer** (`src/streamBuffer.js`): Implements all buffering and delay logic, enforcing chunk/byte limits.
-  **ApiServer** (`src/apiServer.js`): Exposes an HTTP API for runtime configuration (delay, ports, remote URL, status, etc.). Endpoints are documented in the homepage and code comments.
-  **config.js**: Central config for ports, delay, buffer limits, and state. All runtime state is managed here and updated via the API.
-  **logger.js**: Centralized logging utility. Use `LOGGER` and `LOGGER_API` for diagnostics; logs are written to `logs/`.

## Key Patterns & Conventions

-  **ES6 Modules**: All source files use ES6 `import`/`export` syntax.
-  **Dynamic Configuration**: All runtime settings (ports, delay, buffer sizes, etc.) are managed via the HTTP API (`ApiServer`). Never hardcode config values; always use the API for changes.
-  **State Management**: The `config` object holds all mutable runtime state. API changes update behavior immediately.
-  **Logging**: Use only the provided logger utilities. Log files are in `logs/`.
-  **Buffering/Delay**: All buffering logic is in `StreamBuffer`. Do not duplicate delay logic elsewhere.
-  **Testing/Debugging**: Use scripts in `test/` to simulate OBS/Twitch endpoints. Dummy RTMP servers are provided for local testing.

## Developer Workflows

-  **Install dependencies**: `yarn install`
-  **Start the API server**: `yarn start` (entry: `src/index.js`)
-  **Configure at runtime**: Use the HTTP API (see `/status` endpoint or homepage for commands)
-  **Logs**: Check `logs/` for `api_*.log` and `relay_*.log`, the `*_latest.log` files contain the most recent logs and are at the root.
-  **Testing**: Use `test/` scripts to simulate RTMP traffic

## Integration Points

-  **OBS**: Connects to the local RTMP port (configurable via API)
-  **Twitch**: Outbound RTMP connection, URL/port configurable via API

## Examples

-  Change stream delay: `GET /set-delay?ms=10000`
-  Activate delay: `GET /activate-delay`
-  Set remote RTMP URL: `GET /set-remote-url?url=live.twitch.tv`
-  Query status: `GET /status`

## Important Files

-  `src/relayServer.js`, `src/connections/connection.js`, `src/connections/rtmpConnection.js`, `src/streamBuffer.js`, `src/apiServer.js`, `src/config.js`, `src/logger.js`
-  `test/` (dummy servers for testing)
-  `bin/` — Contains versioned subfolders (e.g., `0.0.1/`, `1.0.0/`) for finished builds. Each version may include compiled binaries (like `delayrelay.exe`) and a `dist/` directory with bundled JavaScript (`delayrelay.js`) and web UI files (`relay-controls.html`, `relay-ui.html`).

---

**For AI agents:**

-  Always use the HTTP API for runtime changes; do not hardcode config values.
-  The active protocol code paths use `src/rtmp/` and `src/rtmp/amf.js` (vendored).
-  Follow the separation of concerns as described above.
-  Reference the HTTP API (`ApiServer.endpoints`) for available API endpoints.

## Assistant preferences

-  Assistant style: short, simple English; avoid uncommon words; expand only for complex topics.

**User confirmations:**

-  There is no button interface for confirmations in this chat. Whenever you ask the user for confirmation or a choice (e.g., "Would you like me to..."), always suggest a quick reply template for the user to copy and send, such as:
   -  "Reply with 'yes' to confirm or 'no' to cancel."
   -  "Type 'proceed' to continue or 'cancel' to abort."
      This helps streamline the confirmation process for the user.
