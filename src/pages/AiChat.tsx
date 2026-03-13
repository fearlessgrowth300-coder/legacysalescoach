import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Brain, Send, Loader2, BookOpen, Sparkles, Plus, MessageSquare,
  Image, Link, FileText, Pencil, Trash2, Check, CheckCheck, X, Menu,
  Mic, MicOff, Pin, PinOff, Search, Star, Zap, Video, File, ArrowLeft, Phone, Volume2
} from "lucide-react";
import VoiceCallAssistant from "@/components/VoiceCallAssistant";
import SwipeToDelete from "@/components/SwipeToDelete";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";

type Msg = { id?: string; role: "user" | "assistant"; content: string; image_url?: string | null; image_urls?: string[]; is_edited?: boolean; is_pinned?: boolean; status?: "sending" | "sent" | "delivered" | "read" };
type Conversation = { id: string; title: string; created_at: string; updated_at: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/brain-chat`;

async function streamChat({
  messages,
  onDelta,
  onDone,
  onError,
  onBrainMeta,
}: {
  messages: { role: string; content: string | any[] }[];
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
  onBrainMeta?: (meta: any) => void;
}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) { onError("Not authenticated"); return; }

  let resp: Response;
  try {
    resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ messages }),
    });
  } catch (networkErr) {
    console.error("Network error calling brain-chat:", networkErr);
    onError("Network error — check your connection and try again.");
    return;
  }

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    console.error("brain-chat returned error:", resp.status, data);
    onError(data.error || `Error ${resp.status}`);
    return;
  }
  if (!resp.body) { onError("No response body"); return; }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = false;

  while (!done) {
    const { done: rdone, value } = await reader.read();
    if (rdone) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") { done = true; break; }
      try {
        const parsed = JSON.parse(json);
        // Check for brain metadata
        if (parsed.brain_meta) {
          onBrainMeta?.(parsed.brain_meta);
          continue;
        }
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) onDelta(content);
      } catch {
        buf = line + "\n" + buf;
        break;
      }
    }
  }
  onDone();
}

function generateFollowUps(content: string): string[] {
  const suggestions: string[] = [];
  if (content.includes("objection") || content.includes("price")) {
    suggestions.push("What are the top 5 objection handling techniques?");
    suggestions.push("How do I reframe price discussions?");
  }
  if (content.includes("rapport") || content.includes("relationship")) {
    suggestions.push("Give me more rapport-building scripts");
    suggestions.push("How to transition from rapport to pitch?");
  }
  if (content.includes("close") || content.includes("closing")) {
    suggestions.push("What closing techniques have the highest conversion?");
    suggestions.push("How do I create urgency without being pushy?");
  }
  if (content.includes("follow") || content.includes("up")) {
    suggestions.push("Best follow-up message templates?");
  }
  if (suggestions.length === 0) {
    suggestions.push("Tell me more about this topic");
    suggestions.push("How can I apply this in practice?");
    suggestions.push("What mistakes should I avoid?");
  }
  return suggestions.slice(0, 3);
}

export default function AiChat() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [longPressedMsgIdx, setLongPressedMsgIdx] = useState<number | null>(null);
  const msgLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editText, setEditText] = useState("");
  const [attachedImages, setAttachedImages] = useState<Blob[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ conv_title: string; conv_id: string; content: string; role: string }[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  const [showPinned, setShowPinned] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<(Msg & { conv_title?: string })[]>([]);

  const [followUps, setFollowUps] = useState<string[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Rename state
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  // Long-press context menu
  const [contextMenuConv, setContextMenuConv] = useState<{ id: string; x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Voice Assistant state
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [showVoiceCall, setShowVoiceCall] = useState(false);
  const voiceRecognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Brain status
  const [brainStats, setBrainStats] = useState<{ videos: number; pdfs: number; conversations: number }>({ videos: 0, pdfs: 0, conversations: 0 });
  const [retrievalStats, setRetrievalStats] = useState<{
    chunksRetrieved: number; uniqueSources: number; sources: string[];
    semanticMatches: number; staticMatches: number; dedupSavings: number; embeddingUsed: boolean;
  } | null>(null);
  const [showRetrievalStats, setShowRetrievalStats] = useState(false);

  const scrollToBottom = () => {
    setTimeout(() => {
      const vp = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]");
      if (vp) vp.scrollTop = vp.scrollHeight;
    }, 50);
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  // Load brain stats
  useEffect(() => {
    if (!user) return;
    const loadStats = async () => {
      const [{ count: videoCount }, { count: pdfCount }, { count: convCount }] = await Promise.all([
        supabase.from("knowledge_base_items").select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("type", "url"),
        supabase.from("knowledge_base_items").select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("type", "pdf"),
        supabase.from("learned_insights").select("*", { count: "exact", head: true }).eq("user_id", user.id),
      ]);
      setBrainStats({ videos: videoCount || 0, pdfs: pdfCount || 0, conversations: convCount || 0 });
    };
    loadStats();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadConversations();
  }, [user]);

  const loadConversations = async () => {
    const { data } = await supabase
      .from("ai_conversations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data as Conversation[]);
  };

  const touchConversation = async (convId: string, titleOverride?: string) => {
    const updatePayload: Partial<Conversation> & { updated_at: string } = {
      updated_at: new Date().toISOString(),
      ...(titleOverride ? { title: titleOverride } : {}),
    };

    await supabase.from("ai_conversations").update(updatePayload).eq("id", convId);

    setConversations((prev) => {
      const existing = prev.find((c) => c.id === convId);
      if (!existing) return prev;
      const updated = { ...existing, ...updatePayload } as Conversation;
      return [updated, ...prev.filter((c) => c.id !== convId)];
    });
  };

  useEffect(() => {
    if (!activeConvId) { setMessages([]); setFollowUps([]); return; }
    loadMessages(activeConvId);
  }, [activeConvId]);

  const getSignedUrl = async (publicUrl: string): Promise<string> => {
    try {
      const match = publicUrl.match(/chat-screenshots\/(.+)$/);
      if (!match) return publicUrl;
      const path = match[1];
      const { data, error } = await supabase.storage.from("chat-screenshots").createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) return publicUrl;
      return data.signedUrl;
    } catch { return publicUrl; }
  };

  const loadMessages = async (convId: string) => {
    const { data } = await supabase
      .from("ai_chat_messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    if (data) {
      const mapped = data.map((m: any) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        image_url: m.image_url,
        is_edited: m.is_edited,
        is_pinned: m.is_pinned,
      }));
      // Resolve signed URLs for images
      const withSignedUrls = await Promise.all(
        mapped.map(async (m) => {
          if (m.image_url && m.role === "user") {
            const signed = await getSignedUrl(m.image_url);
            return { ...m, image_url: signed };
          }
          return m;
        })
      );
      setMessages(withSignedUrls);
      const lastAssistant = [...withSignedUrls].reverse().find(m => m.role === "assistant");
      if (lastAssistant) setFollowUps(generateFollowUps(lastAssistant.content));
      else setFollowUps([]);
    }
  };

  const createNewChat = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("ai_conversations")
      .insert({ user_id: user.id, title: "New Chat" })
      .select()
      .single();
    if (data) {
      setConversations(prev => [data as Conversation, ...prev]);
      setActiveConvId(data.id);
      setMessages([]);
      setFollowUps([]);
    }
  };

  const confirmDeleteConversation = (convId: string) => {
    setDeleteConfirmId(convId);
  };

  const deleteConversation = async (convId: string) => {
    await supabase.from("ai_conversations").delete().eq("id", convId);
    setConversations(prev => prev.filter(c => c.id !== convId));
    if (activeConvId === convId) {
      setActiveConvId(null);
      setMessages([]);
    }
    setDeleteConfirmId(null);
  };

  const startRename = (conv: Conversation) => {
    setRenamingConvId(conv.id);
    setRenameText(conv.title);
  };

  const finishRename = async (convId: string) => {
    const trimmed = renameText.trim();
    if (trimmed && trimmed !== conversations.find(c => c.id === convId)?.title) {
      await supabase.from("ai_conversations").update({ title: trimmed }).eq("id", convId);
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: trimmed } : c));
    }
    setRenamingConvId(null);
  };

  const toggleVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { toast.error("Speech recognition not supported in this browser"); return; }
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let finalTranscript = input;
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += (finalTranscript ? " " : "") + t;
        else interim += t;
      }
      setInput(finalTranscript + (interim ? " " + interim : ""));
    };
    recognition.onerror = () => { setIsRecording(false); toast.error("Voice recognition error"); };
    recognition.onend = () => { setIsRecording(false); };
    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
    toast.info("Listening... speak your question");
  };

  // ─── Voice Assistant (Call Mode) ───
  const startVoiceAssistant = useCallback(async () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { toast.error("Speech recognition not supported"); return; }
    setVoiceMode(true);
    setVoiceTranscript("");
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let finalText = "";
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText = transcript;
      }
      setVoiceTranscript(transcript);
    };
    recognition.onend = async () => {
      if (!finalText.trim()) { setVoiceMode(false); return; }
      setVoiceLoading(true);
      setVoiceTranscript(finalText);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-brain`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ question: finalText, mode: "full" }),
        });
        const data = await resp.json();
        if (data.audio) {
          const audioUrl = `data:audio/mpeg;base64,${data.audio}`;
          const audio = new Audio(audioUrl);
          audioRef.current = audio;
          await audio.play();
        }
        if (data.text) toast.success(data.text.substring(0, 120) + "...", { duration: 8000 });
      } catch (e) {
        toast.error("Voice assistant error");
        console.error(e);
      } finally { setVoiceLoading(false); setVoiceMode(false); setVoiceTranscript(""); }
    };
    recognition.onerror = () => { setVoiceMode(false); toast.error("Voice recognition error"); };
    recognition.start();
    voiceRecognitionRef.current = recognition;
    toast.info("🎙️ Speak your question to The Brain...");
  }, []);

  const stopVoiceAssistant = useCallback(() => {
    voiceRecognitionRef.current?.stop();
    audioRef.current?.pause();
    setVoiceMode(false);
    setVoiceLoading(false);
    setVoiceTranscript("");
  }, []);

  const togglePin = async (msgIdx: number) => {
    const msg = messages[msgIdx];
    if (!msg.id) return;
    const newPinned = !msg.is_pinned;
    await supabase.from("ai_chat_messages").update({ is_pinned: newPinned } as any).eq("id", msg.id);
    setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, is_pinned: newPinned } : m));
    toast.success(newPinned ? "Answer pinned!" : "Pin removed");
  };

  const loadPinnedMessages = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("ai_chat_messages")
      .select("*, ai_conversations!ai_chat_messages_conversation_id_fkey(title)")
      .eq("is_pinned", true)
      .order("created_at", { ascending: false });
    if (data) {
      setPinnedMessages(data.map((m: any) => ({
        id: m.id, role: m.role, content: m.content, is_pinned: true,
        conv_title: m.ai_conversations?.title || "Untitled",
      })));
    }
    setShowPinned(true);
    setShowSearch(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !user) return;
    const { data } = await supabase
      .from("ai_chat_messages")
      .select("content, role, conversation_id, ai_conversations!ai_chat_messages_conversation_id_fkey(title)")
      .ilike("content", `%${searchQuery}%`)
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) {
      setSearchResults(data.map((m: any) => ({
        content: m.content, role: m.role, conv_id: m.conversation_id,
        conv_title: m.ai_conversations?.title || "Untitled",
      })));
    }
  };

  // Compress image to max 1200px to reduce upload size
  const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
      if (file.size < 500 * 1024) { resolve(file); return; }
      const img = document.createElement("img");
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxDim = 1200;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio); h = Math.round(h * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.7);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const validFiles: File[] = [];
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name} is over 10MB`); continue; }
      validFiles.push(file);
    }
    if (attachedImages.length + validFiles.length > 10) {
      toast.error("Maximum 10 images allowed"); return;
    }
    // Compress all images in parallel
    const compressed = await Promise.all(validFiles.map(compressImage));
    setAttachedImages(prev => [...prev, ...compressed]);
    compressed.forEach(blob => {
      const reader = new FileReader();
      reader.onload = () => setImagePreviews(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(blob);
    });
    e.target.value = "";
  };

  const uploadImage = async (blob: Blob, index: number): Promise<string | null> => {
    if (!user) return null;
    const ext = blob.type.split("/").pop() || "jpg";
    const path = `${user.id}/ai-chat/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error } = await supabase.storage.from("chat-screenshots").upload(path, blob, {
        contentType: blob.type,
        upsert: true,
      });

      if (!error) {
        const { data: { publicUrl } } = supabase.storage.from("chat-screenshots").getPublicUrl(path);
        return publicUrl;
      }

      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }

    console.error("Upload error:", lastError);
    toast.error(`Failed to upload image ${index + 1}`);
    return null;
  };

  const feedLinkToBrain = async (url: string) => {
    if (!user) return;
    toast.info("Feeding link to AI Brain...");
    try {
      const { data: item } = await supabase
        .from("knowledge_base_items")
        .insert({ user_id: user.id, title: `AI Chat Feed: ${url.substring(0, 50)}`, type: "url", url, status: "processing", brain_type: "both" })
        .select().single();
      if (item) {
        await supabase.functions.invoke("process-knowledge", { body: { itemId: item.id, url, type: "url" } });
        toast.success("Link fed to AI Brain! Knowledge is being processed.");
      }
    } catch { toast.error("Failed to feed link to brain"); }
  };

  // READ-ONLY VAULT: Q&A is saved to ai_chat_messages only (Tier 2: Memory).
  // The brain (sales_brain / knowledge_chunks) is NEVER written to from chat.
  // Knowledge is derived ONLY from uploaded videos/PDFs via process-knowledge.

  const send = async (overrideText?: string) => {
    const text = (overrideText || input).trim();
    if (!text && attachedImages.length === 0) return;
    if (isLoading) return;
    if (!user) return;

    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); }
    setFollowUps([]);

    let convId = activeConvId;
    if (!convId) {
      const { data } = await supabase
        .from("ai_conversations")
        .insert({ user_id: user.id, title: text.substring(0, 50) || "New Chat" })
        .select().single();
      if (!data) { toast.error("Failed to create conversation"); return; }
      convId = data.id;
      setActiveConvId(convId);
      setConversations(prev => [data as Conversation, ...prev]);
    }

    // Upload all images to storage in parallel for persistence
    const displayPreviews = [...imagePreviews]; // base64 data URIs for instant UI display AND for AI
    const uploadResults = await Promise.all(
      attachedImages.map((file, idx) => uploadImage(file, idx))
    );
    const uploadedUrls = uploadResults.filter((url): url is string => url !== null);
    if (attachedImages.length > 0 && uploadedUrls.length === 0) {
      toast.error("All image uploads failed. Please try again.");
      setIsLoading(false);
      return;
    }

    const userMsg: Msg = {
      role: "user",
      content: text || `Analyze ${displayPreviews.length > 1 ? "these images" : "this image"}`,
      image_url: uploadedUrls[0] || null,
      image_urls: displayPreviews.length > 0 ? displayPreviews : undefined,
      status: "sending",
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setAttachedImages([]);
    setImagePreviews([]);
    setIsLoading(true);

    const { data: savedMsg } = await supabase
      .from("ai_chat_messages")
      .insert({ conversation_id: convId, user_id: user.id, role: "user", content: userMsg.content, image_url: uploadedUrls[0] || null })
      .select().single();
    if (savedMsg) {
      userMsg.id = savedMsg.id;
      setMessages(prev => prev.map((m, i) => i === prev.length - 1 && m.role === "user" ? { ...m, id: savedMsg.id, status: "sent" as const } : m));
    }

    if (messages.length === 0 && text) {
      await touchConversation(convId, text.substring(0, 60));
    } else {
      await touchConversation(convId);
    }

    setMessages(prev => prev.map(m => m.id === savedMsg?.id ? { ...m, status: "delivered" as const } : m));
    setIsTyping(true);

    // Helper: download image from private storage via authenticated supabase client
    const downloadImageAsBase64 = async (storageUrl: string): Promise<string | null> => {
      try {
        const match = storageUrl.match(/chat-screenshots\/(.+)$/);
        if (!match) return null;
        const path = match[1];
        const { data, error } = await supabase.storage.from("chat-screenshots").download(path);
        if (error || !data) return null;
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(data);
        });
      } catch { return null; }
    };

    // Build AI messages — use base64 data URIs directly (private bucket URLs won't work for edge fn)
    const allMsgs = [...messages, userMsg];
    const aiMessages: any[] = [];
    for (let idx = 0; idx < allMsgs.length; idx++) {
      const m = allMsgs[idx];
      const isCurrentMsg = idx === messages.length;

      let base64Imgs: string[] = [];
      if (isCurrentMsg && displayPreviews.length > 0) {
        base64Imgs = displayPreviews;
      } else if (m.image_url && m.role === "user") {
        const b64 = await downloadImageAsBase64(m.image_url);
        if (b64) base64Imgs = [b64];
      }

      if (base64Imgs.length > 0 && m.role === "user") {
        const parts: any[] = [{ type: "text", text: m.content }];
        for (const img of base64Imgs) {
          parts.push({ type: "image_url", image_url: { url: img } });
        }
        aiMessages.push({ role: m.role, content: parts });
      } else {
        aiMessages.push({ role: m.role, content: m.content });
      }
    }

    let assistantSoFar = "";
    const questionText = text;
    const upsert = (chunk: string) => {
      setIsTyping(false);
      assistantSoFar += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      await streamChat({
        messages: aiMessages,
        onDelta: upsert,
        onBrainMeta: (meta) => {
          if (meta.brainRetrieval && meta.brainRetrieval.chunksRetrieved > 0) {
            const sources = (meta.brainRetrieval.sources || []).join(", ") || "brain";
            toast.info(`🧠 Pulled from brain: ${meta.brainRetrieval.chunksRetrieved} chunks | Sources: ${sources}`, { duration: 4000 });
          }
        },
        onDone: async () => {
          setIsLoading(false);
          setIsTyping(false);
          if (savedMsg?.id) {
            setMessages(prev => prev.map(m => m.id === savedMsg.id ? { ...m, status: "read" as const } : m));
          }
          if (assistantSoFar && convId) {
            await supabase.from("ai_chat_messages").insert({
              conversation_id: convId, user_id: user!.id, role: "assistant", content: assistantSoFar,
            });
            // Q&A saved to ai_chat_messages only — brain is read-only vault
          }
          setFollowUps(generateFollowUps(assistantSoFar));
        },
        onError: (err) => { toast.error(err); setIsLoading(false); setIsTyping(false); },
      });
    } catch (e) {
      console.error("AI chat error:", e);
      toast.error(e instanceof Error ? e.message : "Failed to get response");
      setIsLoading(false);
      setIsTyping(false);
    }
  };

  const [editImages, setEditImages] = useState<string[]>([]);
  const [editNewImages, setEditNewImages] = useState<Blob[]>([]);
  const [editNewPreviews, setEditNewPreviews] = useState<string[]>([]);
  const editFileRef = useRef<HTMLInputElement>(null);

  const startEdit = (idx: number) => {
    if (messages[idx].role !== "user") return;
    setEditingMsgIdx(idx);
    setEditText(messages[idx].content);
    // Load existing images for editing
    const existing = messages[idx].image_urls || (messages[idx].image_url ? [messages[idx].image_url!] : []);
    setEditImages(existing);
    setEditNewImages([]);
    setEditNewPreviews([]);
  };

  const handleEditImageAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name} too large`); continue; }
      const compressed = await compressImage(file);
      setEditNewImages(prev => [...prev, compressed]);
      const reader = new FileReader();
      reader.onload = () => setEditNewPreviews(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(compressed);
    }
    e.target.value = "";
  };

  const saveEdit = async () => {
    if (editingMsgIdx === null) return;
    const msg = messages[editingMsgIdx];

    // Upload new images
    const newUploadedUrls = await Promise.all(editNewImages.map((blob, idx) => uploadImage(blob, idx)));
    const validNewUrls = newUploadedUrls.filter((u): u is string => u !== null);

    // Combine existing kept images + new uploaded URLs (not previews)
    const allImageUrls = [...editImages, ...validNewUrls];
    const primaryUrl = allImageUrls[0] || null;

    // Keep the base64 previews for new images to send to AI (private bucket URLs won't work)
    const newImageBase64s = [...editNewPreviews];

    if (msg.id) {
      await supabase.from("ai_chat_messages").update({ content: editText, is_edited: true, image_url: primaryUrl }).eq("id", msg.id);
    }
    const truncated = messages.slice(0, editingMsgIdx);
    truncated.push({ ...msg, content: editText, is_edited: true, image_url: primaryUrl, image_urls: allImageUrls.length > 0 ? allImageUrls : undefined });
    if (activeConvId) {
      const idsToDelete = messages.slice(editingMsgIdx + 1).filter(m => m.id).map(m => m.id!);
      if (idsToDelete.length > 0) await supabase.from("ai_chat_messages").delete().in("id", idsToDelete);
    }
    setMessages(truncated);
    setEditingMsgIdx(null);
    setEditText("");
    setFollowUps([]);
    setIsLoading(true);
    setIsTyping(true);

    // Helper to download stored images as base64 for AI
    const downloadImageAsBase64Edit = async (storageUrl: string): Promise<string | null> => {
      try {
        const match = storageUrl.match(/chat-screenshots\/(.+)$/);
        if (!match) return null;
        const path = match[1];
        const { data, error } = await supabase.storage.from("chat-screenshots").download(path);
        if (error || !data) return null;
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(data);
        });
      } catch { return null; }
    };

    // Build AI messages with proper base64 images
    const editedMsgIdx = truncated.length - 1;
    const aiMessages: any[] = [];
    for (let idx = 0; idx < truncated.length; idx++) {
      const m = truncated[idx];
      const isEditedMsg = idx === editedMsgIdx;

      let base64Imgs: string[] = [];
      if (isEditedMsg) {
        // For the edited message: use base64 previews for new images, download existing kept images
        for (const existingUrl of editImages) {
          const b64 = await downloadImageAsBase64Edit(existingUrl);
          if (b64) base64Imgs.push(b64);
        }
        base64Imgs.push(...newImageBase64s);
      } else if (m.image_url && m.role === "user") {
        const b64 = await downloadImageAsBase64Edit(m.image_url);
        if (b64) base64Imgs = [b64];
      }

      if (base64Imgs.length > 0 && m.role === "user") {
        const parts: any[] = [{ type: "text", text: m.content }];
        for (const img of base64Imgs) {
          parts.push({ type: "image_url", image_url: { url: img } });
        }
        aiMessages.push({ role: m.role, content: parts });
      } else {
        aiMessages.push({ role: m.role, content: m.content });
      }
    }

    let assistantSoFar = "";
    const questionText = editText;
    const upsert = (chunk: string) => {
      setIsTyping(false);
      assistantSoFar += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      await streamChat({
        messages: aiMessages,
        onDelta: upsert,
        onBrainMeta: (meta) => {
          if (meta.brainRetrieval?.chunksRetrieved > 0) {
            const sources = (meta.brainRetrieval.sources || []).join(", ") || "brain";
            toast.info(`🧠 Pulled from brain: ${meta.brainRetrieval.chunksRetrieved} chunks | Sources: ${sources}`, { duration: 4000 });
          }
        },
        onDone: async () => {
          setIsLoading(false);
          setIsTyping(false);
          if (assistantSoFar && activeConvId) {
            await supabase.from("ai_chat_messages").insert({
              conversation_id: activeConvId, user_id: user!.id, role: "assistant", content: assistantSoFar,
            });
            // Q&A saved to ai_chat_messages only — brain is read-only vault
          }
          setFollowUps(generateFollowUps(assistantSoFar));
        },
        onError: (err) => { toast.error(err); setIsLoading(false); setIsTyping(false); },
      });
    } catch { setIsLoading(false); }
  };

  const handleFeedLink = async () => {
    if (!linkInput.trim()) return;
    await feedLinkToBrain(linkInput.trim());
    setInput(`I just fed this link to my brain: ${linkInput.trim()} - Can you tell me what you know about this topic?`);
    setLinkInput("");
    setShowLinkInput(false);
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.name.endsWith(".pdf")) { toast.error("Only PDF files supported"); return; }
    
    toast.info("Uploading PDF to AI Brain...");
    const path = `${user.id}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from("knowledge-files").upload(path, file);
    if (uploadError) { toast.error("Upload failed"); return; }
    const { data: item } = await supabase
      .from("knowledge_base_items")
      .insert({ user_id: user.id, title: `AI Chat: ${file.name}`, type: "pdf", file_path: path, status: "processing", brain_type: "both" })
      .select().single();
    if (item) {
      await supabase.functions.invoke("process-knowledge", { body: { itemId: item.id, type: "pdf", filePath: path } });
      toast.success("PDF uploaded! Brain is learning from it...");
      setInput(`I just uploaded "${file.name}" to my brain. What can you help me with about it?`);
    }
    e.target.value = "";
  };

  const pdfInputRef = useRef<HTMLInputElement>(null);

  const starterQuestions = [
    "What's the best opening message?",
    "How should I handle price objections?",
    "How do I build rapport quickly?",
    "I need a script for prospecting to network marketers",
    "What closing techniques work best?",
    "How do I follow up without being annoying?",
  ];

  // On mobile: show sidebar when no active chat, show chat when active
  const showMobileSidebar = isMobile && !activeConvId;
  const showMobileChat = isMobile && !!activeConvId;

  return (
    <div className="flex h-[calc(100dvh-4rem)] overflow-x-hidden" style={{ touchAction: "pan-y" }}>
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this conversation and all its messages. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirmId && deleteConversation(deleteConfirmId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sidebar */}
      {(isMobile ? showMobileSidebar : true) && (
      <div className={`${isMobile ? "w-full" : sidebarOpen ? "w-72" : "w-0"} transition-all duration-200 border-r bg-muted/30 flex flex-col overflow-hidden`}>
        <div className="p-3 border-b flex items-center justify-between gap-1" style={{ height: "var(--chat-header-h)" }}>
          <h3 className="font-semibold text-sm">Chats</h3>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setShowSearch(!showSearch); setShowPinned(false); }} title="Search chats">
              <Search className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={loadPinnedMessages} title="Pinned answers">
              <Star className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={createNewChat}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {showSearch && (
          <div className="p-2 border-b space-y-2">
            <div className="flex gap-1">
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search all conversations..." className="h-8 text-xs" onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }} />
              <Button size="sm" className="h-8 px-2" onClick={handleSearch}><Search className="h-3 w-3" /></Button>
            </div>
            {searchResults.length > 0 && (
              <ScrollArea className="max-h-60">
                <div className="space-y-1">
                  {searchResults.map((r, i) => (
                    <div key={i} className="p-2 rounded-md bg-background hover:bg-muted cursor-pointer text-xs" onClick={() => { setActiveConvId(r.conv_id); setShowSearch(false); setSearchResults([]); setSearchQuery(""); }}>
                      <p className="font-medium text-[10px] text-muted-foreground mb-0.5">{r.conv_title} • {r.role}</p>
                      <p className="line-clamp-2">{r.content}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        {showPinned && (
          <div className="p-2 border-b">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium flex items-center gap-1"><Star className="h-3 w-3 text-primary" /> Pinned Answers</p>
              <Button size="sm" variant="ghost" className="h-6" onClick={() => setShowPinned(false)}><X className="h-3 w-3" /></Button>
            </div>
            <ScrollArea className="max-h-60">
              <div className="space-y-1">
                {pinnedMessages.length === 0 && <p className="text-xs text-muted-foreground p-2">No pinned answers yet</p>}
                {pinnedMessages.map((m, i) => (
                  <div key={i} className="p-2 rounded-md bg-background text-xs">
                    <p className="font-medium text-[10px] text-muted-foreground mb-0.5">{m.conv_title}</p>
                    <p className="line-clamp-3">{m.content}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversations.map(conv => (
              <SwipeToDelete key={conv.id} onDelete={() => confirmDeleteConversation(conv.id)} onSwipeRight={() => startRename(conv)}>
                <div
                  className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-sm group transition-colors ${activeConvId === conv.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                  onClick={() => { if (!contextMenuConv) { setActiveConvId(conv.id); setShowSearch(false); setShowPinned(false); } }}
                  onTouchStart={(e) => {
                    const touch = e.touches[0];
                    longPressTimer.current = setTimeout(() => {
                      if (navigator.vibrate) navigator.vibrate(50);
                      setContextMenuConv({ id: conv.id, x: touch.clientX, y: touch.clientY });
                    }, 500);
                  }}
                  onTouchEnd={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                  onTouchMove={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenuConv({ id: conv.id, x: e.clientX, y: e.clientY }); }}
                >
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  {renamingConvId === conv.id ? (
                    <form className="flex-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); finishRename(conv.id); }}>
                      <Input value={renameText} onChange={(e) => setRenameText(e.target.value)} className="h-6 text-xs px-1" autoFocus onBlur={() => finishRename(conv.id)} onKeyDown={(e) => { if (e.key === "Escape") { setRenamingConvId(null); } }} />
                    </form>
                  ) : (
                    <span className="truncate flex-1" onDoubleClick={(e) => { e.stopPropagation(); startRename(conv); }}>{conv.title}</span>
                  )}
                  <div className="flex gap-0.5 shrink-0">
                    <Button size="icon" variant="ghost" className="h-6 w-6 hidden md:opacity-0 md:group-hover:opacity-100 md:inline-flex" onClick={(e) => { e.stopPropagation(); startRename(conv); }} title="Rename">
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 hidden md:opacity-0 md:group-hover:opacity-100 md:inline-flex" onClick={(e) => { e.stopPropagation(); confirmDeleteConversation(conv.id); }} title="Delete">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </SwipeToDelete>
            ))}
            {conversations.length === 0 && <p className="text-xs text-muted-foreground text-center p-4">No chats yet. Start a new one!</p>}
          </div>

          {/* Long-press context menu */}
          {contextMenuConv && (
            <div className="fixed inset-0 z-50" onClick={() => setContextMenuConv(null)} onTouchStart={() => setContextMenuConv(null)}>
              <div
                className="absolute bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[160px] z-50"
                style={{ top: contextMenuConv.y, left: Math.min(contextMenuConv.x, window.innerWidth - 180) }}
                onClick={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <button
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition-colors"
                  onClick={() => { const c = conversations.find(c => c.id === contextMenuConv.id); if (c) startRename(c); setContextMenuConv(null); }}
                >
                  <Pencil className="h-4 w-4" /> Rename
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition-colors"
                  onClick={() => { setActiveConvId(contextMenuConv.id); loadPinnedMessages(); setContextMenuConv(null); }}
                >
                  <Pin className="h-4 w-4" /> View Pinned
                </button>
                <div className="h-px bg-border mx-2 my-1" />
                <button
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  onClick={() => { confirmDeleteConversation(contextMenuConv.id); setContextMenuConv(null); }}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
      )}

      {/* Main Chat Area */}
      {(!isMobile || activeConvId) && (
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        {/* Header */}
        <div className="p-2 md:p-3 border-b flex items-center gap-2 md:gap-3" style={{ height: "var(--chat-header-h)" }}>
          {isMobile && activeConvId ? (
            <Button size="icon" variant="ghost" onClick={() => setActiveConvId(null)} className="shrink-0 h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(!sidebarOpen)} className="shrink-0 h-8 w-8 hidden md:inline-flex">
              <Menu className="h-4 w-4" />
            </Button>
          )}
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Brain className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-sm flex items-center gap-1.5 truncate">
              AI Brain <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
            </h2>
            <p className="text-xs text-muted-foreground truncate hidden md:block">Read-only vault — answers from uploads only.</p>
          </div>
          {/* Call Assistant Button */}
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5 text-xs"
            onClick={() => setShowVoiceCall(true)}
          >
            <Phone className="h-3.5 w-3.5" />
            Call Brain
          </Button>
          {/* Voice Call Assistant */}
          <VoiceCallAssistant
            open={showVoiceCall}
            onClose={() => setShowVoiceCall(false)}
            onCallEnd={async (callTranscript) => {
              if (!user || callTranscript.length === 0) return;
              // Create or use active conversation
              let convId = activeConvId;
              if (!convId) {
                const { data } = await supabase
                  .from("ai_conversations")
                  .insert({ user_id: user.id, title: "Voice Call — " + new Date().toLocaleDateString() })
                  .select().single();
                if (!data) return;
                convId = data.id;
                setActiveConvId(convId);
                setConversations(prev => [data as Conversation, ...prev]);
              }
              // Save each transcript entry as a message
              for (const entry of callTranscript) {
                await supabase.from("ai_chat_messages").insert({
                  conversation_id: convId,
                  user_id: user.id,
                  role: entry.role,
                  content: entry.text,
                });
              }
              // Reload messages
              loadMessages(convId);
              toast.success("Voice call transcript saved to chat");
            }}
          />
          {/* Brain Status Badge - hide on mobile */}
          <div className="hidden md:flex items-center gap-1.5 shrink-0">
            <Badge variant="secondary" className="text-[10px] gap-1 py-0.5">
              <Video className="h-2.5 w-2.5" /> {brainStats.videos}
            </Badge>
            <Badge variant="secondary" className="text-[10px] gap-1 py-0.5">
              <File className="h-2.5 w-2.5" /> {brainStats.pdfs}
            </Badge>
          </div>
        </div>

        {/* Old voice overlay removed — using VoiceCallAssistant component now */}

        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-3 max-w-3xl mx-auto">
            {messages.length === 0 && !activeConvId && (
              <div className="text-center py-12">
                <div className="relative inline-block mb-4">
                  <Brain className="h-16 w-16 mx-auto text-primary/40" />
                  <Zap className="h-5 w-5 text-primary absolute -top-1 -right-1 animate-pulse" />
                </div>
                <h3 className="text-xl font-bold mb-1">Your AI Brain is Ready 🧠</h3>
                <p className="text-sm text-muted-foreground mb-2 max-w-md mx-auto">
                  Ask me anything. I learn from every video, PDF, and principle you've ever uploaded.
                </p>
                <div className="flex items-center justify-center gap-2 mb-6">
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Brain className="h-2.5 w-2.5" /> Currently knows {brainStats.videos} videos + {brainStats.pdfs} PDFs + {brainStats.conversations} conversations
                  </Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl mx-auto">
                  {starterQuestions.map((q) => (
                    <Card key={q} className="p-3 cursor-pointer hover:border-primary transition-colors text-left group" onClick={() => setInput(q)}>
                      <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{q}</p>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {messages.length === 0 && activeConvId && (
              <div className="text-center py-12">
                <Brain className="h-14 w-14 mx-auto mb-3 text-primary/30" />
                <p className="text-sm text-muted-foreground">Ask me anything — I'll pull from your entire brain! 🧠</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg p-3 relative group overflow-hidden break-words ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                  onTouchStart={() => {
                    msgLongPressTimer.current = setTimeout(() => {
                      if (navigator.vibrate) navigator.vibrate(50);
                      setLongPressedMsgIdx(prev => prev === i ? null : i);
                    }, 500);
                  }}
                  onTouchEnd={() => { if (msgLongPressTimer.current) clearTimeout(msgLongPressTimer.current); }}
                  onTouchMove={() => { if (msgLongPressTimer.current) clearTimeout(msgLongPressTimer.current); }}
                >
                  {(msg.image_urls || (msg.image_url ? [msg.image_url] : [])).length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {(msg.image_urls || [msg.image_url!]).map((url, imgIdx) => (
                        <img key={imgIdx} src={url} alt={`Attached ${imgIdx + 1}`} className="rounded-md max-h-48 object-cover" />
                      ))}
                    </div>
                  )}
                  {editingMsgIdx === i ? (
                    <div className="space-y-2">
                      {/* Edit images */}
                      {(editImages.length > 0 || editNewPreviews.length > 0) && (
                        <div className="flex flex-wrap gap-2">
                          {editImages.map((url, imgIdx) => (
                            <div key={`existing-${imgIdx}`} className="relative">
                              <img src={url} alt={`Image ${imgIdx + 1}`} className="h-16 rounded-md border" />
                              <button onClick={() => setEditImages(prev => prev.filter((_, ii) => ii !== imgIdx))} className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full h-5 w-5 flex items-center justify-center text-xs">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          {editNewPreviews.map((url, imgIdx) => (
                            <div key={`new-${imgIdx}`} className="relative">
                              <img src={url} alt={`New ${imgIdx + 1}`} className="h-16 rounded-md border" />
                              <button onClick={() => {
                                setEditNewImages(prev => prev.filter((_, ii) => ii !== imgIdx));
                                setEditNewPreviews(prev => prev.filter((_, ii) => ii !== imgIdx));
                              }} className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full h-5 w-5 flex items-center justify-center text-xs">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="bg-background text-foreground min-h-[60px]" autoFocus />
                      <div className="flex gap-1 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => editFileRef.current?.click()}>
                          <Image className="h-3 w-3 mr-1" /> Add Image
                        </Button>
                        <Button size="sm" variant="secondary" onClick={saveEdit}><Check className="h-3 w-3 mr-1" /> Save & Resend</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditingMsgIdx(null); setEditImages([]); setEditNewImages([]); setEditNewPreviews([]); }}><X className="h-3 w-3" /></Button>
                      </div>
                      <input ref={editFileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleEditImageAdd} />
                    </div>
                  ) : (
                    <>
                      {msg.role === "assistant" ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none break-words overflow-hidden [&>*]:max-w-full [&_pre]:overflow-x-auto [&_p]:break-words [&_li]:break-words [&_strong]:break-words [&_h1]:break-words [&_h2]:break-words [&_h3]:break-words [&_blockquote]:break-words">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      )}
                      {msg.is_edited && <span className="text-[10px] opacity-60 mt-1 block">edited</span>}
                      {msg.role === "user" && (
                        <span className="flex items-center justify-end gap-0.5 mt-1">
                          {msg.status === "sending" && <span className="text-[10px] opacity-50">●</span>}
                          {msg.status === "sent" && <Check className="h-3 w-3 opacity-50" />}
                          {msg.status === "delivered" && <CheckCheck className="h-3 w-3 opacity-50" />}
                          {(msg.status === "read" || (!msg.status && msg.id)) && <CheckCheck className="h-3 w-3 text-blue-400" />}
                        </span>
                      )}
                      {/* Desktop: hover icons outside bubble */}
                      <div className={`absolute ${msg.role === "user" ? "-left-16" : "-right-16"} top-1/2 -translate-y-1/2 hidden md:flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity`}>
                        {msg.role === "user" && !isLoading && (
                          <button onClick={() => startEdit(i)} title="Edit"><Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" /></button>
                        )}
                        {msg.role === "assistant" && msg.id && (
                          <button onClick={() => togglePin(i)} title={msg.is_pinned ? "Unpin" : "Pin"}>
                            {msg.is_pinned ? <PinOff className="h-3.5 w-3.5 text-primary" /> : <Pin className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />}
                          </button>
                        )}
                      </div>
                      {/* Mobile: long-press icons */}
                      {longPressedMsgIdx === i && (
                        <div className="flex md:hidden gap-2 mt-1 animate-in fade-in duration-150">
                          {msg.role === "user" && !isLoading && (
                            <button onClick={() => { startEdit(i); setLongPressedMsgIdx(null); }} className="flex items-center gap-1 text-[10px] text-muted-foreground active:text-foreground">
                              <Pencil className="h-3 w-3" /> Edit
                            </button>
                          )}
                          {msg.role === "assistant" && msg.id && (
                            <button onClick={() => { togglePin(i); setLongPressedMsgIdx(null); }} className="flex items-center gap-1 text-[10px] text-muted-foreground active:text-foreground">
                              {msg.is_pinned ? <><PinOff className="h-3 w-3 text-primary" /> Unpin</> : <><Pin className="h-3 w-3" /> Pin</>}
                            </button>
                          )}
                        </div>
                      )}
                      {msg.is_pinned && <span className="text-[10px] text-primary flex items-center gap-0.5 mt-1"><Pin className="h-2.5 w-2.5" /> Pinned</span>}
                    </>
                  )}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-3 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}

            {!isLoading && followUps.length > 0 && messages.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {followUps.map((q, i) => (
                  <button key={i} onClick={() => send(q)} className="text-xs px-3 py-1.5 rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors">
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {imagePreviews.length > 0 && (
          <div className="px-4 pb-1 flex gap-2 flex-wrap">
            {imagePreviews.map((preview, idx) => (
              <div key={idx} className="relative inline-block">
                <img src={preview} alt={`Preview ${idx + 1}`} className="h-16 rounded-md border" />
                <button onClick={() => {
                  setAttachedImages(prev => prev.filter((_, i) => i !== idx));
                  setImagePreviews(prev => prev.filter((_, i) => i !== idx));
                }} className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full h-5 w-5 flex items-center justify-center text-xs">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {showLinkInput && (
          <div className="px-4 pb-1">
            <div className="flex gap-2 items-center bg-muted rounded-lg p-2">
              <Link className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input value={linkInput} onChange={(e) => setLinkInput(e.target.value)} placeholder="Paste YouTube, Instagram, or any URL to feed to brain..." className="h-8 text-sm" onKeyDown={(e) => { if (e.key === "Enter") handleFeedLink(); }} autoFocus />
              <Button size="sm" onClick={handleFeedLink} disabled={!linkInput.trim()}>Feed</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowLinkInput(false)}><X className="h-3 w-3" /></Button>
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="p-3 border-t max-w-3xl mx-auto w-full chat-input-safe">
          <div className="flex gap-2 items-end">
            <div className="flex gap-1 pb-1">
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => fileInputRef.current?.click()} title="Upload screenshot"><Image className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setShowLinkInput(!showLinkInput)} title="Feed link to brain"><Link className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => pdfInputRef.current?.click()} title="Upload PDF to brain"><FileText className="h-4 w-4" /></Button>
              <Button size="icon" variant={isRecording ? "destructive" : "ghost"} className="h-8 w-8" onClick={toggleVoice} title={isRecording ? "Stop recording" : "Voice input"}>
                {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
            </div>
            <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={isRecording ? "Listening... speak now" : "Ask your Sales Brain anything..."} className="min-h-[50px] max-h-[150px] resize-none flex-1" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} disabled={isLoading} />
            <Button onClick={() => send()} disabled={(!input.trim() && attachedImages.length === 0) || isLoading} className="self-end">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <Brain className="h-3 w-3" /> Powered by your Knowledge Base (Read-Only Vault)
          </p>
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
        <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfUpload} />
      </div>
      )}
    </div>
  );
}
