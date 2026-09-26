// Wraps TalkingHead (the 3D avatar) and HeadAudio (audio-driven lip-sync),
// following HeadAudio's openai.html demo adapted to a LiveKit audio track
// (PLAN.md §7). Plain TypeScript: React only mounts it.
import { HeadAudio } from '@met4citizen/headaudio/dist/headaudio.min.mjs';
import workletUrl from '@met4citizen/headaudio/dist/headworklet.min.mjs?url';
import modelUrl from '@met4citizen/headaudio/dist/model-en-mixed.bin?url';
import { TalkingHead } from '@met4citizen/talkinghead';
import {
  AVATAR_URL,
  CAMERA,
  LIP_SYNC_DELAY_S,
  MPFB_BASELINE,
  MPFB_DYNAMIC_BONES,
  type Mood,
  SPEAKER_MEAN_HZ,
} from './config.ts';

/** A pause at least this long before speech marks a new sentence (HeadAudio's demo). */
const NEW_SENTENCE_GAP_MS = 150;

export class AvatarController {
  readonly #head: TalkingHead;
  #headAudio: HeadAudio | null = null;
  #track: { element: HTMLAudioElement; source: MediaStreamAudioSourceNode } | null = null;
  #delay: DelayNode | null = null;
  #renderWanted = true;
  #pageVisible = document.visibilityState !== 'hidden';
  #listeningTimer: number | undefined;
  #mood: Mood = 'neutral';
  #loaded = false;
  #disposed = false;

