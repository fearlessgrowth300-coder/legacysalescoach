import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { fetchInstagramProfile, pickInstagramTargetPost } from "@/lib/fetch-instagram";
import { needsFirstMessageRepair, parseSavedFirstMessages } from "@/lib/first-message";
import { needsAvatarRefresh } from "@/lib/prospect-avatar";
import { AiRequestTimeoutError, withAiRequestTimeout } from "@/lib/ai-request-timeout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";
import {
  MessageSquare, Plus, Send, User, Sparkles,
  Copy, Check, AlertTriangle,
  Heart, Briefcase, MoreVertical, Trash2, Camera, Loader2, Image, Upload, X,
  Ghost, PenLine, RotateCcw, ThumbsUp, ThumbsDown, Zap, BookOpen, TrendingUp, Video,
  ArrowLeft
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AiTypingIndicator from "@/components/AiTypingIndicator";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import TikTokOutreach from "@/components/TikTokOutreach";
import ConversationIntelligencePanel, { type ConversationAnalysis } from "@/components/ConversationIntelligencePanel";
import {
  latestProspectScreenshotMessage,
  latestScreenshotTurn,
  orderedScreenshotMessages,
  removeDuplicateConversationMessages,
  type ScreenshotMessage,
  type ScreenshotSpeaker,
} from "@/lib/screenshot-conversation";

import SuggestionCard, { ReferralWarningBanner, type Suggestion } from "@/components/SuggestionCard";
type FeedbackMap = Record<number, "positive" | "negative">;

type ScreenshotAnalysis = {
  name?: string | null;
  platform?: string | null;
  messages?: ScreenshotMessage[];
  latest_speaker?: ScreenshotSpeaker;
  latest_message?: string | null;
  visual_context?: string[];
  status_signals?: string[];
  conversation_summary?: string | null;
  uncertainty_notes?: string[];
};
type ProcessedScreenshot = {
  filePath: string;
  text: string;
  analysis: ScreenshotAnalysis | null;
};

const SCREENSHOT_TRANSCRIPT_MARKER = "--- SCREENSHOT TRANSCRIPT ---";

const invokeConversationAi = (
  functionName: "generate-reply" | "chat-suggest",
  options: { body: Record<string, unknown> },
) => withAiRequestTimeout(supabase.functions.invoke(functionName, options));

const friendStageDisplayLabel = (value?: string | null) => {
  const stage = String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (["handoff", "close", "closing", "decision"].includes(stage)) return "handoff";
  if (["pitch", "offer", "solution", "presenting", "referral"].includes(stage)) return "pitch";
  if (["emotionalcertainty", "needpayoff", "futurepacing"].includes(stage)) return "emotional certainty";
  if (["logicalcertainty", "pain", "paindiscovery", "problem", "implication"].includes(stage)) return "logical certainty";
  return "intent";
};

const parseTranscriptMessages = (text: string): ScreenshotMessage[] => {
  const messages: ScreenshotMessage[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^NAME:|^PLATFORM:|^---+$/.test(line)) continue;
    const match = line.match(/^(Them|Me|Unknown)\s*:\s*(.*)$/i);
    if (match) {
      const speaker = match[1].toLowerCase() === "me" ? "me" : match[1].toLowerCase() === "them" ? "them" : "unknown";
      if (match[2].trim()) messages.push({ speaker, text: match[2].trim(), order: messages.length + 1 });
    } else if (messages.length > 0) {
      messages[messages.length - 1].text += `\n${line}`;
    }
  }
  return messages;
};

const normalizeScreenshotMessage = (message: ScreenshotMessage) =>
  `${message.speaker}:${message.text}`.toLowerCase().replace(/\s+/g, " ").trim();

