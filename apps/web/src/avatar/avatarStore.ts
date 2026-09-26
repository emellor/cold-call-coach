import type { AvatarController } from './AvatarController.ts';

export type AvatarStatus =
  | { kind: 'loading'; progress: number | null }
  | { kind: 'ready' }
  /** The model didn't load; her voice still plays through the controller. */
  | { kind: 'failed'; message: string }
  /** No avatar (no WebGL, or the 3D code failed): her voice plays through a plain audio element. */
  | { kind: 'unavailable'; message: string };

export interface AvatarSnapshot {
  status: AvatarStatus;
  controller: AvatarController | null;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Owns the page's one AvatarController and exposes its state to React through
 * useSyncExternalStore. The 3D code (three.js, TalkingHead, HeadAudio) is
 * loaded on demand, so the call screen renders before it arrives and still
 * works if it can't run at all.
 */
export class AvatarStore {
  readonly #listeners = new Set<() => void>();
  #snapshot: AvatarSnapshot = { status: { kind: 'loading', progress: null }, controller: null };
  #element: HTMLElement | null = null;
  /** Bumped on teardown, so work from an earlier mount can tell it is stale. */
  #generation = 0;
  #disposeTimer: number | undefined;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): AvatarSnapshot => this.#snapshot;

  /** Creates the avatar in `element` and starts loading it; returns the unmount function. */
  mount(element: HTMLElement): () => void {
    window.clearTimeout(this.#disposeTimer);
    if (this.#element === element) return this.#unmount;
    this.#element = element;
    void this.#create(element, this.#generation);
    return this.#unmount;
  }

  async #create(element: HTMLElement, generation: number): Promise<void> {
    const stale = () => generation !== this.#generation;
    let controller: AvatarController;
    try {
      const { AvatarController } = await import('./AvatarController.ts');
      if (stale()) return;
      controller = new AvatarController(element);
    } catch (error) {
      if (stale()) return;
      this.#set({
        controller: null,
        status: {
          kind: 'unavailable',
          message: `3D isn't available here (${message(error)}), so calls are voice only.`,
        },
      });
      return;
    }

    this.#set({ controller, status: { kind: 'loading', progress: null } });
    // Development only (stripped from builds): drive the avatar from the console.
    if (import.meta.env.DEV) Object.assign(window, { __cccAvatar: controller });
    try {
      await controller.load((progress) => {
        if (!stale()) this.#set({ controller, status: { kind: 'loading', progress } });
      });
      if (!stale()) this.#set({ controller, status: { kind: 'ready' } });
    } catch (error) {
      if (stale()) return;
      this.#set({
        controller,
        status: {
          kind: 'failed',
          message: `The avatar didn't load (${message(error)}). Run \`pnpm avatar:fetch\` and reload; calls still work.`,
        },
      });
    }
  }

  // React StrictMode unmounts and remounts effects in development; wait a tick so
  // the remount keeps this avatar instead of downloading 37 MB again.
  #unmount = (): void => {
    window.clearTimeout(this.#disposeTimer);
    this.#disposeTimer = window.setTimeout(() => {
      this.#generation += 1;
      this.#snapshot.controller?.dispose();
      this.#element = null;
      this.#set({ controller: null, status: { kind: 'loading', progress: null } });
    }, 0);
  };

  #set(snapshot: AvatarSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}
