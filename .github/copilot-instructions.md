<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

This project is a Node.js app using Yarn. It acts as a proxy between OBS and Twitch to add a stream delay without restarting the stream.

Key architecture and flow:

-  The app receives RTMP chunks from OBS and relays them to Twitch, preserving chunk boundaries and order.
-  Incoming chunks are buffered, maintaining a rolling window of recent stream data (e.g., last N seconds).
-  When delay is activated, the app "rewinds" the stream by N seconds: it replays the last N seconds of buffered content to Twitch, then continues relaying new chunks only after they have been buffered for the configured delay period.
-  The app can switch between real-time and delayed modes dynamically, without restarting the stream.
-  Buffer management, state transitions (REALTIME, BUFFERING, DELAY, FORWARDING), and memory handling are critical for reliability.
-  Avoid partitioning or merging RTMP chunks; always relay them as received from OBS unless protocol-level handling is required.

Module/Class Interaction Overview:

-  `RelayServer`: Main server class. Listens for incoming RTMP connections from OBS. For each connection, creates a `ClientConnection` instance.
-  `ClientConnection`: Handles a single OBS client connection. Manages the socket to Twitch, buffering, state transitions, and relaying of RTMP chunks. Uses a `StreamBuffer` for chunk management.
-  `StreamBuffer`: Manages buffering of RTMP chunks, delay logic, and memory limits. Provides methods to push new chunks and pop ready-to-relay chunks based on the current state.
-  `ApiServer`: Provides an HTTP API for runtime configuration (e.g., changing delay, querying status, activating/deactivating delay).
-  `config.js`: Central configuration for ports, delay settings, buffer limits, and state.
-  `logger.js`: Centralized logging utility for diagnostics and monitoring.

Typical flow:

1. OBS connects to `RelayServer`, which creates a `ClientConnection`.
2. `ClientConnection` receives RTMP chunks, passes them to `StreamBuffer`.
3. `StreamBuffer` buffers and manages chunks according to the current state.
4. `ClientConnection` flushes ready chunks to Twitch.
5. `ApiServer` allows runtime control and monitoring.

This structure ensures clear separation of concerns and reliable stream relay with dynamic delay control.