// Conversation screenshots commonly overlap. Remove only an exact tail/head
// overlap so repeated real messages elsewhere in the thread are preserved.
const mergeScreenshotMessages = (screenshots: ProcessedScreenshot[]) => {
  const merged: Array<ScreenshotMessage & { filePath: string }> = [];
  for (const screenshot of screenshots) {
    const current = (screenshot.analysis?.messages || [])
      .filter((message) => message?.text?.trim())
      .map((message, index) => ({ ...message, order: message.order ?? index + 1, filePath: screenshot.filePath }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    let overlap = 0;
    const maxOverlap = Math.min(merged.length, current.length);
    for (let size = maxOverlap; size > 0; size--) {
      const previousTail = merged.slice(-size).map(normalizeScreenshotMessage);
      const currentHead = current.slice(0, size).map(normalizeScreenshotMessage);
      if (previousTail.every((value, index) => value === currentHead[index])) {
        overlap = size;
        break;
      }
    }
    merged.push(...current.slice(overlap));
  }
  return merged;
};

const buildScreenshotContext = (screenshots: ProcessedScreenshot[], userNote = "") => {
  const visualAnalyses = screenshots.map((screenshot, index) => ({
    screenshot: index + 1,
    name: screenshot.analysis?.name || null,
    platform: screenshot.analysis?.platform || null,
    latest_speaker: screenshot.analysis?.latest_speaker || null,
    latest_message: screenshot.analysis?.latest_message || null,
    visual_context: screenshot.analysis?.visual_context || [],
    status_signals: screenshot.analysis?.status_signals || [],
    conversation_summary: screenshot.analysis?.conversation_summary || null,
    uncertainty_notes: screenshot.analysis?.uncertainty_notes || [],
  }));
  return [
    userNote.trim() ? `SALESPERSON NOTE:\n${userNote.trim()}` : "",
    `SCREENSHOT VISUAL ANALYSIS:\n${JSON.stringify(visualAnalyses)}`,
  ].filter(Boolean).join("\n\n");
};

function ChatScreenshotPreview({ filePath }: { filePath: string }) {
  const [signedUrl, setSignedUrl] = useState("");

  useEffect(() => {
    let active = true;
    supabase.storage.from("chat-screenshots").createSignedUrl(filePath, 3600).then(({ data, error }) => {
      if (active && !error && data?.signedUrl) setSignedUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [filePath]);

  if (!signedUrl) {
    return <div className="mb-2 h-20 w-28 rounded border bg-background/40 flex items-center justify-center"><Image className="h-5 w-5 opacity-50" /></div>;
  }
  return <img src={signedUrl} alt="Conversation screenshot" className="mb-2 max-h-48 max-w-full rounded border object-contain" />;
}

export default function Chats() {
  const { prospectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const selectedProspectId = prospectId || null;

  const [platformTab, setPlatformTab] = useState<"instagram" | "tiktok">("instagram");
  const [autoSwitchedForProspect, setAutoSwitchedForProspect] = useState<string | null>(null);
  const [newProspectOpen, setNewProspectOpen] = useState(false);
  const [chatType, setChatType] = useState<"new" | "existing" | "reengage" | null>(null);
  const [newProspectName, setNewProspectName] = useState("");
  const [newProspectIg, setNewProspectIg] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [pushyWarning, setPushyWarning] = useState<string | null>(null);
  const [currentThreadType, setCurrentThreadType] = useState<"friend" | "expert">("friend");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);

  // Screenshot upload flow for existing conversations
  const [screenshotFiles, setScreenshotFiles] = useState<File[]>([]);
  const [screenshotPreviews, setScreenshotPreviews] = useState<string[]>([]);
  const [uploadStep, setUploadStep] = useState<"info" | "upload" | "processing" | "done">("info");
  const [extractedConversation, setExtractedConversation] = useState("");
  const [firstMessageSuggestions, setFirstMessageSuggestions] = useState<Suggestion[]>([]);
  const [isGeneratingFirst, setIsGeneratingFirst] = useState(false);
  const [isRefineMode, setIsRefineMode] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [feedbackMap, setFeedbackMap] = useState<FeedbackMap>({});
  const [conversationStage, setConversationStage] = useState<string | null>(null);
  const [prospectType, setProspectType] = useState<string | null>(null);
  const [conversationAnalysis, setConversationAnalysis] = useState<ConversationAnalysis | null>(null);
  const [isAnalyzingIntel, setIsAnalyzingIntel] = useState(false);
  const [screenshotContextNote, setScreenshotContextNote] = useState("");
  const [pendingScreenshot, setPendingScreenshot] = useState<ProcessedScreenshot | null>(null);
  const [pendingScreenshotNote, setPendingScreenshotNote] = useState("");
  const [avatarRefreshVersion, setAvatarRefreshVersion] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const bulkScreenshotInputRef = useRef<HTMLInputElement>(null);
  const autoFirstMessageAttempted = useRef<Record<string, boolean>>({});
  const avatarRefreshAttempted = useRef<Record<string, boolean>>({});

  const getInitials = (name: string) => {
    return name.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      const viewport = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }, 100);
  };

  // Get active workspace
  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspaces").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
  const activeWorkspace = workspaces?.find((w) => w.is_active);

  // Get prospects
  const { data: prospects } = useQuery({
    queryKey: ["prospects", activeWorkspace?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospects")
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      // Filter to only show instagram prospects in the main chat sidebar
      return (data as any[]).filter((p: any) => p.platform !== "tiktok");
    },
    enabled: !!activeWorkspace?.id,
  });

  // Get messages for selected prospect
  const { data: messages, isFetched: messagesFetched } = useQuery({
    queryKey: ["messages", selectedProspectId, currentThreadType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("prospect_id", selectedProspectId!)
        .eq("thread_type", currentThreadType)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!selectedProspectId,
  });

  // Fetch selected prospect directly (handles TikTok prospects not in sidebar)
  const { data: selectedProspectData } = useQuery({
    queryKey: ["selected-prospect", selectedProspectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospects")
        .select("*")
        .eq("id", selectedProspectId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!selectedProspectId,
  });
  const selectedProspect = selectedProspectData || prospects?.find((p) => p.id === selectedProspectId);

  const refreshSelectedProspectAvatar = useCallback(async () => {
    if (!selectedProspectId || !selectedProspect || !activeWorkspace?.id || !user?.id) return;
    if (avatarRefreshAttempted.current[selectedProspectId]) return;

    const prospect = selectedProspect as any;
    const instagramSource = prospect.instagram_url || prospect.instagram_username;
    const tiktokSource = prospect.tiktok_url;
    if (!instagramSource && !tiktokSource) return;

    avatarRefreshAttempted.current[selectedProspectId] = true;

    try {
      let profilePicUrl = "";
      if (prospect.platform === "tiktok" && tiktokSource) {
        const { data, error } = await supabase.functions.invoke("fetch-tiktok", {
          body: {
            url: tiktokSource,
            workspaceId: activeWorkspace.id,
            prospectId: selectedProspectId,
            stashOutreach: false,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        profilePicUrl = data?.profilePicUrl || "";
      } else if (instagramSource) {
        const data = await fetchInstagramProfile(instagramSource);
        if (data?.error) throw new Error(data.error);
        profilePicUrl = data?.profilePicUrl || "";
      }

      if (!profilePicUrl) return;

      const { error: updateError } = await supabase
        .from("prospects")
        .update({ profile_pic_url: profilePicUrl } as any)
        .eq("id", selectedProspectId)
        .eq("user_id", user.id);
      if (updateError) throw updateError;

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["selected-prospect", selectedProspectId] }),
        queryClient.invalidateQueries({ queryKey: ["prospects"] }),
      ]);
      // Remount the image even when the provider returns the same URL after a
      // transient failure, allowing the browser to make one clean retry.
      setAvatarRefreshVersion((version) => version + 1);
    } catch (error) {
      console.error("Profile photo refresh failed:", error);
    }
  }, [activeWorkspace?.id, queryClient, selectedProspect, selectedProspectId, user?.id]);

  // Persist the prospect's chosen conversation mode across navigation instead
  // of silently resetting every chat to Friend mode.
  useEffect(() => {
    if (!selectedProspectId || !selectedProspect) return;
    setCurrentThreadType(selectedProspect.reply_mode === "expert" ? "expert" : "friend");
    setConversationStage(selectedProspect.conversation_stage || "first_contact");
  }, [selectedProspectId, selectedProspect]);

  // Clear transient suggestions immediately when changing chats or thread modes,
  // so one conversation can never display another conversation's replies.
  useEffect(() => {
    setSuggestions([]);
    setPushyWarning(null);
    setFeedbackMap({});
    setConversationAnalysis(null);
    setProspectType(null);
  }, [selectedProspectId, currentThreadType]);

  // Repair missing profile photos lazily when the conversation is opened. Broken
  // remote CDN URLs use the same refresh path from AvatarImage.onError below.
  useEffect(() => {
    if (selectedProspect && needsAvatarRefresh((selectedProspect as any).profile_pic_url)) {
      void refreshSelectedProspectAvatar();
    }
  }, [refreshSelectedProspectAvatar, selectedProspect]);

  // Auto-switch to instagram tab when viewing a TikTok prospect chat (so chat UI shows, not TikTok outreach)
  useEffect(() => {
    if (selectedProspectId && selectedProspect && (selectedProspect as any).platform === "tiktok" && platformTab === "tiktok") {
      // Only auto-switch once per prospect to avoid loops
      if (autoSwitchedForProspect !== selectedProspectId) {
        setPlatformTab("instagram");
        setAutoSwitchedForProspect(selectedProspectId);
      }
    }
  }, [selectedProspectId, selectedProspect, platformTab, autoSwitchedForProspect]);

  // Auto-load first message suggestions for prospects with saved suggestions
  useEffect(() => {
    // Wait for the messages request to finish. During loading, `messages` is
    // undefined and used to look like an empty conversation, restoring stale
    // first-message suggestions before the real history arrived.
    if (messagesFetched && selectedProspect && messages?.length === 0) {
      const savedFirst = (selectedProspect as any).suggested_first_message;
      if (savedFirst) {
        const postEvidence = String((selectedProspect as any).target_video_caption || "");
        const needsPostEnrichment = Boolean((selectedProspect as any).instagram_url && !postEvidence);
        if (needsPostEnrichment || needsFirstMessageRepair(savedFirst, postEvidence)) {
          // Old deployments saved ongoing certainty-funnel fallbacks as cold
          // openers. Do not restore them; the auto-generation effect below will
          // replace and persist a profile-grounded first message.
          void supabase.from("prospects")
            .update({ suggested_first_message: null } as any)
            .eq("id", selectedProspect.id);
        } else {
          const parsed = parseSavedFirstMessages(savedFirst);
          if (parsed.length > 0) {
            setSuggestions(parsed);
            return;
          }
        }
      }
    }
  }, [selectedProspectId, selectedProspect, messages, messagesFetched]);

  useEffect(() => {
    if (!selectedProspectId || !selectedProspect || !messages || messages.length > 0 || suggestions.length > 0 || isGeneratingFirst) return;
    if (autoFirstMessageAttempted.current[selectedProspectId]) return;

    const prospect = selectedProspect as any;
    const savedPostEvidence = String(prospect.target_video_caption || "");
    if (prospect.suggested_first_message &&
        !needsFirstMessageRepair(prospect.suggested_first_message, savedPostEvidence) &&
        (!prospect.instagram_url || savedPostEvidence)) return;
    if (!prospect.instagram_url && !prospect.tiktok_url && !prospect.detected_interests) return;

    autoFirstMessageAttempted.current[selectedProspectId] = true;
    setIsGeneratingFirst(true);

    void (async () => {
      const enrichedProspect = { ...prospect };
      if (prospect.instagram_url && !prospect.target_video_caption) {
        try {
          const igData = await fetchInstagramProfile(prospect.instagram_url);
          const targetPost = igData.targetPost || pickInstagramTargetPost(igData.recentPosts);
          if (targetPost) {
            enrichedProspect.target_video_caption = `Instagram post/reel\n${targetPost.caption}`;
            enrichedProspect.target_video_url = targetPost.url || null;
          }
          enrichedProspect.detected_interests = [igData.businessCategory, igData.biography?.substring(0, 200)]
            .filter(Boolean).join(" | ") || prospect.detected_interests;
          enrichedProspect.profile_pic_url = igData.profilePicUrl || prospect.profile_pic_url;
          enrichedProspect.instagram_username = igData.username || prospect.instagram_username;
          await supabase.from("prospects").update({
            detected_interests: enrichedProspect.detected_interests || null,
            profile_pic_url: enrichedProspect.profile_pic_url || null,
            instagram_username: enrichedProspect.instagram_username || null,
            target_video_url: enrichedProspect.target_video_url || null,
            target_video_caption: enrichedProspect.target_video_caption || null,
          } as any).eq("id", selectedProspectId);
        } catch (error) {
          console.warn("Could not refresh Instagram posts for first-message repair:", error);
        }
      }

      const profileMessage = [
        enrichedProspect.platform ? `Platform: ${enrichedProspect.platform}` : "",
        enrichedProspect.name ? `Name: ${enrichedProspect.name}` : "",
        enrichedProspect.detected_interests ? `Bio/interests: ${enrichedProspect.detected_interests}` : "",
        enrichedProspect.instagram_url ? `Instagram URL: ${enrichedProspect.instagram_url}` : "",
        enrichedProspect.tiktok_url ? `TikTok URL: ${enrichedProspect.tiktok_url}` : "",
        enrichedProspect.target_video_caption ? `Target video/post: ${enrichedProspect.target_video_caption}` : "",
        enrichedProspect.suggested_comment ? `Comment already used: ${enrichedProspect.suggested_comment}` : "",
      ].filter(Boolean).join("\n");

      const { data, error } = await invokeConversationAi("chat-suggest", {
        body: {
          prospectId: selectedProspectId,
          message: profileMessage,
          threadType: currentThreadType,
          mode: "first_message",
        },
      });
      if (error) throw error;
      if (data?.suggestions?.length) {
        setSuggestions(data.suggestions);
        setPushyWarning(data.pushyWarning || null);
        queryClient.invalidateQueries({ queryKey: ["selected-prospect", selectedProspectId] });
        queryClient.invalidateQueries({ queryKey: ["prospects"] });
      }
    })().catch((error) => {
      console.error("Auto first-message recovery failed:", error);
    }).finally(() => {
      setIsGeneratingFirst(false);
    });
  }, [selectedProspectId, selectedProspect, messages, suggestions.length, isGeneratingFirst, currentThreadType, queryClient]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Reset dialog state when closing
  const handleDialogChange = (open: boolean) => {
    setNewProspectOpen(open);
    if (!open) {
      setChatType(null);
      setNewProspectName("");
      setNewProspectIg("");
      setScreenshotFiles([]);
      setScreenshotPreviews([]);
      setUploadStep("info");
      setExtractedConversation("");
      setFirstMessageSuggestions([]);
      setScreenshotContextNote("");
    }
  };

  // Handle bulk screenshot file selection
  const handleBulkScreenshotSelect = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    const newPreviews = newFiles.map((f) => URL.createObjectURL(f));
    setScreenshotFiles((prev) => [...prev, ...newFiles]);
    setScreenshotPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeScreenshot = (index: number) => {
    URL.revokeObjectURL(screenshotPreviews[index]);
    setScreenshotFiles((prev) => prev.filter((_, i) => i !== index));
    setScreenshotPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadAndAnalyzeScreenshot = async (file: File, index: number, userContext = ""): Promise<ProcessedScreenshot | null> => {
    if (!user) return null;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const filePath = `${user.id}/${Date.now()}-${index}-${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("chat-screenshots").upload(filePath, file);
    if (uploadError) {
      console.error("Screenshot upload error:", uploadError);
      return null;
    }

    const { data, error } = await supabase.functions.invoke("ocr-screenshot", {
      body: { filePath, userContext },
    });
    if (error || !data?.text) {
      console.error("Screenshot analysis error:", error || "No text returned");
      return null;
    }
    return {
      filePath,
      text: data.text,
      analysis: (data.analysis || null) as ScreenshotAnalysis | null,
    };
  };

  const saveScreenshotConversation = async (prospectId: string, screenshots: ProcessedScreenshot[], userNote = "") => {
    if (!user) return;
    const extractedMessages = mergeScreenshotMessages(screenshots);
    const rows: any[] = [];
    const baseTime = Date.now() - (extractedMessages.length + (userNote.trim() ? 1 : 0)) * 1000;

    if (userNote.trim()) {
      rows.push({
        user_id: user.id,
        prospect_id: prospectId,
        content: userNote.trim(),
        direction: "context",
        thread_type: currentThreadType,
        screenshot_url: screenshots[0]?.filePath || null,
        created_at: new Date(baseTime).toISOString(),
      });
    }

    if (extractedMessages.length > 0) {
      extractedMessages.forEach((message, index) => {
        rows.push({
          user_id: user.id,
          prospect_id: prospectId,
          content: message.text.trim(),
          direction: message.speaker === "me" ? "outbound" : message.speaker === "them" ? "inbound" : "unknown",
          thread_type: currentThreadType,
          screenshot_url: message.filePath,
          created_at: new Date(baseTime + (index + (userNote.trim() ? 1 : 0)) * 1000).toISOString(),
        });
      });
    } else {
      screenshots.forEach((screenshot, index) => {
        rows.push({
          user_id: user.id,
          prospect_id: prospectId,
          content: screenshot.text,
          // A non-JSON OCR fallback can contain both sides of the conversation.
          // Never store that mixed transcript as if the prospect said it all.
          direction: "unknown",
          thread_type: currentThreadType,
          screenshot_url: screenshot.filePath,
          created_at: new Date(Date.now() + index * 1000).toISOString(),
        });
      });
    }

    if (rows.length > 0) {
      const { data: existingRows } = await supabase
        .from("chat_messages")
        .select("direction, content")
        .eq("user_id", user.id)
        .eq("prospect_id", prospectId)
        .eq("thread_type", currentThreadType);
      const existingKeys = new Set((existingRows || []).map((row: any) =>
        `${row.direction}:${String(row.content || "").replace(/\s+/g, " ").trim().toLowerCase()}`,
      ));
      const uniqueRows = removeDuplicateConversationMessages(rows)
        .filter((row) => !existingKeys.has(`${row.direction}:${String(row.content || "").replace(/\s+/g, " ").trim().toLowerCase()}`));
      if (uniqueRows.length === 0) return;
      const { error } = await supabase.from("chat_messages").insert(uniqueRows);
      if (error) throw error;
    }
  };

  // Process all screenshots via OCR and create prospect
  const processExistingConversation = async () => {
    if (!user || !activeWorkspace || screenshotFiles.length === 0) return;
    setUploadStep("processing");

    try {
      // 1. Create the prospect first
      const { data: prospect, error: prospectError } = await supabase
        .from("prospects")
        .insert({
          user_id: user.id,
          workspace_id: activeWorkspace.id,
          name: newProspectName,
          instagram_url: newProspectIg || null,
          reply_mode: activeWorkspace.default_reply_mode,
          conversation_stage: "continuing",
        })
        .select()
        .single();
      if (prospectError) throw prospectError;

      // 2. If Instagram URL, fetch profile
      if (newProspectIg) {
        try {
          const igData = await fetchInstagramProfile(newProspectIg);
          if (igData && !igData.error) {
            const targetPost = igData.targetPost || pickInstagramTargetPost(igData.recentPosts);
            const interests = [igData.businessCategory, igData.biography?.substring(0, 200)].filter(Boolean).join(" | ");
            await supabase.from("prospects").update({
              detected_interests: interests || null,
              profile_pic_url: igData.profilePicUrl || null,
              instagram_username: igData.username || null,
              name: igData.fullName || newProspectName,
              ...(targetPost ? {
                target_video_url: targetPost.url || null,
                target_video_caption: `Instagram post/reel\n${targetPost.caption || "No caption found"}`,
              } : {}),
            } as any).eq("id", prospect.id);
            
          }
        } catch (e) { console.error("IG fetch error:", e); }
      }

      // 3. Upload and visually analyze all screenshots sequentially so their
      // chronological order is preserved and overlapping screens can be merged.
      const processedScreenshots: ProcessedScreenshot[] = [];
      for (let i = 0; i < screenshotFiles.length; i++) {
        const processed = await uploadAndAnalyzeScreenshot(screenshotFiles[i], i, screenshotContextNote);
        if (processed) processedScreenshots.push(processed);
      }
      if (processedScreenshots.length === 0) throw new Error("None of the screenshots could be analyzed");

      const fullConversation = processedScreenshots
        .map((screenshot, index) => `[Screenshot ${index + 1}]:\n${screenshot.text}`)
        .join("\n\n");
      const screenshotContext = buildScreenshotContext(processedScreenshots, screenshotContextNote);
      setExtractedConversation(fullConversation);

      // 4. Save each detected bubble with the correct speaker/direction.
      await saveScreenshotConversation(prospect.id, processedScreenshots, screenshotContextNote);

      // 5. Ask AI for next reply suggestion based on full conversation
      const { data: suggestData, error: suggestError } = await invokeConversationAi("chat-suggest", {
        body: {
          prospectId: prospect.id,
          message: fullConversation,
          threadType: currentThreadType,
          mode: "continue",
          screenshotContext,
        },
      });

      if (!suggestError && suggestData?.suggestions) {
        setFirstMessageSuggestions(suggestData.suggestions);
        if (suggestData.conversationStage) setConversationStage(suggestData.conversationStage);
      }

      setUploadStep("done");
      queryClient.invalidateQueries({ queryKey: ["prospects"] });

      // Navigate to the new chat
      setTimeout(() => {
        handleDialogChange(false);
        navigate(`/chats/${prospect.id}`);
        if (suggestData?.suggestions) {
          setSuggestions(suggestData.suggestions);
          setPushyWarning(suggestData.pushyWarning || null);
        }
      }, 1500);
    } catch (e: any) {
      console.error("Process error:", e);
      toast.error(e.message || "Failed to process screenshots");
      setUploadStep("upload");
    }
  };

  // Process re-engage conversation (ghosted prospect)
  const processReengageConversation = async () => {
    if (!user || !activeWorkspace || screenshotFiles.length === 0) return;
    setUploadStep("processing");

    try {
      const { data: prospect, error: prospectError } = await supabase
        .from("prospects")
        .insert({
          user_id: user.id,
          workspace_id: activeWorkspace.id,
          name: newProspectName,
          instagram_url: newProspectIg || null,
          reply_mode: activeWorkspace.default_reply_mode,
          conversation_stage: "ghosted",
        })
        .select()
        .single();
      if (prospectError) throw prospectError;

      if (newProspectIg) {
        try {
          const igData = await fetchInstagramProfile(newProspectIg);
          if (igData && !igData.error) {
            const targetPost = igData.targetPost || pickInstagramTargetPost(igData.recentPosts);
            const interests = [igData.businessCategory, igData.biography?.substring(0, 200)].filter(Boolean).join(" | ");
            await supabase.from("prospects").update({
              detected_interests: interests || null,
              profile_pic_url: igData.profilePicUrl || null,
              instagram_username: igData.username || null,
              name: igData.fullName || newProspectName,
              ...(targetPost ? {
                target_video_url: targetPost.url || null,
                target_video_caption: `Instagram post/reel\n${targetPost.caption || "No caption found"}`,
              } : {}),
            } as any).eq("id", prospect.id);
          }
        } catch (e) { console.error("IG fetch error:", e); }
      }

      const processedScreenshots: ProcessedScreenshot[] = [];
      for (let i = 0; i < screenshotFiles.length; i++) {
        const processed = await uploadAndAnalyzeScreenshot(screenshotFiles[i], i, screenshotContextNote);
        if (processed) processedScreenshots.push(processed);
      }
      if (processedScreenshots.length === 0) throw new Error("None of the screenshots could be analyzed");

      const fullConversation = processedScreenshots
        .map((screenshot, index) => `[Screenshot ${index + 1}]:\n${screenshot.text}`)
        .join("\n\n");
      const screenshotContext = buildScreenshotContext(processedScreenshots, screenshotContextNote);

      await saveScreenshotConversation(prospect.id, processedScreenshots, screenshotContextNote);

      const { data: suggestData, error: suggestError } = await invokeConversationAi("chat-suggest", {
        body: {
          prospectId: prospect.id,
          message: fullConversation || "The prospect has ghosted me. They saw my last message but didn't reply.",
          threadType: currentThreadType,
          mode: "reengage",
          screenshotContext,
        },
      });

      if (!suggestError && suggestData?.suggestions) {
        setFirstMessageSuggestions(suggestData.suggestions);
        if (suggestData.conversationStage) setConversationStage(suggestData.conversationStage);
      }

      setUploadStep("done");
      queryClient.invalidateQueries({ queryKey: ["prospects"] });

      setTimeout(() => {
        handleDialogChange(false);
        navigate(`/chats/${prospect.id}`);
        if (suggestData?.suggestions) {
          setSuggestions(suggestData.suggestions);
          setPushyWarning(suggestData.pushyWarning || null);
        }
      }, 1500);
    } catch (e: any) {
      console.error("Re-engage process error:", e);
      toast.error(e.message || "Failed to process screenshots");
      setUploadStep("upload");
    }
  };

  // Refine user's draft message
  const handleRefineDraft = async () => {
    if (!messageInput.trim() || !selectedProspectId) return;
    setIsRefining(true);

    try {
      const { data, error } = await invokeConversationAi("chat-suggest", {
        body: {
          prospectId: selectedProspectId,
          message: `MY DRAFT MESSAGE TO REFINE:\n${messageInput}`,
          threadType: currentThreadType,
          mode: "refine",
        },
      });
      if (error) throw error;
      setSuggestions(data.suggestions || []);
      setPushyWarning(data.pushyWarning || null);
    } catch (e: any) {
      console.error("Refine error:", e);
      toast.error("Failed to refine your draft");
    }

    setIsRefining(false);
  };

  // Create new prospect (cold outreach) with first message generation
  const createProspect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("prospects")
        .insert({
          user_id: user!.id,
          workspace_id: activeWorkspace!.id,
          name: newProspectName,
          instagram_url: newProspectIg || null,
          reply_mode: activeWorkspace!.default_reply_mode,
        })
        .select()
        .single();
      if (error) throw error;

      let generatedSuggestions: Suggestion[] = [];

      // If Instagram URL provided, auto-fetch profile details via Apify
      if (newProspectIg) {
        setIsGeneratingFirst(true);
        let profileSummary = `Instagram profile/post URL: ${newProspectIg}. Prospect name entered: ${newProspectName}.`;
        try {
          const igData = await fetchInstagramProfile(newProspectIg);
          if (igData && !igData.error) {
            const targetPost = igData.targetPost || pickInstagramTargetPost(igData.recentPosts);
            const interests = [igData.businessCategory, igData.biography?.substring(0, 200)].filter(Boolean).join(" | ");
            await supabase.from("prospects").update({
              detected_interests: interests || null,
              profile_pic_url: igData.profilePicUrl || null,
              instagram_username: igData.username || null,
              name: igData.fullName || newProspectName,
              ...(targetPost ? {
                target_video_url: targetPost.url || null,
                target_video_caption: `Instagram post/reel\n${targetPost.caption || "No caption found"}`,
              } : {}),
            } as any).eq("id", data.id);

            profileSummary = igData.summary || `Instagram profile: @${igData.username}. Bio: ${igData.biography || "N/A"}. Followers: ${igData.followersCount || "N/A"}. Category: ${igData.businessCategory || "N/A"}. Posts: ${igData.postsCount || 0}. ${igData.recentPosts?.map((p: any, i: number) => `Post ${i+1}: "${p.caption}" (${p.likes} likes)`).join(". ") || ""}`;
          }
        } catch (e) {
          console.error("Instagram auto-fetch error:", e);
          toast.warning("Instagram scrape failed — generating from the link instead");
        }

        try {
          let suggestResponse = await invokeConversationAi("chat-suggest", {
            body: {
              prospectId: data.id,
              message: profileSummary,
              threadType: currentThreadType,
              mode: "first_message",
            },
          });
          if (suggestResponse.error && /401|Unauthorized/i.test(String(suggestResponse.error?.message || ""))) {
            await supabase.auth.refreshSession();
            suggestResponse = await invokeConversationAi("chat-suggest", {
              body: {
                prospectId: data.id,
                message: profileSummary,
                threadType: currentThreadType,
                mode: "first_message",
              },
            });
          }
          if (suggestResponse.error) throw suggestResponse.error;
          const suggestData = suggestResponse.data;
          if (suggestData?.suggestions) {
            generatedSuggestions = suggestData.suggestions;
            setFirstMessageSuggestions(suggestData.suggestions);
            // Persist to prospect so auto-load effect can recover after navigation
            await supabase.from("prospects").update({
              suggested_first_message: JSON.stringify(suggestData.suggestions),
            }).eq("id", data.id);
          }
        } catch (e) {
          console.error("First-message generation error:", e);
          toast.error("Could not generate first-message suggestions");
        } finally {
          setIsGeneratingFirst(false);
        }
      }

      return { prospect: data, suggestions: generatedSuggestions };
    },
    onSuccess: ({ prospect, suggestions: newSuggestions }) => {
      toast.success("New chat created!");
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
      handleDialogChange(false);
      navigate(`/chats/${prospect.id}`);
      if (newSuggestions.length > 0) {
        setSuggestions(newSuggestions);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleScreenshotUpload = async (file: File) => {
    if (!selectedProspectId || !user) return;
    setIsOcrProcessing(true);

    try {
      const existingNote = messageInput.trim();
      const processed = await uploadAndAnalyzeScreenshot(file, 0, existingNote);
      if (!processed) throw new Error("Could not analyze screenshot");

      setPendingScreenshot(processed);
      setPendingScreenshotNote(existingNote);
      setMessageInput([
        existingNote,
        SCREENSHOT_TRANSCRIPT_MARKER,
        processed.text,
      ].filter(Boolean).join("\n\n"));
      toast.success("Screenshot read with speaker order and visual context");
    } catch (e: any) {
      console.error("OCR error:", e);
      toast.error("Failed to process screenshot");
    } finally {
      setIsOcrProcessing(false);
    }
  };

  // Detect TikTok URLs in text
  const detectTikTokUrl = (text: string): string | null => {
    const match = text.match(/https?:\/\/(?:www\.)?(?:tiktok\.com\/@?[^\s]+|vm\.tiktok\.com\/[^\s]+)/i);
    return match ? match[0] : null;
  };

  const detectInstagramUrl = (text: string): string | null => {
    const match = text.match(/https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s]+/i);
    return match ? match[0] : null;
  };

  const handleSendInbound = async () => {
    if (!messageInput.trim() || !selectedProspectId) return;
    setIsAnalyzing(true);
    setIsAnalyzingIntel(true);

    let screenshotForRequest = pendingScreenshot;
    let screenshotContext = "";
    let requestMessage = messageInput.trim();

    if (pendingScreenshot) {
      const markerIndex = messageInput.indexOf(SCREENSHOT_TRANSCRIPT_MARKER);
      const userNote = markerIndex >= 0
        ? messageInput.slice(0, markerIndex).trim()
        : pendingScreenshotNote;
      const editedTranscript = markerIndex >= 0
        ? messageInput.slice(markerIndex + SCREENSHOT_TRANSCRIPT_MARKER.length).trim()
        : messageInput.trim();
      const editedMessages = parseTranscriptMessages(editedTranscript);
      const resolvedMessages = editedMessages.length > 0
        ? orderedScreenshotMessages(editedMessages)
        : orderedScreenshotMessages(pendingScreenshot.analysis?.messages);
      const latestTurn = latestScreenshotTurn(resolvedMessages);

      screenshotForRequest = {
        ...pendingScreenshot,
        text: editedTranscript || pendingScreenshot.text,
        analysis: {
          ...(pendingScreenshot.analysis || {}),
          ...(resolvedMessages.length > 0 ? { messages: resolvedMessages } : {}),
          latest_speaker: latestTurn?.speaker || pendingScreenshot.analysis?.latest_speaker || "unknown",
          latest_message: latestTurn?.text || pendingScreenshot.analysis?.latest_message || null,
        },
      };
      screenshotContext = buildScreenshotContext([screenshotForRequest], userNote);
      requestMessage = latestProspectScreenshotMessage(resolvedMessages)
        || latestTurn?.text?.trim()
        || editedTranscript
        || pendingScreenshot.text;
      await saveScreenshotConversation(selectedProspectId, [screenshotForRequest], userNote);
    }

    const tiktokUrl = detectTikTokUrl(requestMessage);
    const instagramUrl = detectInstagramUrl(requestMessage);
    let enrichedMessage = requestMessage;

    // Auto-scrape TikTok profile if URL detected
    if (tiktokUrl && activeWorkspace) {
      toast.info("🔍 TikTok link detected — scraping profile...", { duration: 3000 });
      try {
        const { data: tiktokData, error: tiktokError } = await supabase.functions.invoke("fetch-tiktok", {
          body: {
            url: tiktokUrl,
            workspaceId: activeWorkspace.id,
            prospectId: selectedProspectId,
          },
        });
        if (!tiktokError && tiktokData && !tiktokData.error) {
          enrichedMessage = `${requestMessage}\n\n--- TIKTOK PROFILE AUTO-SCRAPED ---\n${tiktokData.summary || ""}`;
          if (tiktokData.suggestedComment) {
            enrichedMessage += `\nSuggested Comment: ${tiktokData.suggestedComment}`;
          }
          toast.success(`✅ Scraped @${tiktokData.username} — ${tiktokData.followersCount} followers`, { duration: 4000 });

          await supabase.from("prospects").update({
            tiktok_url: `https://tiktok.com/@${tiktokData.username}`,
            profile_pic_url: tiktokData.profilePicUrl || undefined,
            detected_interests: tiktokData.bio?.substring(0, 300) || undefined,
          }).eq("id", selectedProspectId);
          queryClient.invalidateQueries({ queryKey: ["selected-prospect"] });
        }
      } catch (e) {
        console.error("TikTok auto-scrape error:", e);
        toast.error("TikTok scrape failed — generating reply without it");
      }
    }

    // Auto-scrape Instagram profile/post if URL detected
    if (instagramUrl && activeWorkspace) {
      toast.info("🔍 Instagram link detected — analyzing profile/post...", { duration: 3000 });
      try {
        const igData = await fetchInstagramProfile(instagramUrl);
        if (igData && !igData.error) {
          const targetPost = igData.targetPost || pickInstagramTargetPost(igData.recentPosts);
          enrichedMessage = `${enrichedMessage}\n\n--- INSTAGRAM AUTO-SCRAPED ---\n${igData.summary || ""}`;
          toast.success(`✅ Analyzed @${igData.username || "Instagram"}`, { duration: 4000 });

          await supabase.from("prospects").update({
            instagram_url: instagramUrl,
            instagram_username: igData.username || undefined,
            profile_pic_url: igData.profilePicUrl || undefined,
            detected_interests: [igData.businessCategory, igData.biography?.substring(0, 300)].filter(Boolean).join(" | ") || undefined,
            ...(targetPost ? {
              target_video_url: targetPost.url || null,
              target_video_caption: `Instagram post/reel\n${targetPost.caption || "No caption found"}`,
            } : {}),
          } as any).eq("id", selectedProspectId);
          queryClient.invalidateQueries({ queryKey: ["selected-prospect"] });
        }
      } catch (e) {
        console.error("Instagram auto-scrape error:", e);
        toast.error("Instagram scrape failed — generating reply from the link text");
      }
    }

    if (!pendingScreenshot) {
      const latestInbound = messages?.filter((item) => item.direction === "inbound").pop();
      const isSameInbound = latestInbound?.content?.replace(/\s+/g, " ").trim().toLowerCase()
        === requestMessage.replace(/\s+/g, " ").trim().toLowerCase();
      if (!isSameInbound) await supabase.from("chat_messages").insert({
        user_id: user!.id,
        prospect_id: selectedProspectId,
        content: requestMessage,
        direction: "inbound",
        thread_type: currentThreadType,
      });
    }

    try {
      const invokeGenerate = async () => {
        const res = await invokeConversationAi("generate-reply", {
          body: {
            prospectId: selectedProspectId,
            message: enrichedMessage,
            threadType: currentThreadType,
            screenshotPath: screenshotForRequest?.filePath || null,
            screenshotContext,
          },
        });
        if (res.error && /401|Unauthorized/i.test(String(res.error?.message || ""))) {
          await supabase.auth.refreshSession();
          return await invokeConversationAi("generate-reply", {
            body: {
              prospectId: selectedProspectId,
              message: enrichedMessage,
              threadType: currentThreadType,
              screenshotPath: screenshotForRequest?.filePath || null,
              screenshotContext,
            },
          });
        }
        return res;
      };
      const { data, error } = await invokeGenerate();
      if (error) throw error;

      setSuggestions(data.suggestions || []);
      setPushyWarning(null);
      setFeedbackMap({});
      if (data.conversationStage) setConversationStage(data.conversationStage);
      if (data.prospectType) setProspectType(data.prospectType);
      if (data.analysis) setConversationAnalysis(data.analysis);
      if (data.brainRetrieval && data.brainRetrieval.chunksRetrieved > 0) {
        const br = data.brainRetrieval;
        const sourceList = (br.sources || []).filter((s: string) => s !== "unknown").join(", ") || "brain";
        toast.info(`🔍 Pulled from brain: ${br.chunksRetrieved} chunks | Sources: ${sourceList}`, { duration: 4000 });
      }
      if (data.learningResult) {
        const lr = data.learningResult;
        toast.success(`🧠 Learned ${lr.chunksAdded || 1} new pattern${(lr.chunksAdded || 1) > 1 ? 's' : ''} from "${(data.prospectType || "prospect").replace(/_/g, " ")}"`, { duration: 5000 });
      }
    } catch (e: any) {
      console.error("AI suggestion error:", e);
      toast.error(e instanceof AiRequestTimeoutError ? e.message : "Failed to get suggestions");
    }

    setMessageInput("");
    setPendingScreenshot(null);
    setPendingScreenshotNote("");
    queryClient.invalidateQueries({ queryKey: ["messages"] });
    queryClient.invalidateQueries({ queryKey: ["prospects"] });
    setIsAnalyzing(false);
    setIsAnalyzingIntel(false);
  };

  const handleUseSuggestion = async (suggestion: Suggestion) => {
    if (!selectedProspectId) return;
    const latestOutbound = messages?.filter((item) => item.direction === "outbound").pop();
    const alreadyRecorded = latestOutbound?.content?.replace(/\s+/g, " ").trim().toLowerCase()
      === suggestion.text.replace(/\s+/g, " ").trim().toLowerCase();
    if (alreadyRecorded) {
      setSuggestions([]);
      toast.info("This response is already recorded.");
      return;
    }
    const { error: messageError } = await supabase.from("chat_messages").insert({
      user_id: user!.id,
      prospect_id: selectedProspectId,
      content: suggestion.text,
      direction: "outbound",
      thread_type: currentThreadType,
      is_ai_suggestion: true,
    });
    if (messageError) {
      console.error("Failed to record used suggestion:", messageError);
      toast.error("Could not record this response. Please try again.");
      return;
    }

    // First-message suggestions are stored on the prospect for navigation
    // recovery. Consume that persisted value after a reply is used so it cannot
    // reappear the next time the chat is opened.
    const { error: clearSuggestionError } = await supabase
      .from("prospects")
      .update({ suggested_first_message: null } as any)
      .eq("id", selectedProspectId)
      .eq("user_id", user!.id);
    const { data: analytics } = await supabase
      .from("conversation_analytics")
      .select("id, ai_suggestions_used")
      .eq("user_id", user!.id)
      .eq("prospect_id", selectedProspectId)
      .maybeSingle();
    if (analytics) {
      await supabase.from("conversation_analytics").update({
        ai_suggestions_used: (analytics.ai_suggestions_used || 0) + 1,
      }).eq("id", analytics.id);
    }
    setSuggestions([]);
    setPushyWarning(null);
    setFeedbackMap({});
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["messages", selectedProspectId, currentThreadType] }),
      queryClient.invalidateQueries({ queryKey: ["selected-prospect", selectedProspectId] }),
      queryClient.invalidateQueries({ queryKey: ["prospects"] }),
    ]);
    if (clearSuggestionError) {
      console.error("Response was recorded but saved suggestions were not cleared:", clearSuggestionError);
      toast.warning("Response recorded, but the saved suggestion could not be cleared.");
    } else {
      toast.success("Response recorded!");
    }
  };

  const handleFeedback = async (suggestion: Suggestion, feedback: "positive" | "negative") => {
    if (!selectedProspectId || !activeWorkspace) return;
    setFeedbackMap((prev) => ({ ...prev, [suggestion.id]: feedback }));
    try {
      await supabase.from("suggestion_feedback").insert({
        user_id: user!.id,
        prospect_id: selectedProspectId,
        workspace_id: activeWorkspace.id,
        suggestion_text: suggestion.text,
        suggestion_type: suggestion.type,
        feedback,
        thread_type: currentThreadType,
        conversation_stage: conversationStage || selectedProspect?.conversation_stage,
        framework_used: suggestion.frameworkUsed || null,
      });
      if (feedback === "positive") {
        const lastInbound = messages?.filter((m) => m.direction === "inbound").pop();
        await supabase.from("knowledge_chunks").insert({
          user_id: user!.id,
          workspace_id: activeWorkspace.id,
          source_type: "conversation",
          category: conversationStage === "pitch" || conversationStage === "handoff" ? "closing_techniques" : "approved_reply",
          content: `PROSPECT: "${(lastInbound?.content || "").substring(0, 500)}"\nAPPROVED REPLY: "${suggestion.text.substring(0, 500)}"\nFramework: ${suggestion.frameworkUsed || "natural conversation"}`,
          brain_type: currentThreadType,
          trigger_phrases: `${conversationStage || selectedProspect?.conversation_stage || "general"}, approved, ${currentThreadType}`,
          relevance_score: 95,
          chunk_kind: "conversation_memory",
          metadata: { source: "approved_suggestion_feedback" },
        });
      }
      toast.success(feedback === "positive" ? "👍 Got it! Will generate more like this" : "👎 Noted! Will adjust future suggestions");
    } catch (e) {
      console.error("Feedback error:", e);
    }
  };

  const handleEmotionalReply = async (style: string) => {
    if (!selectedProspectId) return;
    setIsAnalyzing(true);
    setIsAnalyzingIntel(true);
    try {
      const lastInbound = messages?.filter(m => m.direction === "inbound").pop();
      const body = { prospectId: selectedProspectId, message: lastInbound?.content || "", threadType: currentThreadType, styleModifier: style };
      let { data, error } = await invokeConversationAi("generate-reply", { body });
      if (error && /401|Unauthorized/i.test(String(error?.message || ""))) {
        await supabase.auth.refreshSession();
        ({ data, error } = await invokeConversationAi("generate-reply", { body }));
      }
      if (error) throw error;

      setSuggestions(data.suggestions || []);
      setPushyWarning(null);
      setFeedbackMap({});
      if (data.conversationStage) setConversationStage(data.conversationStage);
      if (data.prospectType) setProspectType(data.prospectType);
      if (data.analysis) setConversationAnalysis(data.analysis);
      if (data.brainRetrieval && data.brainRetrieval.chunksRetrieved > 0) {
        const br = data.brainRetrieval;
        const sourceList = (br.sources || []).filter((s: string) => s !== "unknown").join(", ") || "brain";
        toast.info(`🔍 Pulled from brain: ${br.chunksRetrieved} chunks | Sources: ${sourceList}`, { duration: 4000 });
      }
    } catch (e: any) {
      toast.error(e instanceof AiRequestTimeoutError ? e.message : "Failed to generate reply");
    }
    setIsAnalyzing(false);
    setIsAnalyzingIntel(false);
  };

  const handleCopy = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Copied!");
  };

  const updateOutcome = useMutation({
    mutationFn: async ({ id, outcome }: { id: string; outcome: string }) => {
      const { error } = await supabase.from("prospects").update({ outcome }).eq("id", id);
      if (error) throw error;
      // Conversion learning loop: on a WIN, boost the principles that closed it so
      // the brain gets smarter at what actually converts for this user.
      if (outcome === "won") {
        try {
          const { data } = await supabase.functions.invoke("record-conversion", { body: { prospectId: id } });
          return data;
        } catch (e) {
          console.warn("record-conversion failed", e);
        }
      }
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
      if (data?.boosted > 0) {
        toast.success(`🧠 Learned from this win — boosted ${data.boosted} principles that closed it.`);
      }
    },
  });

  const deleteProspect = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("prospects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chat deleted");
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
      navigate("/chats");
    },
  });

  if (!activeWorkspace) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <Card className="max-w-md">
          <CardHeader><CardTitle>Create a Workspace First</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">You need a workspace before you can start chatting with prospects.</p>
            <Button onClick={() => navigate("/workspaces")}>Go to Workspaces</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (platformTab === "tiktok") {
    if (isMobile) {
      return (
        <div className="flex flex-col h-[calc(100dvh-4rem)]">
          <div className="p-4 border-b">
            <Tabs value={platformTab} onValueChange={(v) => setPlatformTab(v as any)}>
              <TabsList className="w-full">
                <TabsTrigger value="instagram" className="flex-1 text-xs gap-1"><MessageSquare className="h-3 w-3" />Instagram</TabsTrigger>
                <TabsTrigger value="tiktok" className="flex-1 text-xs gap-1"><Video className="h-3 w-3" />TikTok</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex-1 overflow-hidden">
            <TikTokOutreach workspaceId={activeWorkspace!.id} />
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-[calc(100dvh-4rem)]">
        <div className="w-80 border-r flex flex-col bg-muted/30">
          <div className="p-4 border-b">
            <Tabs value={platformTab} onValueChange={(v) => setPlatformTab(v as any)}>
              <TabsList className="w-full">
                <TabsTrigger value="instagram" className="flex-1 text-xs gap-1"><MessageSquare className="h-3 w-3" />Instagram</TabsTrigger>
                <TabsTrigger value="tiktok" className="flex-1 text-xs gap-1"><Video className="h-3 w-3" />TikTok</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        <div className="flex-1">
          <TikTokOutreach workspaceId={activeWorkspace!.id} />
        </div>
      </div>
    );
  }

  // On mobile: show sidebar list when no prospect selected, show chat when prospect selected
  const showSidebar = !isMobile || !selectedProspectId;
  const showChat = !isMobile || !!selectedProspectId;

  return (
    <div className="flex h-full min-h-0 overflow-x-hidden" style={{ touchAction: "pan-y" }}>
      {/* Sidebar - Prospect List */}
      {showSidebar && (
      <div className={`${isMobile ? "w-full" : "w-80"} border-r flex flex-col bg-muted/30`}>
        <div className="p-4 border-b space-y-3">
          <Tabs value={platformTab} onValueChange={(v) => setPlatformTab(v as any)}>
            <TabsList className="w-full">
              <TabsTrigger value="instagram" className="flex-1 text-xs gap-1"><MessageSquare className="h-3 w-3" />Instagram</TabsTrigger>
              <TabsTrigger value="tiktok" className="flex-1 text-xs gap-1"><Video className="h-3 w-3" />TikTok</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Chats</h2>
            <Dialog open={newProspectOpen} onOpenChange={handleDialogChange}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />New</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>New Chat</DialogTitle></DialogHeader>

                {/* Step 1: Choose chat type */}
                {!chatType && (
                  <div className="space-y-3 py-4">
                    <p className="text-sm text-muted-foreground">What type of conversation is this?</p>
                    <div className="grid grid-cols-3 gap-3">
                      <Card
                        className="p-4 cursor-pointer hover:border-primary transition-colors"
                        onClick={() => setChatType("new")}
                      >
                        <div className="text-center space-y-2">
                          <MessageSquare className="h-8 w-8 mx-auto text-primary" />
                          <h4 className="font-medium text-sm">New Prospect</h4>
                          <p className="text-xs text-muted-foreground">Cold outreach — start fresh</p>
                        </div>
                      </Card>
                      <Card
                        className="p-4 cursor-pointer hover:border-primary transition-colors"
                        onClick={() => setChatType("existing")}
                      >
                        <div className="text-center space-y-2">
                          <Upload className="h-8 w-8 mx-auto text-primary" />
                          <h4 className="font-medium text-sm">Existing Chat</h4>
                          <p className="text-xs text-muted-foreground">Upload DMs to continue</p>
                        </div>
                      </Card>
                      <Card
                        className="p-4 cursor-pointer hover:border-primary transition-colors"
                        onClick={() => setChatType("reengage")}
                      >
                        <div className="text-center space-y-2">
                          <Ghost className="h-8 w-8 mx-auto text-primary" />
                          <h4 className="font-medium text-sm">Re-engage</h4>
                          <p className="text-xs text-muted-foreground">They saw but didn't reply</p>
                        </div>
                      </Card>
                    </div>
                  </div>
                )}

                {/* New Prospect Flow */}
                {chatType === "new" && (
                  <div className="space-y-4 py-4">
                    <Button variant="ghost" size="sm" onClick={() => setChatType(null)} className="mb-2">← Back</Button>
                    <div>
                      <Label>Prospect Name *</Label>
                      <Input value={newProspectName} onChange={(e) => setNewProspectName(e.target.value)} placeholder="e.g., Sarah, John D." />
                    </div>
                    <div>
                      <Label>Instagram profile or post URL</Label>
                      <Input value={newProspectIg} onChange={(e) => setNewProspectIg(e.target.value)} placeholder="https://instagram.com/username or /reel/..." />
                      <p className="text-xs text-muted-foreground mt-1">We'll analyze their page or exact post to craft a first message</p>
                    </div>
                    {isGeneratingFirst && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Analyzing profile & generating first message...</span>
                      </div>
                    )}
                    {firstMessageSuggestions.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Suggested Opening Messages</p>
                        {firstMessageSuggestions.map((s) => (
                          <Card key={s.id} className="p-3">
                            <p className="text-sm">{s.text}</p>
                            {s.whyThisWorks && <p className="text-xs text-muted-foreground mt-1">💡 {s.whyThisWorks}</p>}
                          </Card>
                        ))}
                      </div>
                    )}
                    <DialogFooter>
                      <Button onClick={() => createProspect.mutate()} disabled={!newProspectName.trim() || createProspect.isPending}>
                        {createProspect.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Analyzing...</> : "Create & Analyze"}
                      </Button>
                    </DialogFooter>
                  </div>
                )}

                {/* Existing Conversation Flow */}
                {chatType === "existing" && (
                  <div className="space-y-4 py-4">
                    <Button variant="ghost" size="sm" onClick={() => { setChatType(null); setUploadStep("info"); setScreenshotFiles([]); setScreenshotPreviews([]); }} className="mb-2">← Back</Button>

                    {uploadStep === "info" && (
                      <>
                        <div>
                          <Label>Prospect Name *</Label>
                          <Input value={newProspectName} onChange={(e) => setNewProspectName(e.target.value)} placeholder="e.g., Sarah, John D." />
                        </div>
                        <div>
                          <Label>Instagram profile or post URL</Label>
                          <Input value={newProspectIg} onChange={(e) => setNewProspectIg(e.target.value)} placeholder="https://instagram.com/username or /reel/..." />
                        </div>
                        <DialogFooter>
                          <Button onClick={() => setUploadStep("upload")} disabled={!newProspectName.trim()}>Next: Upload Screenshots</Button>
                        </DialogFooter>
                      </>
                    )}

                    {uploadStep === "upload" && (
                      <>
                        <div className="text-center p-6 border-2 border-dashed rounded-lg">
                          <input
                            ref={bulkScreenshotInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(e) => { handleBulkScreenshotSelect(e.target.files); e.target.value = ""; }}
                          />
                          <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                          <p className="text-sm font-medium mb-1">Upload conversation screenshots</p>
                          <p className="text-xs text-muted-foreground mb-3">Upload all your DM screenshots in order. The AI will read and learn from them.</p>
                          <Button variant="outline" onClick={() => bulkScreenshotInputRef.current?.click()}>
                            <Image className="h-4 w-4 mr-2" />Add Screenshots
                          </Button>
                        </div>

                        <div>
                          <Label>Anything the AI should know? (optional)</Label>
                          <Textarea
                            value={screenshotContextNote}
                            onChange={(e) => setScreenshotContextNote(e.target.value)}
                            placeholder="Example: We met in a Facebook group, this is the full conversation, and I want to know what to say next."
                            className="mt-1 min-h-[72px]"
                          />
                          <p className="text-xs text-muted-foreground mt-1">This note is analyzed together with the screenshots but kept separate from the prospect's words.</p>
                        </div>

                        {screenshotPreviews.length > 0 && (
                          <div>
                            <p className="text-sm font-medium mb-2">{screenshotFiles.length} screenshot(s) selected</p>
                            <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                              {screenshotPreviews.map((preview, i) => (
                                <div key={i} className="relative group">
                                  <img src={preview} alt={`Screenshot ${i + 1}`} className="rounded border h-20 w-full object-cover" />
                                  <button
                                    onClick={() => removeScreenshot(i)}
                                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full h-5 w-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <DialogFooter>
                          <Button onClick={processExistingConversation} disabled={screenshotFiles.length === 0}>
                            <Sparkles className="h-4 w-4 mr-2" />Process & Get AI Suggestions
                          </Button>
                        </DialogFooter>
                      </>
                    )}

                    {uploadStep === "processing" && (
                      <div className="text-center py-8 space-y-4">
                        <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
                        <div>
                          <p className="font-medium">Processing screenshots...</p>
                          <p className="text-sm text-muted-foreground">Reading your conversation and analyzing context</p>
                        </div>
                      </div>
                    )}

                    {uploadStep === "done" && (
                      <div className="text-center py-8 space-y-4">
                        <Check className="h-10 w-10 mx-auto text-green-500" />
                        <div>
                          <p className="font-medium">Conversation analyzed!</p>
                          <p className="text-sm text-muted-foreground">Redirecting to your chat with AI suggestions...</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Re-engage Flow (ghosted prospect) */}
                {chatType === "reengage" && (
                  <div className="space-y-4 py-4">
                    <Button variant="ghost" size="sm" onClick={() => { setChatType(null); setUploadStep("info"); setScreenshotFiles([]); setScreenshotPreviews([]); }} className="mb-2">← Back</Button>

                    {uploadStep === "info" && (
                      <>
                        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3">
                          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 text-sm">
                            <Ghost className="h-4 w-4" />
                            <span className="font-medium">Re-engagement Mode</span>
                          </div>
                          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">Upload your conversation screenshots. The AI will analyze why they stopped replying and craft a message to bring them back.</p>
                        </div>
                        <div>
                          <Label>Prospect Name *</Label>
                          <Input value={newProspectName} onChange={(e) => setNewProspectName(e.target.value)} placeholder="e.g., Sarah, John D." />
                        </div>
                        <div>
                          <Label>Instagram profile or post URL</Label>
                          <Input value={newProspectIg} onChange={(e) => setNewProspectIg(e.target.value)} placeholder="https://instagram.com/username or /reel/..." />
                        </div>
                        <DialogFooter>
                          <Button onClick={() => setUploadStep("upload")} disabled={!newProspectName.trim()}>Next: Upload Screenshots</Button>
                        </DialogFooter>
                      </>
                    )}

                    {uploadStep === "upload" && (
                      <>
                        <div className="text-center p-6 border-2 border-dashed rounded-lg">
                          <input
                            ref={bulkScreenshotInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(e) => { handleBulkScreenshotSelect(e.target.files); e.target.value = ""; }}
                          />
                          <Ghost className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                          <p className="text-sm font-medium mb-1">Upload the full conversation</p>
                          <p className="text-xs text-muted-foreground mb-3">Include your last sent message that was seen but not replied to.</p>
                          <Button variant="outline" onClick={() => bulkScreenshotInputRef.current?.click()}>
                            <Image className="h-4 w-4 mr-2" />Add Screenshots
                          </Button>
                        </div>

                        <div>
                          <Label>What happened outside the screenshot? (optional)</Label>
                          <Textarea
                            value={screenshotContextNote}
                            onChange={(e) => setScreenshotContextNote(e.target.value)}
                            placeholder="Example: They viewed my last message three days ago and have not replied."
                            className="mt-1 min-h-[72px]"
                          />
                          <p className="text-xs text-muted-foreground mt-1">The AI will combine this note with visible timestamps, seen status, reactions, and the full transcript.</p>
                        </div>

                        {screenshotPreviews.length > 0 && (
                          <div>
                            <p className="text-sm font-medium mb-2">{screenshotFiles.length} screenshot(s) selected</p>
                            <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                              {screenshotPreviews.map((preview, i) => (
                                <div key={i} className="relative group">
                                  <img src={preview} alt={`Screenshot ${i + 1}`} className="rounded border h-20 w-full object-cover" />
                                  <button
                                    onClick={() => removeScreenshot(i)}
                                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full h-5 w-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <DialogFooter>
                          <Button onClick={processReengageConversation} disabled={screenshotFiles.length === 0}>
                            <Sparkles className="h-4 w-4 mr-2" />Analyze & Get Re-engage Message
                          </Button>
                        </DialogFooter>
                      </>
                    )}

                    {uploadStep === "processing" && (
                      <div className="text-center py-8 space-y-4">
                        <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
                        <div>
                          <p className="font-medium">Analyzing conversation...</p>
                          <p className="text-sm text-muted-foreground">Finding the best way to re-engage this prospect</p>
                        </div>
                      </div>
                    )}

                    {uploadStep === "done" && (
                      <div className="text-center py-8 space-y-4">
                        <Check className="h-10 w-10 mx-auto text-green-500" />
                        <div>
                          <p className="font-medium">Re-engagement strategy ready!</p>
                          <p className="text-sm text-muted-foreground">Redirecting to your chat...</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
          <div className="px-3 py-1">
            <Select value={activeWorkspace?.id || ""} onValueChange={(wsId) => {
              // Set new active workspace
              const switchWorkspace = async () => {
                if (!user) return;
                await supabase.from("workspaces").update({ is_active: false }).eq("user_id", user.id);
                await supabase.from("workspaces").update({ is_active: true }).eq("id", wsId);
                queryClient.invalidateQueries({ queryKey: ["workspaces"] });
                queryClient.invalidateQueries({ queryKey: ["prospects"] });
                navigate("/chats");
              };
              switchWorkspace();
            }}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Select workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces?.map((ws: any) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    <span className="flex items-center gap-1">
                      {ws.workspace_type === "expert" ? <Briefcase className="h-3 w-3" /> : <Heart className="h-3 w-3" />}
                      {ws.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {prospects?.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No chats yet</p>
              <p className="text-xs">Click "New" to start</p>
            </div>
          ) : (
            <div className="divide-y">
              {prospects?.map((prospect) => (
                <div
                  key={prospect.id}
                  className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${selectedProspectId === prospect.id ? "bg-muted" : ""}`}
                  onClick={() => navigate(`/chats/${prospect.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 shrink-0">
                      {(prospect as any).profile_pic_url ? (
                        <AvatarImage
                          key={(prospect as any).profile_pic_url}
                          src={(prospect as any).profile_pic_url}
                          alt={prospect.name}
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                      <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                        {getInitials(prospect.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-medium truncate">{prospect.name}</p>
                        {prospect.reply_mode === "expert" ? <Briefcase className="h-3 w-3 text-blue-500" /> : <Heart className="h-3 w-3 text-pink-500" />}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {(prospect as any).instagram_username ? `@${(prospect as any).instagram_username} · ` : ""}
                        {prospect.reply_mode === "expert"
                          ? prospect.conversation_stage?.replace(/_/g, " ")
                          : friendStageDisplayLabel(prospect.conversation_stage)}
                      </p>
                    </div>
                    {prospect.outcome !== "active" && (
                      <Badge variant={prospect.outcome === "won" ? "default" : "secondary"} className="text-xs">{prospect.outcome}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
      )}

      {/* Main Chat Area */}
      {showChat && (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {!selectedProspectId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="font-medium mb-1">Select a chat</h3>
              <p className="text-sm text-muted-foreground">Choose a prospect or create a new chat</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="p-2 md:p-4 border-b flex items-center gap-1 md:gap-2 shrink-0" style={{ minHeight: "var(--chat-header-h)" }}>
              {isMobile && (
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate("/chats")}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <Avatar className="h-8 w-8 md:h-10 md:w-10 shrink-0">
                {(selectedProspect as any)?.profile_pic_url ? (
                  <AvatarImage
                    key={`${(selectedProspect as any).profile_pic_url}-${avatarRefreshVersion}`}
                    src={(selectedProspect as any).profile_pic_url}
                    alt={selectedProspect?.name}
                    referrerPolicy="no-referrer"
                    onLoadingStatusChange={(status) => {
                      if (status === "error") void refreshSelectedProspectAvatar();
                    }}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary text-xs md:text-sm font-medium">
                  {selectedProspect?.name ? getInitials(selectedProspect.name) : "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm md:text-base truncate">{selectedProspect?.name}</h3>
                <p className="text-xs text-muted-foreground truncate">
                  {isMobile
                    ? ((selectedProspect as any)?.platform === "tiktok"
                      ? ((selectedProspect as any)?.tiktok_url ? `TikTok · ${(selectedProspect as any).tiktok_url.replace("https://tiktok.com/", "")}` : "TikTok prospect")
                      : ((selectedProspect as any)?.instagram_username ? `@${(selectedProspect as any).instagram_username}` : "Paste a message"))
                    : ((selectedProspect as any)?.platform === "tiktok"
                      ? `TikTok prospect · ${selectedProspect?.detected_interests || "Paste a message to get AI suggestions"}`
                      : (selectedProspect?.detected_interests || "Paste a message to get AI suggestions"))
                  }
                </p>
              </div>
              {!isMobile && (
                <Select value={currentThreadType} onValueChange={async (v: "friend" | "expert") => {
                  setCurrentThreadType(v);
                  setSuggestions([]);
                  if (selectedProspectId) {
                    await supabase.from("prospects").update({ reply_mode: v }).eq("id", selectedProspectId);
                    queryClient.invalidateQueries({ queryKey: ["selected-prospect", selectedProspectId] });
                    queryClient.invalidateQueries({ queryKey: ["prospects"] });
                  }
                }}>
                  <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friend"><div className="flex items-center gap-2"><Heart className="h-3 w-3 text-pink-500" />Friend</div></SelectItem>
                    <SelectItem value="expert"><div className="flex items-center gap-2"><Briefcase className="h-3 w-3 text-blue-500" />Expert</div></SelectItem>
                  </SelectContent>
                </Select>
              )}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="bottom" className="z-[100]">
                  {isMobile && (
                    <>
                      <DropdownMenuItem onClick={async () => {
                        setCurrentThreadType("friend"); setSuggestions([]);
                        if (selectedProspectId) await supabase.from("prospects").update({ reply_mode: "friend" }).eq("id", selectedProspectId);
                      }}>
                        <Heart className="h-3 w-3 mr-2 text-pink-500" />Friend Mode
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={async () => {
                        setCurrentThreadType("expert"); setSuggestions([]);
                        if (selectedProspectId) await supabase.from("prospects").update({ reply_mode: "expert" }).eq("id", selectedProspectId);
                      }}>
                        <Briefcase className="h-3 w-3 mr-2 text-blue-500" />Expert Mode
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem onClick={() => { updateOutcome.mutate({ id: selectedProspectId!, outcome: "won" }); toast.success("Marked as won!"); }}>Mark as Won</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { updateOutcome.mutate({ id: selectedProspectId!, outcome: "lost" }); toast.success("Marked as lost"); }}>Mark as Lost</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { updateOutcome.mutate({ id: selectedProspectId!, outcome: "ghosted" }); toast.success("Marked as ghosted"); }}>Mark as Ghosted</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => deleteProspect.mutate(selectedProspectId!)}>
                    <Trash2 className="h-4 w-4 mr-2" />Delete Chat
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Prospect Type Badge (shown below header on mobile) */}
            {isMobile && prospectType && prospectType !== "unknown" && (
              <div className="px-3 py-1 border-b">
                <Badge 
                  variant="secondary" 
                  className={`text-[10px] px-1.5 py-0 border ${
                    prospectType === "just_started" ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400" :
                    prospectType === "no_sales" ? "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400" :
                    prospectType === "crickets" ? "bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-400" :
                    prospectType === "bad_mentor" ? "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-400" :
                    prospectType === "lone_wolf" ? "bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-400" :
                    prospectType === "scam_skeptic" ? "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-400" :
                    prospectType === "plateaued" ? "bg-yellow-500/15 text-yellow-700 border-yellow-500/30 dark:text-yellow-400" :
                    "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  {prospectType.replace(/_/g, " ")}
                </Badge>
              </div>
            )}

            {/* Desktop prospect type badge inline */}
            {!isMobile && prospectType && prospectType !== "unknown" && null}

            {/* Thread Type Header + Conversation Stage Progress Bar */}
            <div className={`px-4 py-2 border-b ${currentThreadType === "expert" ? "bg-blue-50 dark:bg-blue-950/20" : "bg-pink-50 dark:bg-pink-950/20"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {currentThreadType === "expert" ? (
                    <>
                      <Briefcase className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-medium text-blue-900 dark:text-blue-100">Expert Team Mode</span>
                    </>
                  ) : (
                    <>
                      <Heart className="h-4 w-4 text-pink-600" />
                      <span className="text-sm font-medium text-pink-900 dark:text-pink-100">Friend Mode</span>
                    </>
                  )}
                </div>
              </div>
              {/* Stage Progress Bar */}
              {(() => {
                const stages = ["intent", "logical_certainty", "emotional_certainty", "pitch", "handoff"];
                const stageLabels: Record<string, string> = { intent: "Intent", logical_certainty: "Logical certainty", emotional_certainty: "Emotional certainty", pitch: "Pitch", handoff: "Handoff" };
                const currentStageRaw = (conversationStage || selectedProspect?.conversation_stage || "first_contact").toLowerCase().replace(/[\s_-]/g, "");
                const stageMap: Record<string, string> = {
                  firstcontact: "intent", opener: "intent", intent: "intent", continuing: "intent",
                  rapport: "intent", rapportbuilding: "intent", ghosted: "intent",
                  pain: "logical_certainty", paindiscovery: "logical_certainty", problem: "logical_certainty", logicalcertainty: "logical_certainty",
                  offer: "pitch", solution: "pitch", presenting: "pitch", pitch: "pitch",
                  emotionalcertainty: "emotional_certainty", needpayoff: "emotional_certainty",
                  close: "handoff", closing: "handoff", handoff: "handoff",
                };
                const activeStage = stageMap[currentStageRaw] || "intent";
                const activeIdx = stages.indexOf(activeStage);
                return (
                  <div className="flex items-center gap-1">
                    {stages.map((stage, i) => {
                      const isCompleted = i < activeIdx;
                      const isActive = i === activeIdx;
                      return (
                        <div key={stage} className="flex items-center flex-1">
                          <div className="flex flex-col items-center flex-1">
                            <div className={`h-2 w-full rounded-full transition-all ${isCompleted ? "bg-primary" : isActive ? "bg-primary/70 animate-pulse" : "bg-muted-foreground/20"}`} />
                            <span className={`min-h-6 text-center leading-tight text-[9px] mt-1 font-medium ${isActive ? "text-primary" : isCompleted ? "text-primary/70" : "text-muted-foreground/50"}`}>
                              {stageLabels[stage]}
                            </span>
                          </div>
                          {i < stages.length - 1 && <div className="w-1 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Conversation Intelligence Panel */}
            <ConversationIntelligencePanel
              prospectId={selectedProspectId}
              messageCount={messages?.length || 0}
              analysis={conversationAnalysis}
              isLoading={isAnalyzingIntel}
              threadType={currentThreadType}
              onAnalysisComplete={(analysis) => {
                setConversationAnalysis(analysis);
                if (analysis.stage) setConversationStage(analysis.stage);
                queryClient.invalidateQueries({ queryKey: ["prospects"] });
              }}
            />

            {/* Messages */}
            <ScrollArea className="flex-1 min-h-0 p-4" ref={scrollAreaRef}>
              <div className="space-y-4">
                {messages?.map((message, index) => {
                  const isContext = message.direction === "context";
                  const isUnknown = message.direction === "unknown";
                  const isOutbound = message.direction === "outbound";
                  const showScreenshot = Boolean(message.screenshot_url) && messages[index - 1]?.screenshot_url !== message.screenshot_url;
                  return (
                    <div key={message.id} className={`flex ${isContext || isUnknown ? "justify-center" : isOutbound ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] md:max-w-[70%] rounded-lg p-3 ${
                        isContext
                          ? "border border-dashed bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"
                          : isUnknown
                            ? "border border-dashed bg-muted/50"
                          : isOutbound ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}>
                        {showScreenshot && message.screenshot_url && <ChatScreenshotPreview filePath={message.screenshot_url} />}
                        {isContext && <p className="text-[10px] uppercase tracking-wide font-semibold opacity-70 mb-1">Salesperson context</p>}
                        {isUnknown && <p className="text-[10px] uppercase tracking-wide font-semibold opacity-70 mb-1">Unknown speaker — verify this message</p>}
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        {message.direction === "inbound" && message.detected_tone && (
                          <p className="text-xs mt-1 opacity-70">Tone: {message.detected_tone}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(isAnalyzing || isRefining) && (
                  <AiTypingIndicator label={isRefining ? "Legacy Coach is refining your message" : "Legacy Coach is writing reply suggestions"} />
                )}
                {isGeneratingFirst && !messages?.length && suggestions.length === 0 && (
                  <AiTypingIndicator label="Legacy Coach is creating your opener" className="py-4" />
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* AI Suggestions */}
            {suggestions.length > 0 && (
              <div className="min-h-0 max-h-[55dvh] shrink overflow-y-auto overscroll-contain border-t bg-muted/30 p-3 md:max-h-[45dvh] md:p-4">
                {pushyWarning && (
                  <div className="flex items-center gap-2 text-amber-600 mb-3 text-sm">
                    <AlertTriangle className="h-4 w-4" /><span>{pushyWarning}</span>
                  </div>
                )}

                {/* Referral warning banner */}
                {(conversationAnalysis?.stage === "pitch" || conversationAnalysis?.stage === "handoff") && conversationAnalysis?.pain_expressed && (
                  <ReferralWarningBanner warmthScore={conversationAnalysis.warmth_score} />
                )}

                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />Suggested Replies
                  </p>
                  <div className="flex gap-1 flex-wrap">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleEmotionalReply("emotional with a personal story")} disabled={isAnalyzing}>
                      <Heart className="h-3 w-3 mr-1" />+ Story
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleEmotionalReply("softer, more casual and low-pressure")} disabled={isAnalyzing}>
                      <Zap className="h-3 w-3 mr-1" />Softer
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleEmotionalReply("more direct and push toward next step")} disabled={isAnalyzing}>
                      <TrendingUp className="h-3 w-3 mr-1" />Push
                    </Button>
                  </div>
                </div>
                <div className="space-y-3">
                  {suggestions.map((s) => (
                    <SuggestionCard
                      key={s.id}
                      suggestion={s}
                      analysis={conversationAnalysis}
                      copiedId={copiedId}
                      feedbackState={feedbackMap[s.id]}
                      onCopy={handleCopy}
                      onUse={handleUseSuggestion}
                      onFeedback={handleFeedback}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Input Area */}
            <div className="shrink-0 p-3 md:p-4 border-t chat-input-safe">
              <input
                ref={screenshotInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleScreenshotUpload(file);
                  e.target.value = "";
                }}
              />
              {pendingScreenshot && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-md border bg-muted/50 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-xs">
                    <Camera className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate">Screenshot attached. Its image, visual signals, speaker order, and edited transcript will be analyzed together.</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => {
                      setPendingScreenshot(null);
                      setMessageInput(pendingScreenshotNote);
                      setPendingScreenshotNote("");
                    }}
                    title="Remove attached screenshot"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
              {/* Mode toggle */}
              <div className="flex items-center gap-2 mb-2">
                <Button
                  variant={!isRefineMode ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => { setIsRefineMode(false); setSuggestions([]); }}
                >
                  <Send className="h-3 w-3 mr-1" />Prospect's Message
                </Button>
                <Button
                  variant={isRefineMode ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => { setIsRefineMode(true); setSuggestions([]); }}
                >
                  <PenLine className="h-3 w-3 mr-1" />Refine My Draft
                </Button>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Textarea
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder={isOcrProcessing ? "Extracting text from screenshot..." : isRefineMode ? "Paste your draft message here and we'll perfect it..." : "Paste the prospect's message here..."}
                    className="min-h-[80px] pr-12"
                    disabled={isOcrProcessing}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (isRefineMode) handleRefineDraft();
                        else handleSendInbound();
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 h-8 w-8"
                    onClick={() => screenshotInputRef.current?.click()}
                    disabled={isOcrProcessing}
                    title="Upload screenshot for OCR"
                  >
                    {isOcrProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
                {isRefineMode ? (
                  <Button onClick={handleRefineDraft} disabled={!messageInput.trim() || isRefining} className="self-end">
                    {isRefining ? <Loader2 className="h-4 w-4 animate-spin" /> : <><PenLine className="h-4 w-4 mr-1" />Refine</>}
                  </Button>
                ) : (
                  <Button onClick={handleSendInbound} disabled={!messageInput.trim() || isAnalyzing} className="self-end">
                    {isAnalyzing ? <Sparkles className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {isRefineMode ? (
                  <><PenLine className="h-3 w-3 inline mr-1" />Paste your message and we'll polish it before you send</>
                ) : (
                  <><Camera className="h-3 w-3 inline mr-1" />Upload a screenshot to extract text via OCR</>
                )}
              </p>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
}
