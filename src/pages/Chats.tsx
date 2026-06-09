import { useState, useRef, useEffect } from "react";
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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import TikTokOutreach from "@/components/TikTokOutreach";
import ConversationIntelligencePanel, { type ConversationAnalysis } from "@/components/ConversationIntelligencePanel";

import SuggestionCard, { ReferralWarningBanner, type Suggestion } from "@/components/SuggestionCard";
type FeedbackMap = Record<number, "positive" | "negative">;

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const bulkScreenshotInputRef = useRef<HTMLInputElement>(null);
  const autoFirstMessageAttempted = useRef<Record<string, boolean>>({});

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
  const { data: messages } = useQuery({
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
    if (selectedProspect && !messages?.length) {
      const savedFirst = (selectedProspect as any).suggested_first_message;
      if (savedFirst) {
        try {
          const parsed = JSON.parse(savedFirst);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSuggestions(parsed);
            return;
          }
        } catch {
          if (savedFirst.trim()) {
            setSuggestions([{ id: 1, type: "first_dm", text: savedFirst }]);
            return;
          }
        }
      }
    }
  }, [selectedProspectId, selectedProspect, messages]);

  useEffect(() => {
    if (!selectedProspectId || !selectedProspect || !messages || messages.length > 0 || suggestions.length > 0 || isGeneratingFirst) return;
    if (autoFirstMessageAttempted.current[selectedProspectId]) return;

    const prospect = selectedProspect as any;
    if (prospect.suggested_first_message) return;
    if (!prospect.instagram_url && !prospect.tiktok_url && !prospect.detected_interests) return;

    autoFirstMessageAttempted.current[selectedProspectId] = true;
    setIsGeneratingFirst(true);

    const profileMessage = [
      prospect.platform ? `Platform: ${prospect.platform}` : "",
      prospect.name ? `Name: ${prospect.name}` : "",
      prospect.detected_interests ? `Bio/interests: ${prospect.detected_interests}` : "",
      prospect.instagram_url ? `Instagram URL: ${prospect.instagram_url}` : "",
      prospect.tiktok_url ? `TikTok URL: ${prospect.tiktok_url}` : "",
      prospect.target_video_caption ? `Target video/post: ${prospect.target_video_caption}` : "",
      prospect.suggested_comment ? `Comment already used: ${prospect.suggested_comment}` : "",
    ].filter(Boolean).join("\n");

    supabase.functions.invoke("chat-suggest", {
      body: {
        prospectId: selectedProspectId,
        message: profileMessage,
        threadType: currentThreadType,
        mode: "first_message",
      },
    }).then(({ data, error }) => {
      if (error) throw error;
      if (data?.suggestions?.length) {
        setSuggestions(data.suggestions);
        setPushyWarning(data.pushyWarning || null);
        queryClient.invalidateQueries({ queryKey: ["selected-prospect", selectedProspectId] });
        queryClient.invalidateQueries({ queryKey: ["prospects"] });
      }
    }).catch((error) => {
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
          const { data: igData } = await supabase.functions.invoke("fetch-instagram", {
            body: { username: newProspectIg },
          });
          if (igData && !igData.error) {
            const interests = [igData.businessCategory, igData.biography?.substring(0, 200)].filter(Boolean).join(" | ");
            await supabase.from("prospects").update({
              detected_interests: interests || null,
              profile_pic_url: igData.profilePicUrl || null,
              instagram_username: igData.username || null,
              name: igData.fullName || newProspectName,
            } as any).eq("id", prospect.id);
            
          }
        } catch (e) { console.error("IG fetch error:", e); }
      }

      // 3. Upload and OCR all screenshots sequentially
      const allTexts: string[] = [];
      for (let i = 0; i < screenshotFiles.length; i++) {
        const file = screenshotFiles[i];
        const filePath = `${user.id}/${Date.now()}-${i}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("chat-screenshots").upload(filePath, file);
        if (uploadError) { console.error("Upload error:", uploadError); continue; }

        const { data, error } = await supabase.functions.invoke("ocr-screenshot", { body: { filePath } });
        if (!error && data?.text) {
          allTexts.push(`[Screenshot ${i + 1}]:\n${data.text}`);
        }
      }

      const fullConversation = allTexts.join("\n\n");
      setExtractedConversation(fullConversation);

      // 4. Save the extracted conversation as inbound messages
      if (fullConversation) {
        await supabase.from("chat_messages").insert({
          user_id: user.id,
          prospect_id: prospect.id,
          content: fullConversation,
          direction: "inbound",
          thread_type: currentThreadType,
        });
      }

      // 5. Ask AI for next reply suggestion based on full conversation
      const { data: suggestData, error: suggestError } = await supabase.functions.invoke("chat-suggest", {
        body: {
          prospectId: prospect.id,
          message: fullConversation,
          threadType: currentThreadType,
          mode: "continue",
        },
      });

      if (!suggestError && suggestData?.suggestions) {
        setFirstMessageSuggestions(suggestData.suggestions);
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
          const { data: igData } = await supabase.functions.invoke("fetch-instagram", {
            body: { username: newProspectIg },
          });
          if (igData && !igData.error) {
            const interests = [igData.businessCategory, igData.biography?.substring(0, 200)].filter(Boolean).join(" | ");
            await supabase.from("prospects").update({
              detected_interests: interests || null,
              profile_pic_url: igData.profilePicUrl || null,
              instagram_username: igData.username || null,
              name: igData.fullName || newProspectName,
            } as any).eq("id", prospect.id);
          }
        } catch (e) { console.error("IG fetch error:", e); }
      }

      const allTexts: string[] = [];
      for (let i = 0; i < screenshotFiles.length; i++) {
        const file = screenshotFiles[i];
        const filePath = `${user.id}/${Date.now()}-${i}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("chat-screenshots").upload(filePath, file);
        if (uploadError) { console.error("Upload error:", uploadError); continue; }
        const { data, error } = await supabase.functions.invoke("ocr-screenshot", { body: { filePath } });
        if (!error && data?.text) {
          allTexts.push(`[Screenshot ${i + 1}]:\n${data.text}`);
        }
      }

      const fullConversation = allTexts.join("\n\n");

      if (fullConversation) {
        await supabase.from("chat_messages").insert({
          user_id: user.id,
          prospect_id: prospect.id,
          content: fullConversation,
          direction: "inbound",
          thread_type: currentThreadType,
        });
      }

      const { data: suggestData, error: suggestError } = await supabase.functions.invoke("chat-suggest", {
        body: {
          prospectId: prospect.id,
          message: fullConversation || "The prospect has ghosted me. They saw my last message but didn't reply.",
          threadType: currentThreadType,
          mode: "reengage",
        },
      });

      if (!suggestError && suggestData?.suggestions) {
        setFirstMessageSuggestions(suggestData.suggestions);
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
      const { data, error } = await supabase.functions.invoke("chat-suggest", {
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
        try {
          const { data: igData } = await supabase.functions.invoke("fetch-instagram", {
            body: { username: newProspectIg },
          });
      if (igData && !igData.error) {
            const interests = [igData.businessCategory, igData.biography?.substring(0, 200)].filter(Boolean).join(" | ");
            await supabase.from("prospects").update({
              detected_interests: interests || null,
              profile_pic_url: igData.profilePicUrl || null,
              instagram_username: igData.username || null,
              name: igData.fullName || newProspectName,
            } as any).eq("id", data.id);

            // Generate first message using AI — pass full profile summary
            const { data: suggestData } = await supabase.functions.invoke("chat-suggest", {
              body: {
                prospectId: data.id,
                message: igData.summary || `Instagram profile: @${igData.username}. Bio: ${igData.biography || "N/A"}. Followers: ${igData.followersCount || "N/A"}. Category: ${igData.businessCategory || "N/A"}. Posts: ${igData.postsCount || 0}. ${igData.recentPosts?.map((p: any, i: number) => `Post ${i+1}: "${p.caption}" (${p.likes} likes)`).join(". ") || ""}`,
                threadType: currentThreadType,
                mode: "first_message",
              },
            });
            if (suggestData?.suggestions) {
              generatedSuggestions = suggestData.suggestions;
              setFirstMessageSuggestions(suggestData.suggestions);
              // Persist to prospect so auto-load effect can recover after navigation
              await supabase.from("prospects").update({
                suggested_first_message: JSON.stringify(suggestData.suggestions),
              }).eq("id", data.id);
            }
          }
        } catch (e) {
          console.error("Instagram auto-fetch error:", e);
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
      const filePath = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("chat-screenshots").upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data, error } = await supabase.functions.invoke("ocr-screenshot", { body: { filePath } });
      if (error) throw error;

      if (data?.text) {
        setMessageInput(data.text);
        toast.success("Text extracted from screenshot!");
      } else {
        toast.error("Could not extract text from screenshot");
      }
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

  const handleSendInbound = async () => {
    if (!messageInput.trim() || !selectedProspectId) return;
    setIsAnalyzing(true);
    setIsAnalyzingIntel(true);

    const tiktokUrl = detectTikTokUrl(messageInput);
    let enrichedMessage = messageInput;

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
          enrichedMessage = `${messageInput}\n\n--- TIKTOK PROFILE AUTO-SCRAPED ---\n${tiktokData.summary || ""}`;
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

    await supabase.from("chat_messages").insert({
      user_id: user!.id,
      prospect_id: selectedProspectId,
      content: messageInput,
      direction: "inbound",
      thread_type: currentThreadType,
    });

    try {
      const { data, error } = await supabase.functions.invoke("generate-reply", {
        body: {
          prospectId: selectedProspectId,
          message: enrichedMessage,
          threadType: currentThreadType,
        },
      });
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
      toast.error("Failed to get suggestions");
    }

    setMessageInput("");
    queryClient.invalidateQueries({ queryKey: ["messages"] });
    queryClient.invalidateQueries({ queryKey: ["prospects"] });
    setIsAnalyzing(false);
    setIsAnalyzingIntel(false);
  };

  const handleUseSuggestion = async (suggestion: Suggestion) => {
    if (!selectedProspectId) return;
    await supabase.from("chat_messages").insert({
      user_id: user!.id,
      prospect_id: selectedProspectId,
      content: suggestion.text,
      direction: "outbound",
      thread_type: currentThreadType,
      is_ai_suggestion: true,
    });
    setSuggestions([]);
    setPushyWarning(null);
    setFeedbackMap({});
    queryClient.invalidateQueries({ queryKey: ["messages"] });
    toast.success("Response recorded!");
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
      const { data, error } = await supabase.functions.invoke("generate-reply", {
        body: {
          prospectId: selectedProspectId,
          message: lastInbound?.content || "",
          threadType: currentThreadType,
          styleModifier: style,
        },
      });
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
      toast.error("Failed to generate reply");
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
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["prospects"] }),
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
    <div className="flex h-[calc(100dvh-4rem)] overflow-x-hidden" style={{ touchAction: "pan-y" }}>
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
                      <Label>Instagram URL</Label>
                      <Input value={newProspectIg} onChange={(e) => setNewProspectIg(e.target.value)} placeholder="https://instagram.com/username" />
                      <p className="text-xs text-muted-foreground mt-1">We'll analyze their profile to craft a perfect opening message</p>
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
                          <Label>Instagram URL</Label>
                          <Input value={newProspectIg} onChange={(e) => setNewProspectIg(e.target.value)} placeholder="https://instagram.com/username" />
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
                          <Label>Instagram URL</Label>
                          <Input value={newProspectIg} onChange={(e) => setNewProspectIg(e.target.value)} placeholder="https://instagram.com/username" />
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
                          src={(prospect as any).profile_pic_url}
                          alt={prospect.name}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
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
                        {(prospect as any).instagram_username ? `@${(prospect as any).instagram_username} · ` : ""}{prospect.conversation_stage?.replace(/_/g, " ")}
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
                    src={(selectedProspect as any).profile_pic_url}
                    alt={selectedProspect?.name}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
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
                <Select value={currentThreadType} onValueChange={(v: "friend" | "expert") => { setCurrentThreadType(v); setSuggestions([]); }}>
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
                      <DropdownMenuItem onClick={() => { setCurrentThreadType("friend"); setSuggestions([]); }}>
                        <Heart className="h-3 w-3 mr-2 text-pink-500" />Friend Mode
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setCurrentThreadType("expert"); setSuggestions([]); }}>
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
                const stages = ["opener", "rapport", "pain", "offer", "close"];
                const stageLabels: Record<string, string> = { opener: "Opener", rapport: "Rapport", pain: "Pain", offer: "Offer", close: "Close" };
                const currentStageRaw = (conversationStage || selectedProspect?.conversation_stage || "first_contact").toLowerCase().replace(/[\s_-]/g, "");
                const stageMap: Record<string, string> = {
                  firstcontact: "opener", opener: "opener", continuing: "rapport",
                  rapport: "rapport", rapportbuilding: "rapport",
                  pain: "pain", paindiscovery: "pain", problem: "pain",
                  offer: "offer", solution: "offer", presenting: "offer",
                  close: "close", closing: "close", ghosted: "rapport",
                };
                const activeStage = stageMap[currentStageRaw] || "opener";
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
                            <span className={`text-[10px] mt-1 font-medium ${isActive ? "text-primary" : isCompleted ? "text-primary/70" : "text-muted-foreground/50"}`}>
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
            />

            {/* Messages */}
            <ScrollArea className="flex-1 min-h-0 p-4" ref={scrollAreaRef}>
              <div className="space-y-4">
                {messages?.map((message) => (
                  <div key={message.id} className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] md:max-w-[70%] rounded-lg p-3 ${message.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      {message.direction === "inbound" && message.detected_tone && (
                        <p className="text-xs mt-1 opacity-70">Tone: {message.detected_tone}</p>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* AI Suggestions */}
            {suggestions.length > 0 && (
              <div className="p-4 border-t bg-muted/30">
                {pushyWarning && (
                  <div className="flex items-center gap-2 text-amber-600 mb-3 text-sm">
                    <AlertTriangle className="h-4 w-4" /><span>{pushyWarning}</span>
                  </div>
                )}

                {/* Referral warning banner */}
                {conversationAnalysis?.stage === "referral" && conversationAnalysis?.pain_expressed && (
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
            <div className="p-3 md:p-4 border-t chat-input-safe">
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
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); isRefineMode ? handleRefineDraft() : handleSendInbound(); } }}
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
