# DelayRelay

A simple Node.js proxy app using Yarn to add a stream delay between OBS and Twitch without restarting the stream.

## Features
- Acts as a proxy between OBS and Twitch
- Adds a configurable stream delay
- No need to restart the stream to change delay

## Getting Started

1. Install dependencies:
   ```sh
   yarn install
   ```
2. Start the proxy server:
   ```sh
   yarn start
   ```

## Configuration
- Configure OBS to stream to this proxy's address instead of Twitch directly.
- The proxy will forward the stream to Twitch with the specified delay.

## License
MIT
