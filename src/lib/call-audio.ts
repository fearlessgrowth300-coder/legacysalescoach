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
const TICK_MS = 100;
// Send the prospect's words as soon as they pause (not on a fixed timer):
// a pause this long ends the chunk; a chunk never runs longer than MAX_CHUNK_MS.
const PAUSE_MS = 700;
const MAX_CHUNK_MS = 8000;

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
  let silentMs = 0;
  let chunkMs = 0;
  let stopped = false;
  let recorder: { rec: MediaRecorder; hadSpeech: boolean } | null = null;

  // A fresh recorder per chunk so every chunk is a complete, decodable file.
  const recordChunk = () => {
    if (stopped) return;
    const rec = new MediaRecorder(callAudioOnly);
    const chunk = { rec, hadSpeech: false };
    const parts: Blob[] = [];
    const startedAt = new Date();
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.onstop = () => {
      if (chunk.hadSpeech && parts.length) opts.onProspectAudio(new Blob(parts, { type: rec.mimeType || "audio/webm" }), startedAt);
    };
    prospectSpokeInChunk = false;
    silentMs = 0;
    chunkMs = 0;
    rec.start();
    recorder = chunk;
  };
  const cutChunk = () => {
    const done = recorder;
    if (done) done.hadSpeech = prospectSpokeInChunk;
    recordChunk(); // start the next one first so no words are lost
    if (done && done.rec.state !== "inactive") done.rec.stop();
  };

  const tick = setInterval(() => {
    const you = micLevel();
    const them = callLevel();
    chunkMs += TICK_MS;
    // Both "talking" usually means the prospect leaking into your mic (speakers): louder side wins.
    if (them > SPEAKING_RMS && them >= you) { talk.themMs += TICK_MS; prospectSpokeInChunk = true; silentMs = 0; }
    else {
      silentMs += TICK_MS;
      if (you > SPEAKING_RMS) talk.youMs += TICK_MS;
    }
    opts.onTalk({ ...talk });
    if (prospectSpokeInChunk && (silentMs >= PAUSE_MS || chunkMs >= MAX_CHUNK_MS)) cutChunk();
    else if (!prospectSpokeInChunk && chunkMs >= MAX_CHUNK_MS) cutChunk(); // drop long silence
  }, TICK_MS);
  recordChunk();

  return () => {
    stopped = true;
    clearInterval(tick);
    if (recorder) { recorder.hadSpeech = prospectSpokeInChunk; if (recorder.rec.state !== "inactive") recorder.rec.stop(); }
    ctx.close().catch(() => {});
    opts.call.getTracks().forEach((t) => t.stop());
    opts.mic.getTracks().forEach((t) => t.stop());
  };
}

/** Percent of talk time that was you (0-100), or null before anyone spoke. */
export const youTalkPercent = (t: TalkTime) =>
  t.youMs + t.themMs > 0 ? Math.round((100 * t.youMs) / (t.youMs + t.themMs)) : null;
