// Neither library ships types. These cover only what AvatarController uses,
// checked against @met4citizen/talkinghead 1.7.0 and @met4citizen/headaudio 0.1.0.

declare module '@met4citizen/talkinghead' {
  export interface TalkingHeadOptions {
    ttsEndpoint?: string | null;
    lipsyncModules?: string[];
    cameraView?: 'full' | 'mid' | 'upper' | 'head';
    cameraDistance?: number;
    cameraX?: number;
    cameraY?: number;
    cameraRotateEnable?: boolean;
    cameraPanEnable?: boolean;
    cameraZoomEnable?: boolean;
    modelFPS?: number;
    modelPixelRatio?: number;
    avatarMood?: string;
    /** Called from the animation loop with the frame delta (ms). */
    update?: ((dt: number) => void) | null;
  }

  export interface AvatarSpec {
    url: string;
    body: 'M' | 'F';
    avatarMood?: string;
    lipsyncLang?: string;
    baseline?: Record<string, number>;
    modelDynamicBones?: unknown[];
  }

  export interface MorphTargetState {
    newvalue: number | null;
    needsUpdate: boolean;
  }

  export class TalkingHead {
    constructor(node: HTMLElement, opt?: TalkingHeadOptions);
    opt: Required<Pick<TalkingHeadOptions, 'update'>> & TalkingHeadOptions;
    audioCtx: AudioContext;
    /** Speech input: analyser → speech gain → reverb → destination. */
    audioAnalyzerNode: AnalyserNode;
    audioSpeechGainNode: GainNode;
    audioReverbNode: ConvolverNode;
    mtAvatar: Record<string, MorphTargetState>;
    isRunning: boolean;
    animQueue: unknown[];
    showAvatar(
      avatar: AvatarSpec,
      onprogress?: ((event: ProgressEvent) => void) | null,
    ): Promise<void>;
    setMood(mood: string): void;
    getMoodNames(): string[];
    lookAtCamera(ms: number): void;
    makeEyeContact(ms: number): void;
    speakWithHands(delay?: number, probability?: number): void;
    animFactory(template: object): unknown;
    /** Starts rendering (and resumes the audio context). */
    start(): void;
    /** Stops rendering and suspends the audio context. */
    stop(): void;
    dispose(): void;
  }
}

declare module '@met4citizen/headaudio/dist/headaudio.min.mjs' {
  export interface HeadAudioOptions {
    processorOptions?: Record<string, unknown>;
    parameterData?: Record<string, number>;
  }

  /** Audio-driven lip-sync: an AudioWorkletNode that turns speech into viseme values. */
  export class HeadAudio extends AudioWorkletNode {
    constructor(ctx: BaseAudioContext, options?: HeadAudioOptions | null);
    loadModel(url: string, reset?: boolean): Promise<void>;
    /** Call from the render loop with the frame delta (ms). */
    update(dt: number): void;
    start(): void;
    stop(): void;
    onvalue: ((key: string, value: number) => void) | null;
    onstarted: ((data: { event: 'start'; t: number }) => void) | null;
    onended: ((data: { event: 'end'; t: number }) => void) | null;
  }
}
