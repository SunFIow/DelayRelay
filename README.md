# DelayRelay

A Node.js RTMP proxy that adds a configurable stream delay between OBS and Twitch, without requiring a stream restart. Uses Yarn and a modular `src/` code structure.

## Features

-  Acts as a proxy between OBS and Twitch
-  Adds a configurable stream delay (changeable at runtime)
-  No need to restart the stream to change delay
-  HTTP API for dynamic configuration
-  Modular, testable codebase (`src/` directory)

## Getting Started

1. **Install dependencies:**
   ```sh
   yarn install
   ```
2. **Start the proxy server:**
   ```sh
   yarn start
   ```
   (This runs `src/index.js` as the entry point.)

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

## Project Structure

-  `src/` — All source code (entry: `src/index.js`)
-  `logs/` — Log files
-  `standby.flv`, `standby.png` — Standby assets (in `src/`)

## License

MIT
