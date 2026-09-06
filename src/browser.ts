/**
 * Entry point for the standalone browser bundle (dist/webchatsdk.js).
 *
 * It exposes the whole SDK as `window.Webchat` and, for the one-liner embed,
 * `window.initWebchat`:
 *
 *   <script src="webchatsdk.js"></script>
 *   <script>initWebchat('https://agent.example.com');</script>
 */
import { initWebchat } from './widget.js';

export * from './index.js';

declare global {
  // eslint-disable-next-line no-var
  var initWebchat: typeof import('./widget.js').initWebchat;
}

globalThis.initWebchat = initWebchat;
