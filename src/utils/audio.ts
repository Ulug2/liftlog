/**
 * Tiny rest-over chime with WebAudio (no files). iOS only allows audio after a tap,
 * so `unlockAudio()` is called when a set is checked off.
 */
let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* no audio */
  }
}

export function chime() {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  [0, 0.18].forEach((offset, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = i === 0 ? 880 : 1320;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.18);
  });
}
