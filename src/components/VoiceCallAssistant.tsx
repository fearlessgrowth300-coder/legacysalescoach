import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Phone, PhoneOff, Mic, MicOff, Camera, CameraOff, Monitor, MonitorOff,
  Volume2, Loader2, X, Play, ChevronDown, Brain,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
};

type CallState = "idle" | "setup" | "listening" | "thinking" | "speaking";

const VOICES = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", gender: "Male", desc: "Professional mentor" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "Female", desc: "Warm & confident" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", gender: "Male", desc: "Calm & authoritative" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", gender: "Female", desc: "Energetic & clear" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "Male", desc: "Friendly & engaging" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", gender: "Female", desc: "Professional & smooth" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function VoiceCallAssistant({ open, onClose }: Props) {
  const [callState, setCallState] = useState<CallState>("setup");
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0].id);
  const [consentGiven, setConsentGiven] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentInterim, setCurrentInterim] = useState("");
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isProcessingRef = useRef(false);
  const shouldContinueRef = useRef(false);

  // Scroll transcript to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, currentInterim]);

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      endCall();
    }
  }, [open]);

  const previewVoice = async (voiceId: string) => {
    setPreviewPlaying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-brain`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          question: "Hello! I'm your AI Brain assistant. How can I help you today?",
          mode: "blast",
          voiceId,
        }),
      });
      const data = await resp.json();
      if (data.audio) {
        const audio = new Audio(`data:audio/mpeg;base64,${data.audio}`);
        audio.onended = () => setPreviewPlaying(false);
        await audio.play();
      } else {
        setPreviewPlaying(false);
      }
    } catch {
      setPreviewPlaying(false);
      toast.error("Preview failed");
    }
  };

  const startCall = async () => {
    if (!consentGiven) {
      toast.error("Please accept the privacy consent to continue");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition not supported in this browser");
      return;
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Microphone access is required");
      return;
    }

    shouldContinueRef.current = true;
    setCallState("listening");
    setTranscript([]);
    setCurrentInterim("");
    startListening();
  };

  const startListening = useCallback(() => {
    if (!shouldContinueRef.current) return;
    if (isProcessingRef.current) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalText = "";
    let silenceTimer: any = null;

    recognition.onresult = (event: any) => {
      let interim = "";
      let newFinal = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          newFinal += t;
        } else {
          interim += t;
        }
      }
      if (newFinal) {
        finalText += (finalText ? " " : "") + newFinal;
      }
      setCurrentInterim(finalText + (interim ? " " + interim : ""));

      // Reset silence timer on any result
      clearTimeout(silenceTimer);
      if (finalText.trim()) {
        silenceTimer = setTimeout(() => {
          // User stopped speaking — process
          recognition.stop();
        }, 1800);
      }
    };

    recognition.onend = async () => {
      recognitionRef.current = null;
      const text = finalText.trim();
      if (text && shouldContinueRef.current) {
        setCurrentInterim("");
        await processUserInput(text);
      } else if (shouldContinueRef.current) {
        // No speech detected, restart
        setCurrentInterim("");
        startListening();
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error === "no-speech" && shouldContinueRef.current) {
        // Silently restart
        setTimeout(() => startListening(), 300);
        return;
      }
      if (e.error !== "aborted") {
        console.error("Speech error:", e.error);
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    setCallState("listening");
  }, [selectedVoice, videoEnabled, screenShareEnabled]);

  const processUserInput = async (text: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    // Add user transcript
    setTranscript(prev => [...prev, { role: "user", text, timestamp: new Date() }]);
    setCallState("thinking");

    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Capture frame if video/screen is active
      let frameBase64: string | undefined;
      if ((videoEnabled || screenShareEnabled) && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const sourceVideo = screenShareEnabled
          ? document.querySelector<HTMLVideoElement>("#screen-share-video")
          : video;

        if (sourceVideo && sourceVideo.videoWidth > 0) {
          canvas.width = Math.min(sourceVideo.videoWidth, 640);
          canvas.height = Math.round(canvas.width * (sourceVideo.videoHeight / sourceVideo.videoWidth));
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
          frameBase64 = canvas.toDataURL("image/jpeg", 0.6);
        }
      }

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-brain`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          question: text,
          mode: "full",
          voiceId: selectedVoice,
          frame: frameBase64,
        }),
      });

      const data = await resp.json();

      if (data.text) {
        setTranscript(prev => [...prev, { role: "assistant", text: data.text, timestamp: new Date() }]);
      }

      setCallState("speaking");

      if (data.audio) {
        const audio = new Audio(`data:audio/mpeg;base64,${data.audio}`);
        audioRef.current = audio;
        audio.onended = () => {
          audioRef.current = null;
          isProcessingRef.current = false;
          if (shouldContinueRef.current) {
            startListening();
          }
        };
        await audio.play();
      } else {
        isProcessingRef.current = false;
        if (shouldContinueRef.current) {
          startListening();
        }
      }
    } catch (e) {
      console.error("Voice brain error:", e);
      toast.error("Failed to get response");
      isProcessingRef.current = false;
      if (shouldContinueRef.current) {
        startListening();
      }
    }
  };

  const endCall = useCallback(() => {
    shouldContinueRef.current = false;
    isProcessingRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    setCallState("idle");
    setCurrentInterim("");
    setVideoEnabled(false);
    setScreenShareEnabled(false);
    setMicMuted(false);
  }, []);

  const toggleCamera = async () => {
    if (videoEnabled) {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setVideoEnabled(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: 640, height: 480 } });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setVideoEnabled(true);
        setScreenShareEnabled(false);
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
      } catch {
        toast.error("Camera access denied");
      }
    }
  };

  const toggleScreenShare = async () => {
    if (screenShareEnabled) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      setScreenShareEnabled(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        const screenVideo = document.querySelector<HTMLVideoElement>("#screen-share-video");
        if (screenVideo) screenVideo.srcObject = stream;
        stream.getVideoTracks()[0].onended = () => {
          screenStreamRef.current = null;
          setScreenShareEnabled(false);
        };
        setScreenShareEnabled(true);
        setVideoEnabled(false);
        streamRef.current?.getTracks().forEach(t => t.stop());
      } catch {
        toast.error("Screen share denied");
      }
    }
  };

  const toggleMic = () => {
    if (micMuted) {
      setMicMuted(false);
      if (callState === "listening") startListening();
    } else {
      setMicMuted(true);
      recognitionRef.current?.stop();
    }
  };

  const handleEndCall = () => {
    endCall();
    onClose();
  };

  if (!open) return null;

  const selectedVoiceData = VOICES.find(v => v.id === selectedVoice);
  const isInCall = callState !== "idle" && callState !== "setup";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md" onClick={isInCall ? undefined : handleEndCall} />

      {/* Hidden elements */}
      <canvas ref={canvasRef} className="hidden" />
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />
      {screenShareEnabled && <video id="screen-share-video" autoPlay playsInline muted className="hidden" />}

      {/* Call Card */}
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-3xl border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-300">

        {/* ── SETUP SCREEN ── */}
        {callState === "setup" && (
          <div className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Brain className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-bold text-lg">Call The Brain</h2>
                  <p className="text-xs text-muted-foreground">Voice assistant powered by your uploads</p>
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={handleEndCall} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Voice Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Choose Voice</label>
              <div className="flex gap-2">
                <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICES.map(v => (
                      <SelectItem key={v.id} value={v.id}>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{v.name}</span>
                          <span className="text-muted-foreground text-xs">({v.gender}) — {v.desc}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => previewVoice(selectedVoice)}
                  disabled={previewPlaying}
                  title="Preview voice"
                >
                  {previewPlaying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Mode Toggle */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Mode</label>
              <div className="flex gap-2">
                <Button
                  variant={!videoEnabled ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setVideoEnabled(false)}
                >
                  <Volume2 className="h-4 w-4 mr-1.5" /> Audio Only
                </Button>
                <Button
                  variant={videoEnabled ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setVideoEnabled(true)}
                >
                  <Camera className="h-4 w-4 mr-1.5" /> Audio + Video
                </Button>
              </div>
            </div>

            {/* Consent */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/50 border">
              <Checkbox
                id="consent"
                checked={consentGiven}
                onCheckedChange={(c) => setConsentGiven(!!c)}
                className="mt-0.5"
              />
              <label htmlFor="consent" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                I allow temporary audio{videoEnabled ? "/video" : ""} capture for this session. Audio and video are processed in real-time and not stored permanently. Session data is discarded when the call ends.
              </label>
            </div>

            <Button className="w-full h-12 text-base gap-2" onClick={startCall} disabled={!consentGiven}>
              <Phone className="h-5 w-5" /> Start Call
            </Button>
          </div>
        )}

        {/* ── IN-CALL SCREEN ── */}
        {isInCall && (
          <div className="flex flex-col" style={{ height: "min(80vh, 600px)" }}>
            {/* Header */}
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Brain className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">The Brain</p>
                  <p className="text-[10px] text-muted-foreground">{selectedVoiceData?.name} • {selectedVoiceData?.desc}</p>
                </div>
              </div>
              {/* Voice switcher mid-call */}
              <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                <SelectTrigger className="w-auto h-7 text-xs gap-1 border-none bg-muted/50 px-2">
                  <Volume2 className="h-3 w-3" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICES.map(v => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">
                      {v.name} ({v.gender})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Main Area */}
            <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden p-4">
              {/* Camera/Screen Preview */}
              {(videoEnabled || screenShareEnabled) && (
                <div className="absolute top-2 right-2 w-32 h-24 rounded-xl overflow-hidden border-2 border-primary/30 shadow-lg bg-black">
                  {videoEnabled && (
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  )}
                  {screenShareEnabled && (
                    <video id="screen-share-video" autoPlay playsInline muted className="w-full h-full object-cover" />
                  )}
                </div>
              )}

              {/* Animated State Indicator */}
              <div className="relative mb-6">
                {/* Pulsating rings */}
                {callState === "listening" && (
                  <>
                    <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping" style={{ animationDuration: "2s" }} />
                    <div className="absolute -inset-3 rounded-full bg-primary/5 animate-ping" style={{ animationDuration: "3s" }} />
                  </>
                )}
                {callState === "speaking" && (
                  <>
                    <div className="absolute -inset-2 rounded-full bg-primary/20 animate-pulse" />
                    <div className="absolute -inset-4 rounded-full bg-primary/10 animate-pulse" style={{ animationDelay: "200ms" }} />
                  </>
                )}

                <div className={`relative h-24 w-24 rounded-full flex items-center justify-center transition-all duration-500 ${
                  callState === "listening" ? "bg-primary/10 ring-4 ring-primary/20" :
                  callState === "thinking" ? "bg-muted" :
                  callState === "speaking" ? "bg-primary/15 ring-4 ring-primary/30" : "bg-muted"
                }`}>
                  {callState === "listening" && <Mic className="h-10 w-10 text-primary" />}
                  {callState === "thinking" && <Loader2 className="h-10 w-10 text-primary animate-spin" />}
                  {callState === "speaking" && (
                    <div className="flex items-end gap-1 h-10">
                      {[0, 1, 2, 3, 4].map(i => (
                        <div
                          key={i}
                          className="w-1.5 bg-primary rounded-full animate-bounce"
                          style={{
                            height: `${12 + Math.random() * 28}px`,
                            animationDelay: `${i * 100}ms`,
                            animationDuration: "0.6s",
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* State Label */}
              <p className="text-sm font-semibold mb-1">
                {callState === "listening" ? "Listening..." :
                 callState === "thinking" ? "Thinking..." :
                 callState === "speaking" ? "Speaking..." : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {callState === "listening" ? "Speak naturally — I'm ready" :
                 callState === "thinking" ? "Searching your brain..." :
                 callState === "speaking" ? "Listen to the response" : ""}
              </p>

              {/* Current interim transcript */}
              {callState === "listening" && currentInterim && (
                <div className="mt-3 px-4 py-2 rounded-xl bg-muted/50 border max-w-sm">
                  <p className="text-sm text-muted-foreground italic">"{currentInterim}"</p>
                </div>
              )}
            </div>

            {/* Transcript Panel */}
            {transcript.length > 0 && (
              <div className="border-t max-h-40">
                <div ref={scrollRef} className="overflow-y-auto p-3 space-y-2 max-h-40">
                  {transcript.map((entry, i) => (
                    <div key={i} className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${
                        entry.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}>
                        {entry.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Controls Bar */}
            <div className="p-4 border-t flex items-center justify-center">
              <div className="flex items-center gap-3 px-6 py-2 rounded-full bg-muted/50 border">
                <button
                  onClick={toggleCamera}
                  className={`h-12 w-12 rounded-full flex items-center justify-center transition-all ${
                    videoEnabled ? "bg-primary text-primary-foreground" : "bg-background border hover:bg-muted"
                  }`}
                  title={videoEnabled ? "Turn off camera" : "Turn on camera"}
                >
                  {videoEnabled ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
                </button>

                <button
                  onClick={toggleScreenShare}
                  className={`h-12 w-12 rounded-full flex items-center justify-center transition-all ${
                    screenShareEnabled ? "bg-primary text-primary-foreground" : "bg-background border hover:bg-muted"
                  }`}
                  title={screenShareEnabled ? "Stop sharing" : "Share screen"}
                >
                  {screenShareEnabled ? <Monitor className="h-5 w-5" /> : <MonitorOff className="h-5 w-5" />}
                </button>

                <button
                  onClick={toggleMic}
                  className={`h-12 w-12 rounded-full flex items-center justify-center transition-all ${
                    micMuted ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-background border hover:bg-muted"
                  }`}
                  title={micMuted ? "Unmute" : "Mute"}
                >
                  {micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>

                <button
                  onClick={handleEndCall}
                  className="h-12 w-12 rounded-full flex items-center justify-center bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all"
                  title="End call"
                >
                  <PhoneOff className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Initial idle → setup transition */}
        {callState === "idle" && (
          <div className="p-6 text-center space-y-4">
            <Brain className="h-12 w-12 mx-auto text-primary/40" />
            <p className="text-sm text-muted-foreground">Call ended</p>
            <Button onClick={() => setCallState("setup")} variant="outline">
              Start New Call
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
