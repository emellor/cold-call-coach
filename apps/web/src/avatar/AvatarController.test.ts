// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => {
  class FakeNode {
    connections = new Set<unknown>();
    connect<T>(node: T): T {
      this.connections.add(node);
      return node;
    }
    disconnect(node?: unknown) {
      if (node === undefined) this.connections.clear();
      else this.connections.delete(node);
    }
  }

  class FakeTalkingHead {
    static last: FakeTalkingHead;
    options: Record<string, unknown>;
    opt: { update: ((dt: number) => void) | null };
    audioAnalyzerNode = new FakeNode();
    audioSpeechGainNode = new FakeNode();
    audioReverbNode = new FakeNode();
    sources: FakeNode[] = [];
    audioCtx = {
      audioWorklet: { addModule: vi.fn(() => Promise.resolve()) },
      createMediaStreamSource: vi.fn((stream: unknown) => {
        const source = Object.assign(new FakeNode(), { stream });
        this.sources.push(source);
        return source;
      }),
      resume: vi.fn(() => Promise.resolve()),
      suspend: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
    };
    mtAvatar: Record<string, { newvalue: number | null; needsUpdate: boolean }> = {
      viseme_aa: { newvalue: null, needsUpdate: false },
    };
    isRunning = false;
    animQueue: unknown[] = [];
    showAvatar = vi.fn(() => {
      this.isRunning = true;
      return Promise.resolve();
    });
    setMood = vi.fn();
    lookAtCamera = vi.fn();
    makeEyeContact = vi.fn();
    speakWithHands = vi.fn();
    animFactory = vi.fn((template: unknown) => template);
    start = vi.fn(() => {
      this.isRunning = true;
    });
    stop = vi.fn();
    dispose = vi.fn();

    constructor(_element: HTMLElement, options: Record<string, unknown>) {
      this.options = options;
      this.opt = { update: null };
      this.audioSpeechGainNode.connect(this.audioReverbNode);
      FakeTalkingHead.last = this;
    }
  }

  class FakeHeadAudio extends FakeNode {
    static last: FakeHeadAudio;
    ctx: unknown;
    options: unknown;
    loadModel = vi.fn(() => Promise.resolve());
    update = vi.fn();
    start = vi.fn();
    stop = vi.fn();
    onvalue: ((key: string, value: number) => void) | null = null;
    onstarted: (() => void) | null = null;
    onended: (() => void) | null = null;
    constructor(ctx: unknown, options: unknown) {
      super();
      this.ctx = ctx;
      this.options = options;
      FakeHeadAudio.last = this;
    }
  }

  class FakeDelayNode extends FakeNode {
    delayTime: number;
    constructor(_ctx: unknown, options: { delayTime: number }) {
      super();
      this.delayTime = options.delayTime;
    }
  }

  class FakeMediaStream {
    tracks: unknown[];
    constructor(tracks: unknown[]) {
      this.tracks = tracks;
    }
  }

  return { FakeTalkingHead, FakeHeadAudio, FakeDelayNode, FakeMediaStream };
});

vi.mock('@met4citizen/talkinghead', () => ({ TalkingHead: fakes.FakeTalkingHead }));
vi.mock('@met4citizen/headaudio/dist/headaudio.min.mjs', () => ({
  HeadAudio: fakes.FakeHeadAudio,
}));

const { AvatarController } = await import('./AvatarController.ts');

let controller: InstanceType<typeof AvatarController>;
let play: ReturnType<typeof vi.spyOn>;
const head = () => fakes.FakeTalkingHead.last;
const headAudio = () => fakes.FakeHeadAudio.last;

beforeEach(() => {
  vi.stubGlobal('MediaStream', fakes.FakeMediaStream);
  vi.stubGlobal('DelayNode', fakes.FakeDelayNode);
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  controller = new AvatarController(document.createElement('div'));
});

