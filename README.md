# webchat-sdk

Drop a chat widget onto any page in two lines:

```html
<script src="https://github.com/ali3nnn/webchat-sdk/releases/latest/download/webchatsdk.js"></script>
<script>
  initWebchat("https://your-agent.example.com");
</script>
```

That is the whole integration. The first URL is this repository's latest
release, so a website never builds or hosts SDK files; the second is your own
agent, the only host you have to run. (An [ai-agent](https://github.com/ali3nnn/ai-agent-studio)
deployment can also serve the bundle from its own origin at `/webchatsdk.js` —
see [Hosting the bundle yourself](#hosting-the-bundle-yourself).) The widget renders a launcher bubble and a chat
panel inside a **shadow root** — the host page's CSS cannot reach in and the
widget cannot leak styles out — and handles the handshake for you: ask the agent
for a session token over HTTP, connect over **socket.io** with that token, then
stream the reply and the tool activity into the panel.

Underneath sits a headless client you can drive from your own UI or from Node
(see [Headless usage](#headless-usage)).

One SDK, many agents: each agent runs in its own container with its own
`AGENT_ID`, its own URL and its own token. Call `initWebchat` per agent, or use
`WebchatHub` for a single UI that switches between them.

```
browser / node                    ai-agent container
┌──────────────────┐              ┌────────────────────────────┐
│ WebchatClient    │  POST /sessions ──▶ token (HMAC-signed)   │
│                  │ ◀──────────────────                       │
│                  │  socket.io /webchat  (auth: { token })    │
│                  │ ◀──── session:ready / chat:delta …        │
└──────────────────┘              └────────────────────────────┘
```

## Install

The package is not on npm. The browser bundle ships as a GitHub release
asset, so a page loads it straight from this repository:

| URL | Gets you |
|---|---|
| [`releases/latest/download/webchatsdk.js`](https://github.com/ali3nnn/webchat-sdk/releases/latest/download/webchatsdk.js) | always the newest release — the URL to put in a `<script>` tag |
| `releases/download/v0.1.0/webchatsdk.js` | a pinned version, if you would rather upgrade deliberately |

A `.js.map` sits next to each one for readable stack traces.

### Hosting the bundle yourself

Loading from `github.com` means a third-party origin in your page (and in your
CSP). To keep everything same-origin, download the asset at deploy time and
serve it from your own host:

```bash
curl -fsSL -o webchatsdk.js https://github.com/ali3nnn/webchat-sdk/releases/latest/download/webchatsdk.js
```

An [ai-agent](https://github.com/ali3nnn/ai-agent-studio) deployment does exactly this and
serves the result at `/webchatsdk.js`.

### Building from source

For SDK development, or to import the SDK into your own bundle:

```bash
git clone git@github.com:ali3nnn/webchat-sdk.git
cd webchat-sdk && npm install && npm run build
```

`npm run build` emits two things:

| File | Use |
|---|---|
| `dist/webchatsdk.js` | the drop-in bundle — one `<script>` tag, defines `initWebchat` (and `Webchat`) |
| `dist/index.js` + `.d.ts` | ESM build with types, for bundlers and Node |

### Cutting a release

`dist/` is not committed; [the release workflow](.github/workflows/release.yml)
builds it on a tag and attaches the bundle, so the published asset always
matches the tagged source:

```bash
npm version patch      # or minor / major — writes the tag
git push --follow-tags
```

## The widget

```html
<script src="https://github.com/ali3nnn/webchat-sdk/releases/latest/download/webchatsdk.js"></script>
<script>
  const widget = initWebchat({
    url: "https://your-agent.example.com",
    agentId: "support",          // optional: refuse a token from another agent
    title: "Support",            // defaults to the agent's own name
    greeting: "Hi! Ask me anything about the product.",
    position: "bottom-right",    // or "bottom-left"
    accent: "#3b5bdb",
    connectOn: "open",           // "load" to connect before the panel is opened
  });

  widget.open();                 // also: close(), toggle(), destroy()
  widget.client.on("complete", (message) => console.log(message.text));
</script>
```

| Option | Default | Purpose |
|---|---|---|
| `url` | — | Agent base URL (required; the string form of `initWebchat` sets this) |
| `agentId` | — | Which project (agent) on the server to talk to — sent to `POST /sessions`; a token for another agent raises `agent_mismatch`. Omit for the server's default project. |
| `title` / `subtitle` | agent name / status | Header text |
| `greeting` | — | First bubble, rendered locally and never sent to the agent |
| `placeholder` | `Type a message…` | Input placeholder |
| `position` | `bottom-right` | Floating corner |
| `target` | — | Selector or element to mount into, instead of floating |
| `launcher` | `true` (`false` with `target`) | Show the bubble button |
| `open` | `false` (`true` with `target`) | Start with the panel open |
| `connectOn` | `open` | Connect on first open, or at `load` |
| `accent` | `#3b5bdb` | Accent colour (shortcut for `settings.colors.launcher` / `userBubble`) |
| `settings` | — | Overrides for any webchat setting (see below) |
| `fetchConfig` | `true` | Fetch the agent's webchat settings from `GET /widget/config` |
| `storageKey` | agent id | `localStorage` namespace for the conversation, privacy acceptance and teaser |

Every `WebchatClient` option (`token`, `tokenProvider`, `sessionId`, `userId`,
`reconnection`, `headers`, …) is accepted here too and passed straight through.

### Settings from the Chat Studio

The widget's look and behaviour are configured per project in the agent's Chat
Studio and served at `GET /widget/config?agentId=…`: agent name and avatar,
colours (launcher, bubbles, background, header), bubble style, greetings,
teaser message, AI disclaimer, input/send texts, timestamps, privacy notice,
persistence across pages, the "New chat" button and thumbs up/down feedback.
The widget fetches them before connecting; `settings` overrides any of them
per embed:

```js
initWebchat({
  url: "https://your-agent.example.com",
  agentId: "support",
  settings: {
    agentName: "Nova",
    colors: { launcher: "#ff6b3d" },
    greetings: ["Hi!", "Ask me anything about orders."],
    timestamps: "12h",
    teaser: { enabled: true, text: "Need a hand?", delayMs: 5000 },
  },
});
```

The conversation is kept in `localStorage` (session id + transcript, plus a
per-browser visitor id) and resumed on every page of the site; `widget.newChat()`
or the header button starts over. Ratings go to the agent as `chat:feedback`
and show up in its insights.

To embed the panel in your own layout instead of floating it:

```js
initWebchat({ url: "https://support-agent.example.com", target: "#chat" });
```

## Headless usage

```ts
import { createWebchatClient } from 'webchat-sdk';

const client = createWebchatClient({
  url: 'http://localhost:3210',
  agentId: 'support',        // optional: rejects a token from another agent
});

client.on('delta', ({ text }) => process.stdout.write(text));
client.on('tool', (tool) => console.log(`[${tool.name}] ${tool.status}`));

await client.connect();
const reply = await client.send('what are the support hours?');
console.log(reply.text, reply.tools);
```

In a browser, load the bundle and use the same API through the `Webchat`
global — see [example/index.html](example/index.html).

## Several agents at once

```ts
import { createWebchatHub } from 'webchat-sdk';

const hub = createWebchatHub({
  agents: [
    { id: 'support', url: 'https://support-agent.internal', label: 'Support' },
    { id: 'billing', url: 'https://billing-agent.internal', label: 'Billing' },
  ],
  defaults: { reconnection: true },
});

const support = await hub.connect('support');
await support.send('hi');

const billing = hub.client('billing');  // created lazily, connects on first send
```

Clients are created on first use, so registering ten agents does not open ten
sockets. Each client keeps its own transcript and its own token.

## Tokens

The agent mints the token; the SDK never invents one. Two flows:

**Public widget (default).** The SDK POSTs to `${url}/sessions` and uses what
comes back. Nothing to configure.

**Backend-minted.** Set `WEBCHAT_ISSUE_KEY` on the agent so `/sessions` requires
a key the browser must not hold, and mint tokens from your own backend:

```ts
createWebchatClient({
  url: 'https://support-agent.internal',
  agentId: 'support',
  tokenProvider: async () => {
    const response = await fetch('/api/chat-token', { method: 'POST' });
    return response.json();       // { token, sessionId?, expiresAt? }
  },
});
```

The provider is called again on every reconnect attempt, so an expired token is
replaced transparently — the SDK drops a token the agent rejected and asks for a
new one rather than retrying with the dead one.

Tokens are HMAC-signed and carry the session id, so any replica of the agent
sharing `WEBCHAT_TOKEN_SECRET` can verify a token it did not issue.

## API

### `initWebchat(url | options, options?)` → `WebchatWidget`

Renders the widget. Returns `{ client, open, close, toggle, destroy }` —
`client` is the same `WebchatClient` documented below, so anything the widget
does not surface is still available.

### `createWebchatClient(options)` → `WebchatClient`

| Option | Default | Purpose |
|---|---|---|
| `url` | — | Base URL of the agent container (required) |
| `agentId` | — | Which project (agent) on the server to talk to — sent to `POST /sessions`; a token for another agent raises `agent_mismatch`. Omit for the server's default project. |
| `token` | — | A token you already hold |
| `tokenProvider` | POST `${url}/sessions` | How to obtain/refresh tokens |
| `sessionId` | — | Resume an existing conversation |
| `socketPath` | `/webchat` | socket.io path the agent serves |
| `autoConnect` | `false` | Connect on construction |
| `reconnection` / `reconnectionAttempts` | `true` / `Infinity` | socket.io reconnection |
| `connectTimeoutMs` / `replyTimeoutMs` | `30000` / `120000` | Give-up thresholds |
| `headers` | — | Extra headers for the default token endpoint |
| `fetch` | `globalThis.fetch` | Injectable fetch |
| `transports` | `['websocket','polling']` | socket.io transports |

Methods: `connect()`, `send(text)` → resolves with the finished assistant
message, `cancel()`, `reset()`, `disconnect()`, `destroy()`.
Properties: `status`, `info` (the handshake), `agentId`, `sessionId`, `messages`.

Events (`client.on(name, handler)` returns an unsubscribe function):

| Event | Payload |
|---|---|
| `ready` | agent id/name, provider, model, session id, protocol version |
| `status` | `idle` \| `connecting` \| `connected` \| `reconnecting` \| `disconnected` |
| `message` | a message was added or changed — re-render your transcript |
| `delta` | `{ messageId, text }`, incremental assistant text |
| `tool` | tool call started / completed / failed, with input and output |
| `complete` | the finished assistant message |
| `error` | a `WebchatError` |

### `WebchatError.code`

`token_failed`, `token_expired`, `auth_failed`, `agent_mismatch`,
`protocol_mismatch`, `connect_failed`, `disconnected`, `timeout`, `busy`,
`cancelled`, `invalid_message`, `agent_error`.

## Wire protocol

[src/protocol.ts](src/protocol.ts) is the canonical contract;
`ai-agent/src/realtime/protocol.ts` mirrors it. Bump `PROTOCOL_VERSION` on a
breaking change — the agent reports its version in `session:ready` and the SDK
raises `protocol_mismatch` when they differ.

| Direction | Event | Payload |
|---|---|---|
| → agent | `chat:send` | `{ id, text }` — `id` is echoed back as `replyTo` |
| → agent | `chat:cancel` | `{}` |
| → agent | `chat:reset` | — |
| ← agent | `session:ready` | agent identity + protocol version |
| ← agent | `chat:started` | `{ messageId, replyTo }` |
| ← agent | `chat:delta` | `{ messageId, text }` |
| ← agent | `chat:tool` | `{ messageId, toolCallId, name, status, input?, output?, error? }` |
| ← agent | `chat:complete` | `{ messageId, replyTo, text, finishReason, usage }` |
| ← agent | `chat:error` | `{ code, message, messageId?, replyTo? }` |

One turn at a time per socket: sending while the agent is still answering is
rejected with `busy` rather than interleaved.

## Try it

Start an agent (it prints the snippet to paste) and open any page:

```bash
git clone https://github.com/ali3nnn/ai-agent-studio.git
cd ai-agent-studio/ai-agent && docker compose up --build
```

The `mock` provider needs no API key, so a fresh agent answers immediately.

## Smoke test

With an agent running on `:3210`:

```bash
AGENT_URL=http://localhost:3210 npm run smoke
```

It checks the handshake, small talk, a retrieval turn with tool events, that a
forged token is refused, and that the hub connects.

This package ships no Dockerfile and no demo server on purpose — it is a
library. Anything that needs hosting is the agent's job.

## Scaling notes

- A conversation lives in memory on the container the socket is attached to.
  Behind a load balancer, enable sticky sessions, or give the agents the
  socket.io Redis adapter and a shared session store.
- Every replica of one agent must share `WEBCHAT_TOKEN_SECRET`, otherwise a
  token minted by one replica is rejected by the next.
- Set `WEBCHAT_ALLOWED_ORIGINS` on the agent to your site's origins in
  production; the default `*` is a development convenience.
