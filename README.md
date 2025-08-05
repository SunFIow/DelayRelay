# DelayRelay

A Node.js RTMP proxy that adds a configurable stream delay between OBS and Twitch, without requiring a stream restart. Uses Yarn and a modular `src/` code structure.

## Features

-  Acts as a proxy between OBS and Twitch
-  Adds a configurable stream delay (changeable at runtime)
-  No need to restart the stream to change delay
-  HTTP API for dynamic configuration

## Usage

1. **Configure OBS:**

   -  Set your OBS stream server to the address and port where DelayRelay is running (default: `rtmp://localhost:8888`).
   -  Use your Twitch stream key as usual.

2. **Configure Delay and Other Settings:**
   -  Use the HTTP API (default: `http://localhost:8080`) to adjust delay and other parameters at runtime.
   -  Example endpoints:
      -  `/set-delay?ms=30000` — Set stream delay to 30 seconds
      -  `/activate-delay` — Start buffering/delaying
      -  `/deactivate-delay` — Forward immediately (no delay)
      -  `/status` — Get current configuration

### Configuring via config.json

You can also set initial configuration values by editing the `config.json` file in the project directory. This file is created automatically after the first run. Changes to `config.json` take effect on the next restart of DelayRelay. For most runtime changes, use the HTTP API instead.

## App Flow

1. **OBS connects to DelayRelay:**
   -  OBS streams RTMP data to the DelayRelay proxy instead of directly to Twitch.
2. **DelayRelay buffers incoming stream data:**
   -  Incoming RTMP chunks are received and stored in a buffer.
   -  The buffer maintains a rolling window of recent stream data (e.g., last 30 seconds).
3. **Delay logic:**
   -  In real-time mode, chunks are relayed immediately to Twitch and also saved in the buffer.
   -  When delay is activated, DelayRelay "rewinds" the stream by N seconds: it starts relaying the buffered chunks (the last N seconds of stream data) to Twitch, effectively replaying recent content.
   -  While the buffered window is being sent, new incoming chunks fill a separate buffer.
   -  Once the buffered window is sent, new chunks are relayed to Twitch only after they have been in the buffer for the configured delay period.
   -  The app can switch between real-time and delayed modes dynamically, without restarting the stream.
4. **Forwarding to Twitch:**
   -  DelayRelay connects to Twitch and forwards the buffered (and/or delayed) RTMP chunks, maintaining the original chunk boundaries and order.
5. **API and Monitoring:**
   -  The HTTP API allows runtime control of delay, state, and provides status information.
   -  Logging tracks buffer state, relay events, and any warnings/errors for diagnostics.

This flow ensures you can add, remove, or change stream delay on the fly, with minimal disruption to your broadcast.

## Project Structure

-  `src/` — All source code (entry: `src/index.js`)
-  `logs/` — Log files
-  `bin/` — Versioned builds and bundled output (binaries, JS, web UI).

## License

MIT
