# Web VR using NDN-SVS over PeerJS

## Usage

You need [pnpm](https://pnpm.io/installation) to build this project.

- Install dependencies: `pnpm install`
- Build the project: `pnpm build`
- Start a PeerJS server on localhost: `pnpm run peer-server`
- Start an HTTP server: `pnpm run http-server`
- Browse the website at: http://localhost:9000/
  - Open multiple tabs.
  - Use clipboard to copy each tab's QRCode into other tabs. You can simply paste the image.
  - Click to create boxes on each tab.
  - Verify that all tabs sync with each other.