  /** Throws if WebGL is unavailable; the caller falls back to plain audio. */
  constructor(container: HTMLElement) {
    this.#head = new TalkingHead(container, {
      ttsEndpoint: null,
      // HeadAudio drives the mouth from the audio itself, so TalkingHead's text
      // lip-sync modules are never used. They are also loaded by a runtime-computed
      // relative import that Vite's production build cannot follow.
      lipsyncModules: [],
      cameraView: CAMERA.view,
      cameraDistance: CAMERA.distance,
      cameraX: CAMERA.x,
      cameraY: CAMERA.y,
      cameraRotateEnable: false,
    });
    document.addEventListener('visibilitychange', this.#onVisibilityChange);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Downloads and shows the avatar, then wires up lip-sync. */
  async load(onProgress?: (fraction: number | null) => void): Promise<void> {
    await this.#head.showAvatar(
      {
        url: AVATAR_URL,
        body: 'F',
        avatarMood: 'neutral',
        lipsyncLang: 'en',
        baseline: MPFB_BASELINE,
        modelDynamicBones: MPFB_DYNAMIC_BONES,
      },
      (event) =>
        onProgress?.(event.lengthComputable && event.total ? event.loaded / event.total : null),
    );
    if (this.#disposed) return;
    await this.#initLipSync();
    this.#loaded = true;
    this.#head.setMood(this.#mood);
    this.#applyRendering();
  }

  async #initLipSync(): Promise<void> {
    const head = this.#head;
    await head.audioCtx.audioWorklet.addModule(workletUrl);
    const headAudio = new HeadAudio(head.audioCtx, {
      parameterData: { speakerMeanHz: SPEAKER_MEAN_HZ },
    });
    await headAudio.loadModel(modelUrl);

    head.audioSpeechGainNode.connect(headAudio);
    headAudio.onvalue = (key, value) => {
      const target = head.mtAvatar[key];
      if (target) Object.assign(target, { newvalue: value, needsUpdate: true });
    };
    head.opt.update = headAudio.update.bind(headAudio);

    let lastEnded = 0;
    headAudio.onended = () => {
      lastEnded = Date.now();
    };
    headAudio.onstarted = () => {
      if (Date.now() - lastEnded >= NEW_SENTENCE_GAP_MS) {
        head.lookAtCamera(500);
        head.speakWithHands();
      }
    };
    this.#headAudio = headAudio;
  }

  /**
   * Routes the prospect's voice through TalkingHead's audio graph
   * (analyser → speech gain → reverb → speakers), which HeadAudio listens to.
   * This is the only path her voice takes, avatar shown or not.
   */
  attachAgentTrack(track: MediaStreamTrack): void {
    this.detachAgentTrack();
    const stream = new MediaStream([track]);
    // Chrome won't run Web Audio on a remote WebRTC stream unless a media element
    // also consumes it. The element is muted: TalkingHead's graph is what you hear.
    const element = new Audio();
    element.muted = true;
    element.srcObject = stream;
    void element.play().catch(() => {});
    const source = this.#head.audioCtx.createMediaStreamSource(stream);
    source.connect(this.#head.audioAnalyzerNode);
    this.#track = { element, source };
  }

  detachAgentTrack(): void {
    if (!this.#track) return;
    this.#track.source.disconnect();
    this.#track.element.srcObject = null;
    this.#track = null;
  }

  /** Call from the Dial click: browsers only start audio from a user gesture. */
  resumeAudio(): void {
    void this.#head.audioCtx.resume();
  }

  /** Optional ~0.1 s DelayNode between speech gain and reverb, so the voice waits for the lips. */
  setLipSyncDelay(enabled: boolean): void {
    const head = this.#head;
    if (enabled && !this.#delay) {
      const delay = new DelayNode(head.audioCtx, { delayTime: LIP_SYNC_DELAY_S });
      head.audioSpeechGainNode.disconnect(head.audioReverbNode);
      head.audioSpeechGainNode.connect(delay);
      delay.connect(head.audioReverbNode);
      this.#delay = delay;
    } else if (!enabled && this.#delay) {
      head.audioSpeechGainNode.disconnect(this.#delay);
      this.#delay.disconnect();
      head.audioSpeechGainNode.connect(head.audioReverbNode);
      this.#delay = null;
    }
  }

  /** Applied now if the avatar is showing, otherwise as soon as it is. */
  setMood(mood: Mood): void {
    this.#mood = mood;
    if (this.#loaded) this.#head.setMood(mood);
  }

  /** Phone mode turns rendering off; the audio path is untouched. */
  setRendering(enabled: boolean): void {
    this.#renderWanted = enabled;
    this.#applyRendering();
  }

  /** While the rep is talking: occasional eye contact and small nods. */
  setListening(listening: boolean): void {
    if (listening === (this.#listeningTimer !== undefined)) return;
    if (!listening) {
      window.clearTimeout(this.#listeningTimer);
      this.#listeningTimer = undefined;
      return;
    }
    const cue = () => {
      if (this.#loaded) {
        this.#head.makeEyeContact(1200 + Math.random() * 1300);
        if (Math.random() < 0.4) this.#smallNod();
      }
      this.#listeningTimer = window.setTimeout(cue, 2500 + Math.random() * 3000);
    };
    this.#listeningTimer = window.setTimeout(cue, 600);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.setListening(false);
    this.detachAgentTrack();
    document.removeEventListener('visibilitychange', this.#onVisibilityChange);
    this.#headAudio?.disconnect();
    this.#headAudio = null;
    this.#head.dispose();
    void this.#head.audioCtx.close();
  }

  /** A shallow, single version of TalkingHead's "yes" head animation. */
  #smallNod(): void {
    this.#head.animQueue.push(
      this.#head.animFactory({
        name: 'nod',
        dt: [
          [180, 260],
          [220, 320],
        ],
        vs: { headMove: [0], headRotateX: [[0.04, 0.08], 0] },
      }),
    );
  }

  #onVisibilityChange = (): void => {
    this.#pageVisible = document.visibilityState !== 'hidden';
    this.#applyRendering();
  };

  /**
   * Rendering and HeadAudio run only while the avatar is both wanted (not phone
   * mode) and visible (the tab is showing). TalkingHead's own stop() would also
   * suspend its audio context and silence the prospect, so the render loop is
   * paused through `isRunning` instead.
   */
  #applyRendering(): void {
    if (!this.#loaded || this.#disposed) return;
    if (this.#renderWanted && this.#pageVisible) {
      if (!this.#head.isRunning) this.#head.start();
      this.#headAudio?.start();
    } else {
      this.#head.isRunning = false;
      this.#headAudio?.stop();
    }
  }
}