afterEach(() => {
  controller.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AvatarController', () => {
  it('creates TalkingHead in upper-body view, with no TTS and no text lip-sync modules', () => {
    expect(head().options).toMatchObject({
      ttsEndpoint: null,
      lipsyncModules: [],
      cameraView: 'upper',
    });
  });

  it('loads the CC0 sample avatar, then wires HeadAudio into the speech path', async () => {
    await controller.load();
    expect(head().showAvatar).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/avatars/mpfb.glb',
        body: 'F',
        avatarMood: 'neutral',
        lipsyncLang: 'en',
      }),
      expect.any(Function),
    );
    expect(head().audioCtx.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringContaining('headworklet'),
    );
    expect(headAudio().ctx).toBe(head().audioCtx);
    expect(headAudio().options).toEqual({ parameterData: { speakerMeanHz: 220 } });
    expect(headAudio().loadModel).toHaveBeenCalledWith(expect.stringContaining('model-en-mixed'));
    expect(head().audioSpeechGainNode.connections.has(headAudio())).toBe(true);

    head().opt.update?.(16);
    expect(headAudio().update).toHaveBeenCalledWith(16);

    headAudio().onvalue?.('viseme_aa', 0.7);
    expect(head().mtAvatar.viseme_aa).toEqual({ newvalue: 0.7, needsUpdate: true });
  });

  it('turns to camera and gestures only when speech starts after a real pause', async () => {
    await controller.load();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(10_000);
    headAudio().onended?.();

    now.mockReturnValue(10_100);
    headAudio().onstarted?.();
    expect(head().lookAtCamera).not.toHaveBeenCalled();

    now.mockReturnValue(10_150);
    headAudio().onstarted?.();
    expect(head().lookAtCamera).toHaveBeenCalledWith(500);
    expect(head().speakWithHands).toHaveBeenCalledOnce();
  });

  it('routes the agent track through a muted element and into TalkingHead’s analyser', () => {
    const track = { kind: 'audio' } as unknown as MediaStreamTrack;
    controller.attachAgentTrack(track);
    const [source] = head().sources;
    const stream = (source as unknown as { stream: InstanceType<typeof fakes.FakeMediaStream> })
      .stream;
    expect(stream.tracks).toEqual([track]);
    expect(source?.connections.has(head().audioAnalyzerNode)).toBe(true);
    expect(play).toHaveBeenCalled();

    controller.detachAgentTrack();
    expect(source?.connections.size).toBe(0);
  });

  it('inserts and removes the optional lip-sync delay between speech gain and reverb', () => {
    const { audioSpeechGainNode: gain, audioReverbNode: reverb } = head();
    controller.setLipSyncDelay(true);
    expect(gain.connections.has(reverb)).toBe(false);
    const delay = [...gain.connections].find(
      (n) => n instanceof fakes.FakeDelayNode,
    ) as InstanceType<typeof fakes.FakeDelayNode>;
    expect(delay.delayTime).toBe(0.1);
    expect(delay.connections.has(reverb)).toBe(true);

    controller.setLipSyncDelay(false);
    expect(gain.connections.has(reverb)).toBe(true);
    expect(gain.connections.has(delay)).toBe(false);
  });

  it('pauses rendering and HeadAudio in phone mode without ever suspending the audio', async () => {
    await controller.load();
    controller.setRendering(false);
    expect(head().isRunning).toBe(false);
    expect(headAudio().stop).toHaveBeenCalled();

    controller.setRendering(true);
    expect(head().start).toHaveBeenCalled();
    expect(headAudio().start).toHaveBeenCalled();

    expect(head().stop).not.toHaveBeenCalled();
    expect(head().audioCtx.suspend).not.toHaveBeenCalled();
  });

  it('pauses rendering while the tab is hidden and resumes when it is shown', async () => {
    await controller.load();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(head().isRunning).toBe(false);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(head().isRunning).toBe(true);
    expect(head().audioCtx.suspend).not.toHaveBeenCalled();
  });

  it('applies a mood chosen before the avatar finished loading', async () => {
    controller.setMood('angry');
    expect(head().setMood).not.toHaveBeenCalled();
    await controller.load();
    expect(head().setMood).toHaveBeenCalledWith('angry');
  });

  it('releases TalkingHead and closes its audio context on dispose', () => {
    controller.dispose();
    expect(head().dispose).toHaveBeenCalled();
    expect(head().audioCtx.close).toHaveBeenCalled();
  });
});
