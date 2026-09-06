export type Listener<T> = (payload: T) => void;

/** Minimal typed event emitter — no dependency, works in browsers and Node. */
export class Emitter<EVENTS> {
  private readonly listeners = new Map<keyof EVENTS, Set<Listener<never>>>();

  on<K extends keyof EVENTS>(event: K, listener: Listener<EVENTS[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as Listener<never>);
    this.listeners.set(event, set);
    return () => this.off(event, listener);
  }

  once<K extends keyof EVENTS>(event: K, listener: Listener<EVENTS[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof EVENTS>(event: K, listener: Listener<EVENTS[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  protected emit<K extends keyof EVENTS>(event: K, payload: EVENTS[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      // A throwing listener must not break the socket handler that emitted.
      try {
        (listener as Listener<EVENTS[K]>)(payload);
      } catch {
        // ignored on purpose
      }
    }
  }
}
