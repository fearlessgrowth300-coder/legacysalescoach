// Realistic voice practice: one live audio connection to Gemini Live.
// Your mic streams up as 16 kHz PCM; the prospect's voice streams back as
// 24 kHz PCM (~1 s to first word). Both sides come back as text transcripts.
// The prospect can hang up by calling the `end_call` tool.
// The browser only ever holds a short-lived single-use token, never the API key.

export type LiveTurn = { role: "user" | "assistant"; text: string; timestamp: string };

export type LiveVoiceOptions = {
  wsUrl: string;
  setup: Record<string, unknown>;
  /** Fired when a turn is complete (text final). */
  onTurn: (turn: LiveTurn) => void;
  /** The prospect ended the call (end_call tool) — reason from the model. */
  onHangUp: (reason: string) => void;
  onSpeaking?: (speaking: boolean) => void;
  onError?: (message: string) => void;
};

// AudioWorklet: mic float32 at the device rate -> 16 kHz PCM16, posted in ~100 ms blocks.
const MIC_WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) {
      for (; this.pos < ch.length; this.pos += this.ratio) this.buf.push(ch[Math.floor(this.pos)]);
      this.pos -= ch.length;
      if (this.buf.length >= 1600) {
        const out = new Int16Array(this.buf.length);
        for (let i = 0; i < this.buf.length; i++) out[i] = Math.max(-1, Math.min(1, this.buf[i])) * 0x7fff;
        this.port.postMessage(out.buffer, [out.buffer]);
        this.buf = [];
      }
    }
    return true;
  }
}
registerProcessor("pcm16", Pcm16);`;

// Echo guard (2026-10-12: on speakers the prospect's own voice reached the mic,
// Google took it as you talking and cut him off every few words; it even
// transcribed his voice as "your" Spanish line). While he is talking, the mic is
// only sent if you are clearly louder than the echo (a real interruption).
// Calibration knobs: raise BARGE_IN_RMS if he still gets cut off on speakers,
// lower it if your interruptions aren't heard.
const BARGE_IN_RMS = 0.12;
const ECHO_TAIL_S = 0.35;
// Small buffer before a reply starts so words don't stutter on a slow network.
const JITTER_S = 0.2;

const rms = (pcm: Int16Array) => {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 0x8000) ** 2;
  return Math.sqrt(sum / Math.max(1, pcm.length));
};

const toBase64 = (buf: ArrayBuffer) => {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function startLiveVoice(opts: LiveVoiceOptions): Promise<{ stop: () => void }> {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const micCtx = new AudioContext();
  const outCtx = new AudioContext({ sampleRate: 24000 });
  await micCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([MIC_WORKLET], { type: "application/javascript" })));
  const worklet = new AudioWorkletNode(micCtx, "pcm16");
  micCtx.createMediaStreamSource(mic).connect(worklet);

  const ws = new WebSocket(opts.wsUrl);
  let ready = false;
  let closed = false;
  let playAt = 0;
  const playing = new Set<AudioBufferSourceNode>();
  let userText = "";
  let modelText = "";
  let hangUpReason: string | null = null;

  const flush = (role: "user" | "assistant") => {
    const text = (role === "user" ? userText : modelText).replace(/\s+/g, " ").trim();
    if (role === "user") userText = ""; else modelText = "";
    if (text) opts.onTurn({ role, text, timestamp: new Date().toISOString() });
  };

  const stopPlayback = () => {
    playing.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
    playing.clear();
    playAt = 0;
    opts.onSpeaking?.(false);
  };

  const playPcm = (b64: string) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
    const buf = outCtx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(outCtx.destination);
    playAt = playing.size === 0 ? Math.max(playAt, outCtx.currentTime + JITTER_S) : Math.max(playAt, outCtx.currentTime);
    src.start(playAt);
    playAt += buf.duration;
    playing.add(src);
    opts.onSpeaking?.(true);
    src.onended = () => {
      playing.delete(src);
      if (playing.size === 0) {
        opts.onSpeaking?.(false);
        // Hang up only after the goodbye has finished playing.
        if (hangUpReason !== null) { const r = hangUpReason; hangUpReason = null; opts.onHangUp(r); }
      }
    };
  };

  worklet.port.onmessage = (e) => {
    const prospectTalking = playing.size > 0 || outCtx.currentTime < playAt + ECHO_TAIL_S;
    if (prospectTalking && rms(new Int16Array(e.data)) < BARGE_IN_RMS) return; // echo, not you
    if (ready && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ realtimeInput: { audio: { data: toBase64(e.data), mimeType: "audio/pcm;rate=16000" } } }));
    }
  };

  ws.onopen = () => ws.send(JSON.stringify({ setup: opts.setup }));
  ws.onmessage = async (ev) => {
    const raw = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
    const msg = JSON.parse(raw);
    if (msg.setupComplete) {
      ready = true;
      // The phone rings: the prospect answers first.
      ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: "(Your phone is ringing. Answer it the way you would.)" }] }], turnComplete: true } }));
      return;
    }
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) stopPlayback(); // you talked over them
      if (sc.inputTranscription?.text) userText += sc.inputTranscription.text;
      if (sc.outputTranscription?.text) {
        if (userText.trim()) flush("user"); // they started answering: your turn is done
        modelText += sc.outputTranscription.text;
      }
      for (const part of sc.modelTurn?.parts || []) if (part.inlineData?.data) playPcm(part.inlineData.data);
      if (sc.turnComplete) flush("assistant");
    }
    for (const call of msg.toolCall?.functionCalls || []) {
      if (call.name === "end_call") {
        flush("user");
        flush("assistant");
        ws.send(JSON.stringify({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response: { ok: true } }] } }));
        hangUpReason = String(call.args?.reason || "The prospect hung up.");
        if (playing.size === 0) { const r = hangUpReason; hangUpReason = null; opts.onHangUp(r); }
      }
    }
    if (msg.error) opts.onError?.(msg.error.message || "Live voice error");
  };
  ws.onerror = () => { if (!closed) opts.onError?.("Lost the voice connection."); };
  ws.onclose = (e) => { if (!closed && e.code !== 1000) opts.onError?.(`Voice connection closed (${e.reason || e.code}).`); };

  return {
    stop: () => {
      if (closed) return;
      closed = true;
      flush("user");
      flush("assistant");
      try { ws.close(1000); } catch { /* ignore */ }
      stopPlayback();
      mic.getTracks().forEach((t) => t.stop());
      micCtx.close().catch(() => {});
      outCtx.close().catch(() => {});
    },
  };
}
