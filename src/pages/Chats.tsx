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
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";
import {
  MessageSquare, Plus, Send, User, Sparkles,
  Copy, Check, AlertTriangle,
  Heart, Briefcase, MoreVertical, Trash2, Camera, Loader2, Image, Upload, X,
  Ghost, PenLine, RotateCcw
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type Suggestion = { id: number; type: string; text: string; whyThisWorks?: string };

export default function Chats() {
  const { prospectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const selectedProspectId = prospectId || null;

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const bulkScreenshotInputRef = useRef<HTMLInputElement>(null);

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
      return data;
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

  const selectedProspect = prospects?.find((p) => p.id === selectedProspectId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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

  const handleSendInbound = async () => {
    if (!messageInput.trim() || !selectedProspectId) return;
    setIsAnalyzing(true);

    await supabase.from("chat_messages").insert({
      user_id: user!.id,
      prospect_id: selectedProspectId,
      content: messageInput,
      direction: "inbound",
      thread_type: currentThreadType,
    });

    try {
      const { data, error } = await supabase.functions.invoke("chat-suggest", {
        body: {
          prospectId: selectedProspectId,
          message: messageInput,
          threadType: currentThreadType,
        },
      });
      if (error) throw error;
      setSuggestions(data.suggestions || []);
      setPushyWarning(data.pushyWarning || null);
    } catch (e: any) {
      console.error("AI suggestion error:", e);
      toast.error("Failed to get suggestions");
    }

    setMessageInput("");
    queryClient.invalidateQueries({ queryKey: ["messages"] });
    setIsAnalyzing(false);
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
    queryClient.invalidateQueries({ queryKey: ["messages"] });
    toast.success("Response recorded!");
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

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Sidebar - Prospect List */}
      <div className="w-80 border-r flex flex-col bg-muted/30">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-2">
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
          <p className="text-xs text-muted-foreground">Workspace: {activeWorkspace.name}</p>
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
                    {(prospect as any).profile_pic_url ? (
                      <img src={(prospect as any).profile_pic_url} alt={prospect.name} className="h-10 w-10 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).onerror = null; }} />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                    )}
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

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
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
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-3">
                {(selectedProspect as any)?.profile_pic_url ? (
                  <img src={(selectedProspect as any).profile_pic_url} alt={selectedProspect?.name} className="h-10 w-10 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).onerror = null; }} />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                )}
                <div>
                  <h3 className="font-medium">{selectedProspect?.name} {(selectedProspect as any)?.instagram_username ? <span className="text-xs text-muted-foreground font-normal">@{(selectedProspect as any).instagram_username}</span> : null}</h3>
                  <p className="text-xs text-muted-foreground">{selectedProspect?.detected_interests || "Paste a message to get AI suggestions"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={currentThreadType} onValueChange={(v: "friend" | "expert") => { setCurrentThreadType(v); setSuggestions([]); }}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friend"><div className="flex items-center gap-2"><Heart className="h-3 w-3 text-pink-500" />Friend</div></SelectItem>
                    <SelectItem value="expert"><div className="flex items-center gap-2"><Briefcase className="h-3 w-3 text-blue-500" />Expert</div></SelectItem>
                  </SelectContent>
                </Select>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { updateOutcome.mutate({ id: selectedProspectId!, outcome: "won" }); toast.success("Marked as won!"); }}>Mark as Won</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { updateOutcome.mutate({ id: selectedProspectId!, outcome: "lost" }); toast.success("Marked as lost"); }}>Mark as Lost</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { updateOutcome.mutate({ id: selectedProspectId!, outcome: "ghosted" }); toast.success("Marked as ghosted"); }}>Mark as Ghosted</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => deleteProspect.mutate(selectedProspectId!)}>
                      <Trash2 className="h-4 w-4 mr-2" />Delete Chat
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Thread Type Header */}
            <div className={`px-4 py-2 border-b ${currentThreadType === "expert" ? "bg-blue-50 dark:bg-blue-950/20" : "bg-pink-50 dark:bg-pink-950/20"}`}>
              <div className="flex items-center gap-2">
                {currentThreadType === "expert" ? (
                  <>
                    <Briefcase className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-900 dark:text-blue-100">Expert Team Mode - Professional & Direct</span>
                  </>
                ) : (
                  <>
                    <Heart className="h-4 w-4 text-pink-600" />
                    <span className="text-sm font-medium text-pink-900 dark:text-pink-100">Friend Mode - Warm & Casual</span>
                  </>
                )}
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages?.map((message) => (
                  <div key={message.id} className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] rounded-lg p-3 ${message.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
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
                <p className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />Suggested Replies
                </p>
                <div className="space-y-2">
                  {suggestions.map((s) => (
                    <Card key={s.id} className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <Badge variant="outline" className="mb-2 text-xs">
                            {s.type === "primary" ? "Best Reply" : s.type === "alternative" ? "Alternative" : "Softer"}
                          </Badge>
                          <p className="text-sm">{s.text}</p>
                          {s.whyThisWorks && <p className="text-xs text-muted-foreground mt-2">💡 {s.whyThisWorks}</p>}
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleCopy(s.id, s.text)}>
                            {copiedId === s.id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                          </Button>
                          <Button size="sm" onClick={() => handleUseSuggestion(s)}>Use</Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Input Area */}
            <div className="p-4 border-t">
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
    </div>
  );
}
