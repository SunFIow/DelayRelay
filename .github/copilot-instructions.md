# Copilot Instructions for DelayRelay

This project is a Node.js application (Yarn-based) that acts as a proxy between OBS and Twitch to add a stream delay without restarting the stream. It is designed for reliability, protocol compliance, and runtime configurability.

## Architecture Overview

-  **RelayServer** (`src/relayServer.js`): Listens for incoming RTMP connections from OBS. For each connection, creates a `Connection` instance.
-  **Connection** (`src/connections/connection.js`): Handles a single OBS client connection. Manages sockets to Twitch, parses RTMP protocol, relays RTMP chunks, and can buffer data for delay if enabled.
-  **RtmpConnection** (`src/connections/rtmpConnection.js`): Uses the `copyof-node-media-server` library for RTMP protocol parsing and handshake.
-  **StreamBuffer** (`src/streamBuffer.js`): Buffers RTMP chunks for delay, manages memory limits and delay logic.
-  **ApiServer** (`src/apiServer.js`): HTTP API for runtime configuration (e.g., changing delay duration, querying status, activating/deactivating delay). Endpoints are documented in the HTML homepage and code comments.
-  **config.js**: Central configuration for ports, delay, buffer limits, and state. Exposes a `toString()` method for status reporting.
-  **logger.js**: Centralized logging utility for diagnostics and monitoring.

## Key Patterns & Conventions

-  **RTMP Protocol Handling**: All protocol parsing and handshake logic is delegated to the open-source `node-media-server` (see `copyof-node-media-server/`). Do not modify this folder; it is a direct copy for integration only.
-  **Dynamic Configuration**: All runtime settings (ports, delay, buffer sizes, etc.) are managed via the HTTP API (`ApiServer`). Example: `GET /set-delay?ms=15000` sets a 15s delay.
-  **State Management**: The `config` object holds all mutable runtime state. Changing config values via the API updates behavior immediately.
-  **Logging**: Use `LOGGER` and `LOGGER_API` for all diagnostics. Log files are written to the `logs/` directory.
-  **Buffering/Delay**: The `StreamBuffer` class is responsible for all buffering and delay logic. It enforces both chunk and byte limits.
-  **Testing/Debugging**: Dummy RTMP servers are provided in `test/` for local testing. Use these to simulate OBS/Twitch endpoints.

## Developer Workflows

-  **Start the API server**: `yarn start` (see `package.json` for entry point)
-  **Configure at runtime**: Use the HTTP API (see `/status` endpoint or homepage for available commands)
-  **Logs**: Check `logs/` for `api_*.log` and `relay_*.log` for diagnostics
-  **Testing**: Use scripts in `test/` to simulate RTMP traffic

## Integration Points

-  **OBS**: Connects to the local RTMP port (configurable via API)
-  **Twitch**: Outbound RTMP connection, URL/port configurable via API
-  **node-media-server**: Used only for protocol handling; do not edit its code

## Examples

-  Change stream delay: `GET /set-delay?ms=10000`
-  Activate delay: `GET /activate-delay`
-  Set remote RTMP URL: `GET /set-remote-url?url=live.twitch.tv`
-  Query status: `GET /status`

## Important Files

-  `src/relayServer.js`, `src/connections/connection.js`, `src/connections/rtmpConnection.js`, `src/streamBuffer.js`, `src/apiServer.js`, `src/config.js`, `src/logger.js`
-  `copyof-node-media-server/` (do not modify)
-  `test/` (dummy servers for testing)

---

**For AI agents:**

-  Always use the HTTP API for runtime changes; do not hardcode config values.
-  Never modify `copyof-node-media-server/`.
-  Follow the separation of concerns as described above.
-  Reference the HTML homepage (`ApiServer.simplePage`) for available API endpoints.
