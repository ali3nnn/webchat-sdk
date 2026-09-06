import { WebchatClient } from './client.js';
import { WebchatError } from './errors.js';
import type { WebchatClientOptions } from './types.js';

export interface AgentDescriptor extends Omit<WebchatClientOptions, 'url' | 'autoConnect'> {
  /** Your key for this agent in the hub; `client(id)` looks it up. */
  id: string;
  /** Base URL of that agent's container. */
  url: string;
  /** Optional display label for your UI. */
  label?: string;
}

export interface WebchatHubOptions {
  agents: AgentDescriptor[];
  /** Options applied to every agent unless the descriptor overrides them. */
  defaults?: Omit<WebchatClientOptions, 'url' | 'projectToken'>;
}

/**
 * A registry of agent containers behind one SDK.
 *
 * Each agent runs in its own container with its own URL and its own project
 * token — the hub keeps one WebchatClient per agent and hands you the right
 * one. Clients are created lazily, so registering ten agents does not
 * open ten sockets.
 */
export class WebchatHub {
  private readonly descriptors = new Map<string, AgentDescriptor>();
  private readonly clients = new Map<string, WebchatClient>();
  private readonly defaults: Omit<WebchatClientOptions, 'url' | 'projectToken'>;

  constructor(options: WebchatHubOptions) {
    this.defaults = options.defaults ?? {};
    for (const agent of options.agents) this.add(agent);
  }

  get ids(): string[] {
    return [...this.descriptors.keys()];
  }

  get agents(): AgentDescriptor[] {
    return [...this.descriptors.values()];
  }

  add(agent: AgentDescriptor): void {
    this.descriptors.set(agent.id, agent);
  }

  /** Removes an agent and disconnects its client if one was open. */
  remove(id: string): void {
    this.clients.get(id)?.destroy();
    this.clients.delete(id);
    this.descriptors.delete(id);
  }

  /** Returns (creating on first use) the client for one agent. */
  client(id: string): WebchatClient {
    const existing = this.clients.get(id);
    if (existing) return existing;

    const descriptor = this.descriptors.get(id);
    if (!descriptor) {
      throw new WebchatError(
        `Unknown agent "${id}". Registered agents: ${this.ids.join(', ') || 'none'}.`,
        'agent_mismatch',
      );
    }

    const { id: _id, url, label: _label, ...overrides } = descriptor;
    const client = new WebchatClient({
      ...this.defaults,
      ...overrides,
      url,
    });
    this.clients.set(id, client);
    return client;
  }

  /** Opens a connection to one agent and waits for its handshake. */
  async connect(id: string): Promise<WebchatClient> {
    const client = this.client(id);
    await client.connect();
    return client;
  }

  /** Connects every registered agent; rejected agents are reported, not thrown. */
  async connectAll(): Promise<{ id: string; connected: boolean; error?: WebchatError }[]> {
    return Promise.all(
      this.ids.map(async (id) => {
        try {
          await this.connect(id);
          return { id, connected: true };
        } catch (error) {
          return {
            id,
            connected: false,
            error:
              error instanceof WebchatError
                ? error
                : new WebchatError(String(error), 'connect_failed', { agentId: id }),
          };
        }
      }),
    );
  }

  disconnectAll(): void {
    for (const client of this.clients.values()) client.disconnect();
  }

  destroy(): void {
    for (const client of this.clients.values()) client.destroy();
    this.clients.clear();
    this.descriptors.clear();
  }
}

export function createWebchatHub(options: WebchatHubOptions): WebchatHub {
  return new WebchatHub(options);
}
