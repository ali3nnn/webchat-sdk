/**
 * End-to-end check against a running ai-agent.
 *
 *   cd ../ai-agent && LLM_PROVIDER=mock AGENT_ID=support PORT=3210 npm start
 *   cd ../webchat-sdk && npm run build && AGENT_URL=http://localhost:3210 npm run smoke
 *
 * PROJECT_TOKEN picks a specific project (copy it from the Chat Studio's embed
 * snippet); without it the agent answers with its default project.
 */
import assert from 'node:assert/strict';
import { createWebchatClient, createWebchatHub } from '../dist/index.js';

const url = process.env.AGENT_URL ?? 'http://localhost:3210';
const agentId = process.env.AGENT_ID ?? 'support';
const projectToken = process.env.PROJECT_TOKEN;

const events = [];
const client = createWebchatClient({ url, projectToken });
client.on('status', (status) => events.push(`status:${status}`));
client.on('tool', (tool) => events.push(`tool:${tool.name}:${tool.status}`));
client.on('delta', () => events.push('delta'));

const ready = await client.connect();
if (!projectToken) assert.equal(ready.agentId, agentId, 'handshake reports the expected agent');
assert.ok(ready.sessionId, 'handshake carries a session id');
console.log(`connected to ${ready.agentName} (${ready.provider}/${ready.model})`);

const smallTalk = await client.send('hey there');
assert.equal(smallTalk.status, 'complete');
assert.match(smallTalk.text, /help/i);
assert.equal(smallTalk.tools.length, 0, 'small talk does not call the tool');
console.log(`small talk  -> ${smallTalk.text}`);

const factual = await client.send('what are the support hours?');
assert.equal(factual.status, 'complete');
assert.equal(factual.tools[0]?.name, 'knowledge_retrieval', 'factual question calls the tool');
assert.equal(factual.tools[0]?.status, 'completed');
assert.match(factual.text, /support-policy\.md/, 'answer cites the retrieved document');
console.log(`retrieval   -> ${factual.text}`);

assert.ok(events.includes('delta'), 'text arrived incrementally');
assert.ok(events.includes('tool:knowledge_retrieval:started'), 'tool start was reported');
assert.equal(client.messages.length, 4, 'transcript holds both turns');

// A bad token must be refused by the handshake.
const rejected = createWebchatClient({ url, projectToken, token: 'not.a-real-token' });
await assert.rejects(() => rejected.connect(), (error) => {
  assert.equal(error.code, 'auth_failed');
  return true;
});
rejected.destroy();
console.log('auth        -> forged token rejected');

// Reconnecting must land in the same conversation, whatever happens to the
// token in between — a re-minted grant carries the session id forward.
const sessionId = client.sessionId;
client.disconnect();
const reconnected = await client.connect();
assert.equal(reconnected.sessionId, sessionId, 'reconnect resumes the same session');
assert.ok(reconnected.historyLength > 0, 'the agent still holds the transcript');
console.log(`reconnect   -> resumed ${sessionId} with ${reconnected.historyLength} messages`);

// The hub drives several agent containers through one object.
const hub = createWebchatHub({ agents: [{ id: agentId, url, projectToken, label: 'Support' }] });
const hubClient = await hub.connect(agentId);
assert.equal(hubClient.info?.agentId, ready.agentId);
console.log(`hub         -> connected ${hub.ids.join(', ')}`);

client.reset();
client.destroy();
hub.destroy();
console.log('\nall webchat-sdk smoke checks passed');
