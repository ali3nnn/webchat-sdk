# webchat-sdk

Drop a chat widget onto any page in two lines:

```html
<script src="https://github.com/ali3nnn/webchat-sdk/releases/latest/download/webchatsdk.js"></script>
<script>
  initWebchat({
    url: "https://your-agent.example.com",
    projectToken: "wc_7Qk2mZp9Ld4Xr8Ts1Vb6",
  });
</script>
```

That is the whole integration. The first URL is this repository's latest
release, so a website never builds or hosts SDK files; the second is your own
agent, the only host you have to run. `projectToken` is the project's public
embed token — copy it from the Chat Studio's **Embed** card, one per project.
It names a project without exposing its id and is safe to put in a page: it
selects who answers, it does not authorise anything on its own. Leave it out
and the agent answers with its default project. (An [ai-agent](https://github.com/ali3nnn/ai-agent-studio)
deployment can also serve the bundle from its own origin at `/webchatsdk.js` —
see [Hosting the bundle yourself](#hosting-the-bundle-yourself).) The widget renders a launcher bubble and a chat
panel inside a **shadow root** — the host page's CSS cannot reach in and the
widget cannot leak styles out — and handles the handshake for you: ask the agent
for a session token over HTTP, connect over **socket.io** with that token, then
stream the reply and the tool activity into the panel. On a host that cannot
hold a socket open (Vercel, and anything else that routes every request on its
own) the agent says so in its config and the widget talks **plain HTTP**
instead — one `POST /chat/stream` per message, the reply read as Server-Sent
Events — with the same panel and the same events.

Underneath sits a headless client you can drive from your own UI or from Node
(see [Headless usage](#headless-usage)).

One SDK, many agents: each agent has its own URL and its own project token.
Call `initWebchat` per agent, or use `WebchatHub` for a single UI that switches
between them.

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
    projectToken: "wc_7Qk2mZp9Ld4Xr8Ts1Vb6",   // which project answers
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
| `projectToken` | — | The project's public embed token (24 characters, `wc_…`), from the Chat Studio — sent to `POST /sessions` and `GET /widget/config`. Omit for the server's default project. |
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
| `storageKey` | project token | `localStorage` namespace for the conversation, privacy acceptance and teaser |

Every `WebchatClient` option (`token`, `tokenProvider`, `sessionId`, `userId`,
`reconnection`, `headers`, …) is accepted here too and passed straight through.

### Settings from the Chat Studio

The widget's look and behaviour are configured per project in the agent's Chat
Studio and served at `GET /widget/config?projectToken=…`: agent name and avatar,
colours (launcher, bubbles, background, header), bubble style, greetings,
teaser message, AI disclaimer, input/send texts, timestamps, privacy notice,
persistence across pages, the "New chat" button and thumbs up/down feedback.
The widget fetches them before connecting; `settings` overrides any of them
per embed:

```js
initWebchat({
  url: "https://your-agent.example.com",
  projectToken: "wc_7Qk2mZp9Ld4Xr8Ts1Vb6",
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
initWebchat({ url: "https://support-agent.example.com", projectToken: "wc_…", target: "#chat" });
```

## Headless usage

```ts
import { createWebchatClient } from 'webchat-sdk';

const client = createWebchatClient({
  url: 'http://localhost:3210',
  projectToken: 'wc_7Qk2mZp9Ld4Xr8Ts1Vb6',   // omit for the default project
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
    { id: 'support', url: 'https://support-agent.internal', projectToken: 'wc_…', label: 'Support' },
    { id: 'billing', url: 'https://billing-agent.internal', projectToken: 'wc_…', label: 'Billing' },
  ],
  defaults: { reconnection: true },
});

const support = await hub.connect('support');
await support.send('hi');

const billing = hub.client('billing');  // created lazily, connects on first send
```

Clients are created on first use, so registering ten agents does not open ten
sockets. `id` is just your key in the hub; `projectToken` is what picks the
project on the server. Each client keeps its own transcript and its own token.

## Tokens

The agent mints the token; the SDK never invents one. Two flows:

**Public widget (default).** The SDK POSTs to `${url}/sessions` with the
`projectToken` and uses what comes back. Nothing to configure.

**Backend-minted.** Set `WEBCHAT_ISSUE_KEY` on the agent so `/sessions` requires
a key the browser must not hold, and mint tokens from your own backend:

```ts
createWebchatClient({
  url: 'https://support-agent.internal',
  tokenProvider: async () => {
    const response = await fetch('/api/chat-token', { method: 'POST' });
    return response.json();       // { token, sessionId?, expiresAt?, agentId? }
  },
});
```

Your backend calls the agent's `POST /sessions` itself, with the project token
in the body and `x-webchat-key` in the headers — that way the issue key never
reaches the browser.

The provider is called again on every reconnect attempt, so an expired token is
replaced transparently. The SDK does not wait to be told: it re-mints a grant
once it is within 30 seconds of the `expiresAt` the agent returned (or half the
token's life, whichever is smaller, so a very short `WEBCHAT_TOKEN_TTL` cannot
turn a reconnect storm into a mint storm). A token the agent rejects anyway is
dropped rather than retried. Either way the replacement is minted for the same
session id, so the visitor keeps their history across an expiry.

Tokens are HMAC-signed and carry the session id, so any replica of the agent
sharing `WEBCHAT_TOKEN_SECRET` can verify a token it did not issue.

### What is on the wire

Identity travels in the socket.io `auth` payload, inside the signed token — not
in the URL:

```
wss://agent.example.com/webchat/?sessionId=…&agentId=…&EIO=4&transport=websocket
                                └── correlation only, nothing trusts these ──┘

40{"token":"eyJzaWQiOiI…"}   ← the CONNECT packet: sid, aid, uid, iat, exp, signed
```

Keeping the credential out of the query keeps it out of proxy logs, CDN logs and
browser history. But an otherwise identical URL for every visitor is unreadable
in an access log or a HAR file, so the session and project ids ride along as
plain query parameters. The agent authenticates the token and ignores the query,
which anyone can forge. Set `correlationIds: false` to leave them off.

Spell those names out. `sid`, `t`, `j`, `b64`, `EIO` and `transport` are
Engine.IO's own; a `sid` of your own is read as its polling session id and the
handshake dies with `Session ID unknown`.

## API

### `initWebchat(url | options, options?)` → `WebchatWidget`

Renders the widget. Returns `{ client, open, close, toggle, destroy }` —
`client` is the same `WebchatClient` documented below, so anything the widget
does not surface is still available.

### `createWebchatClient(options)` → `WebchatClient`

| Option | Default | Purpose |
|---|---|---|
| `url` | — | Base URL of the agent container (required) |
| `projectToken` | — | The project's public embed token (24 characters, `wc_…`), from the Chat Studio — sent to `POST /sessions`. Omit for the server's default project. |
| `token` | — | A session token you already hold |
| `tokenProvider` | POST `${url}/sessions` | How to obtain/refresh tokens |
| `sessionId` | — | Resume an existing conversation |
| `transport` | from `GET /widget/config`, else `socket` | `socket` keeps a socket.io connection; `http` sends one `POST /chat/stream` per message and reads SSE — no persistent connection, no sticky sessions, the transport for Vercel. The widget takes the agent's `WEBCHAT_TRANSPORT` unless this is set; a headless client defaults to `socket`. |
| `socketPath` | `/webchat` | socket.io path the agent serves |
| `autoConnect` | `false` | Connect on construction |
| `reconnection` / `reconnectionAttempts` | `true` / `Infinity` | socket.io reconnection |
| `connectTimeoutMs` / `replyTimeoutMs` | `30000` / `120000` | Give-up thresholds |
| `headers` | — | Extra headers for the default token endpoint |
| `fetch` | `globalThis.fetch` | Injectable fetch |
| `transports` | `['websocket','polling']` | socket.io transports |
| `correlationIds` | `true` | Put `sessionId` and `agentId` in the handshake URL for log correlation |

Methods: `connect()`, `send(text)` → resolves with the finished assistant
message, `cancel()`, `reset()`, `disconnect()`, `destroy()`.
Properties: `status`, `info` (the handshake), `agentId` (the project the agent
identified itself as), `sessionId`, `messages`.

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

### Over HTTP

`transport: 'http'` carries the same protocol without a connection. `connect()`
mints the token — `POST /sessions` also reports the agent's name, provider,
model and history length, so `ready` says what a socket handshake would — and
every `send()` is one request:

```
POST /chat/stream           Authorization: Bearer <token>
{ "id": "m-1", "message": "…" }

event: session   { sessionId, projectId, protocolVersion }
event: started   { messageId, replyTo }
event: tool      { messageId, toolCallId, name, status, input?, output?, error? }
event: delta     { messageId, text }
event: done      { sessionId, messageId, replyTo, text, finishReason, usage }
event: error     { code, message, messageId?, replyTo? }
```

The frames are the socket events minus their `chat:` prefix and carry the same
payloads, so the transcript and the `message` / `delta` / `tool` / `complete`
events come out identical. `cancel()` aborts the request, which aborts the turn
on the agent; `reset()` is `DELETE /sessions/:id`; `feedback()` is
`POST /chat/feedback`. Identity travels in the bearer token's signed payload,
never in the body — a token bound to one conversation cannot be pointed at
another.

What changes: `status` goes `connecting` → `connected` once and stays there
(there is nothing to reconnect), `busy` is answered locally when a turn is
already in flight, and a host that cuts a response before `done` — a
serverless max duration, a proxy — leaves what was streamed on the message and
fails the turn with `agent_error`.

The widget picks this up from the agent: `GET /widget/config` reports the
agent's `WEBCHAT_TRANSPORT`, and the widget follows it unless the embed pins
`transport` itself. So a deployment moving to Vercel flips one variable and
every page already carrying the snippet follows on its next load.

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
TRANSPORT=http AGENT_URL=http://localhost:3210 npm run smoke
```

It checks the handshake, small talk, a retrieval turn with tool events, that a
forged token is refused, that a reconnect resumes the same conversation, and
that the hub connects — over socket.io, then the same checks over HTTP.

This package ships no Dockerfile and no demo server on purpose — it is a
library. Anything that needs hosting is the agent's job.

## Scaling notes

- A conversation lives in memory on the container the socket is attached to.
  Behind a load balancer, enable sticky sessions, or give the agents the
  socket.io Redis adapter and a shared session store — or use
  `transport: 'http'`, which needs neither: every turn is one request, and the
  agent rehydrates the conversation from its database wherever it lands.
- Every replica of one agent must share `WEBCHAT_TOKEN_SECRET`, otherwise a
  token minted by one replica is rejected by the next.
- Set `WEBCHAT_ALLOWED_ORIGINS` on the agent to your site's origins in
  production; the default `*` is a development convenience.

## Releasing

The version in `package.json` is the release. Bump it, merge it to `main`, and
[the release workflow](.github/workflows/release.yml) tags that commit, builds
the browser bundle and publishes a GitHub Release with `webchatsdk.js` attached
— which is what `releases/latest/download/webchatsdk.js` serves, so every embed
that points there picks it up.

From a branch, bump the version as part of the change and let the merge release
it. Do not tag: the workflow tags the merge commit, and a tag made here would
point at the branch commit instead.

```bash
npm version minor --no-git-tag-version   # or major / patch
git commit -am "What changed, 0.4.0"
```

Straight to main, tagging locally is fine — it is the same commit either way:

```bash
npm version minor && git push --follow-tags
```

A commit that leaves the version alone finds it already released and stops
without cutting anything, so `main` can move as often as it likes.
