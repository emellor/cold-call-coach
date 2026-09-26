/** A short, soft "click" when the line goes dead. */
export function playHangUpClick(): void {
  if (typeof AudioContext === 'undefined') return;
  try {
    const ctx = new AudioContext();
    const length = Math.floor(ctx.sampleRate * 0.035);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length / 6));
    }
    const source = new AudioBufferSourceNode(ctx, { buffer });
    const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1800, Q: 0.8 });
    const gain = new GainNode(ctx, { gain: 0.4 });
    source.connect(band).connect(gain).connect(ctx.destination);
    source.onended = () => void ctx.close();
    source.start();
  } catch {
    // No usable audio output; the "Call ended" message still shows.
  }
}
