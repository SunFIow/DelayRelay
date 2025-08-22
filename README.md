# DelayRelay

A Node.js RTMP proxy that adds a configurable stream delay between OBS and Twitch, without requiring a stream restart. Uses Yarn and a modular `src/` code structure.

## Features

-  Acts as a proxy between OBS and Twitch
-  Adds a configurable stream delay (changeable at runtime)
-  No need to restart the stream to change delay
-  HTTP API for dynamic configuration
-  UI Dock for OBS

## Usage

1. **Configure OBS:**

   -  Set your OBS stream server to the address and port where DelayRelay is running (default: `rtmp://localhost:8888`).
   -  Use your Twitch stream key as usual.

2. **Configure Delay and Other Settings:**
   -  Add the UI Dock (default: `http://localhost:8080/ui`) to OBS for seemless integration
   -  Use the HTTP API (default: `http://localhost:8080`) to adjust delay and other parameters at runtime.

### Configuring via config.json

You can also set initial configuration values by editing the `config.json` file in the project directory. This file is created automatically after the first run. Changes to `config.json` take effect on the next restart of DelayRelay. For most runtime changes, use the HTTP API instead.

## App Flow

1. **DelayRelay startup:**
   -  DelayRelay loads configurations from `config.json`
   -  It then opens the ui and api webpages
2. **OBS connects to DelayRelay:**
   -  Make sure the proxy server is online before you start your stream
   -  OBS streams RTMP data to the DelayRelay proxy instead of directly to Twitch.
3. **DelayRelay buffers incoming stream data:**
   -  Incoming RTMP chunks are received and stored in a buffer.
   -  A second buffer maintains a rolling window of recent stream data (e.g., last 30 seconds).
4. **Delay logic:**
   -  In real-time mode, chunks are relayed immediately to Twitch
   -  When delay is activated, DelayRelay "rewinds" the stream by N seconds: it adds the delay chunks (the last N seconds of stream data) to the buffer, effectively replaying recent content.
   -  The app can switch between real-time and delayed modes dynamically, without restarting the stream.
5. **Forwarding to Twitch:**
   -  DelayRelay connects to Twitch and forwards the buffered RTMP chunks, maintaining the original chunk boundaries and order.
6. **API and Monitoring:**
   -  The HTTP API allows runtime control of delay, state, and provides status information.
   -  Logging tracks buffer state, relay events, and any warnings/errors for diagnostics.

This flow ensures you can add, remove, or change stream delay on the fly, with minimal disruption to your broadcast.

## Project Structure

-  `src/` — All source code (entry: `src/index.js`)
-  `logs/` — Log files
-  `bin/` — Versioned builds and bundled output (binaries, JS, web UI).

## License

MIT

## Third-party licenses

See `THIRD-PARTY-LICENSES.md` for a summary of bundled third-party components
