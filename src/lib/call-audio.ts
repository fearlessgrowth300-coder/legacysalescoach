// Live call with two audio sources, so we know who is talking:
//   your microphone            -> "You"
//   the call's shared audio    -> "Prospect" (Zoom/Meet/Teams tab or screen, "share audio" ticked)
// Talk time is measured from each source's loudness; the prospect's speech is
// recorded in short chunks and transcribed on the server (the browser's speech
// recognition can only listen to the mic).

export type TalkTime = { youMs: number; themMs: number };

// Loudness (RMS) above this counts as talking. Calibration knob: raise it if
// background noise counts as talking, lower it if quiet speech is missed.
const SPEAKING_RMS = 0.02;
const TICK_MS = 200;
const CHUNK_MS = 6000;

function levelMeter(ctx: AudioContext, stream: MediaStream): () => number {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  return () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  };
}

/** Share the call tab/screen with audio. Returns null if the user cancelled or didn't share audio. */
export async function captureCallAudio(): Promise<MediaStream | null> {
  try {
    const shared = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (shared.getAudioTracks().length === 0) {
      shared.getTracks().forEach((t) => t.stop());
      return null;
    }
    return shared;
  } catch {
    return null;
  }
}

/**
 * Start measuring talk time and recording the prospect's side in chunks.
 * onProspectAudio gets each chunk that contained speech (with its start time).
 * Returns stop().
 */
export function startTwoSidedCall(opts: {
  mic: MediaStream;
  call: MediaStream;
  onTalk: (t: TalkTime) => void;
  onProspectAudio: (audio: Blob, startedAt: Date) => void;
}): () => void {
  const ctx = new AudioContext();
  const micLevel = levelMeter(ctx, opts.mic);
  const callLevel = levelMeter(ctx, opts.call);
  const callAudioOnly = new MediaStream(opts.call.getAudioTracks());
  const talk: TalkTime = { youMs: 0, themMs: 0 };
  let prospectSpokeInChunk = false;
  let stopped = false;

  const tick = setInterval(() => {
    const you = micLevel();
    const them = callLevel();
    // Both "talking" usually means the prospect leaking into your mic (speakers): louder side wins.
    if (them > SPEAKING_RMS && them >= you) { talk.themMs += TICK_MS; prospectSpokeInChunk = true; }
    else if (you > SPEAKING_RMS) talk.youMs += TICK_MS;
    opts.onTalk({ ...talk });
  }, TICK_MS);

  // A fresh recorder per chunk so every chunk is a complete, decodable file.
  const recordChunk = () => {
    if (stopped) return;
    const recorder = new MediaRecorder(callAudioOnly);
    const parts: Blob[] = [];
    const startedAt = new Date();
    prospectSpokeInChunk = false;
    recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    recorder.onstop = () => {
      if (prospectSpokeInChunk && parts.length) opts.onProspectAudio(new Blob(parts, { type: recorder.mimeType || "audio/webm" }), startedAt);
      recordChunk();
    };
    recorder.start();
    setTimeout(() => recorder.state !== "inactive" && recorder.stop(), CHUNK_MS);
  };
  recordChunk();

  return () => {
    stopped = true;
    clearInterval(tick);
    ctx.close().catch(() => {});
    opts.call.getTracks().forEach((t) => t.stop());
    opts.mic.getTracks().forEach((t) => t.stop());
  };
}

/** Percent of talk time that was you (0-100), or null before anyone spoke. */
export const youTalkPercent = (t: TalkTime) =>
  t.youMs + t.themMs > 0 ? Math.round((100 * t.youMs) / (t.youMs + t.themMs)) : null;
