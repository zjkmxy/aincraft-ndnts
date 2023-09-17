# Web VR using NDN-SVS over PeerJS

## Usage

You need [pnpm](https://pnpm.io/installation) to build this project.

- Install dependencies: `pnpm install --dev`
- Build the project: `pnpm build`
- Start a PeerJS server on localhost: `pnpm run peer-server`
- Start an HTTP server: `pnpm run http-server`
- Browse the website at: http://localhost:9000/
  - Open multiple tabs.
  - Click to create boxes.
  - Verify that all tabs sync with each other.
