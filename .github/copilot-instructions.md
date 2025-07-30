<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

This project is a Node.js app using Yarn. It acts as a proxy between OBS and Twitch to add a stream delay without restarting the stream.

**Note:** The folder `copyof-node-media-server` is not original code for this project. It is a direct copy of the open-source Node.js library [node-media-server](https://github.com/illuspas/node-media-server), included for protocol handling and integration purposes.

    architecture and flow:

-  The app receives RTMP data from OBS and relays it to Twitch, preserving RTMP chunk boundaries and order.
-  RTMP protocol parsing and handshake are handled using the node-media-server library within the RtmpConnection class.

Module/Class Interaction Overview:

-  `RelayServer`: Main server class. Listens for incoming RTMP connections from OBS. For each connection, creates an `RtmpConnection` instance.
-  `Connection`: Handles a single OBS client connection. Manages sockets to Twitch, parses RTMP protocol, relays RTMP chunks, and can buffer data for delay if enabled.
-  `StreamBuffer`: Designed to manage buffering of RTMP chunks, delay logic, and memory limits
-  `ApiServer`: Provides an HTTP API for runtime configuration (e.g., changing delay, querying status, activating/deactivating delay).
-  `config.js`: Central configuration for ports, delay settings, buffer limits, and state.
-  `logger.js`: Centralized logging utility for diagnostics and monitoring.

Typical flow:

1. OBS connects to `RelayServer`, which creates an `Connection`.
2. `Connection` receives RTMP data, parses protocol messages, and relays RTMP chunks to Twitch.
3. (Optional) `StreamBuffer` can buffer and manage chunks for delay if enabled.
4. `ApiServer` allows runtime control and monitoring.

This structure ensures clear separation of concerns and reliable stream relay with protocol compliance and optional dynamic delay control.
