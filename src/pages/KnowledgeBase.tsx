import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Brain, FileText, Plus, Trash2, Loader2, CheckCircle2, AlertCircle, RefreshCw,
  Link as LinkIcon, Globe, Youtube, Sparkles, Heart, Briefcase, Upload, Instagram, ListPlus, Eye, ArrowRight, BookOpen, Lightbulb
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type UrlPreview = {
  type: "youtube" | "instagram" | "webpage";
  thumbnail: string;
  title: string;
  transcript: string;
  hasTranscript: boolean;
  videoId?: string;
  shortcode?: string;
  username?: string;
};

export default function KnowledgeBase() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [urlTitle, setUrlTitle] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [brainType, setBrainType] = useState<"friend" | "expert" | "both">("both");
  const [pdfTitle, setPdfTitle] = useState("");
  const [pdfBrainType, setPdfBrainType] = useState<"friend" | "expert" | "both">("both");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [batchUrls, setBatchUrls] = useState("");
  const [batchBrainType, setBatchBrainType] = useState<"friend" | "expert" | "both">("both");
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [pdfProgress, setPdfProgress] = useState<{ step: string; percent: number } | null>(null);

  // URL preview state
  const [urlStep, setUrlStep] = useState<"input" | "preview" | "confirm">("input");
  const [urlPreview, setUrlPreview] = useState<UrlPreview | null>(null);
  const [isFetchingPreview, setIsFetchingPreview] = useState(false);
  const [manualTranscript, setManualTranscript] = useState("");
  const [urlSourceType, setUrlSourceType] = useState<"auto" | "youtube" | "instagram" | "web">("auto");

  const { data: items } = useQuery({
    queryKey: ["kb-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("knowledge_base_items").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: chunks } = useQuery({
    queryKey: ["kb-chunks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("knowledge_chunks").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Reset URL dialog state
  const resetUrlDialog = () => {
    setUrlStep("input");
    setUrlPreview(null);
    setUrlTitle("");
    setUrlValue("");
    setIsFetchingPreview(false);
    setManualTranscript("");
    setUrlSourceType("auto");
  };

  // Fetch URL preview (thumbnail + transcript)
  const fetchPreview = async () => {
    if (!urlValue.trim()) return;
    setIsFetchingPreview(true);
    try {
      const { data, error } = await supabase.functions.invoke("preview-url", {
        body: { url: urlValue },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setUrlPreview(data);
      if (data.title && !urlTitle) setUrlTitle(data.title);
      // Always show confirm step so user can review before processing
      setUrlStep("confirm");
    } catch (e: any) {
      console.error("Preview error:", e);
      toast.error("Could not preview URL. You can still add it.");
      setUrlStep("preview");
      setUrlPreview(null);
    } finally {
      setIsFetchingPreview(false);
    }
  };

  // State for showing learnings after processing
  const [processedLearnings, setProcessedLearnings] = useState<any[] | null>(null);
  const [learningsDialogOpen, setLearningsDialogOpen] = useState(false);
  const [learningsSourceName, setLearningsSourceName] = useState("");

  // Query for all brain learnings
  const { data: allBrainLearnings } = useQuery({
    queryKey: ["brain-learnings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_brain").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const [viewAllLearningsOpen, setViewAllLearningsOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const showLearnings = (learnings: any[], sourceName: string) => {
    setProcessedLearnings(learnings);
    setLearningsSourceName(sourceName);
    setLearningsDialogOpen(true);
  };

  const runWithRetry = async <T = any,>(
    fn: () => PromiseLike<T> | T,
    retries = 2,
    delayMs = 800
  ): Promise<T> => {
    let lastError: any;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        if (attempt === retries) break;
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
    throw lastError;
  };

  const normalizeNetworkError = (error: any) => {
    const msg = error?.message || "Unknown error";
    if (/failed to fetch|networkerror|network request failed/i.test(msg)) {
      return "Network error while uploading. Please retry on a stable connection.";
    }
    return msg;
  };

  const addUrl = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("knowledge_base_items").insert({
        user_id: user!.id,
        title: urlTitle,
        type: "url",
        url: urlValue,
        brain_type: brainType,
        status: "processing",
      }).select().single();
      if (error) throw error;

      const transcript = urlPreview?.hasTranscript ? undefined : manualTranscript.trim() || undefined;

      supabase.functions.invoke("process-knowledge", {
        body: { itemId: data.id, url: urlValue, type: "url", manualTranscript: transcript },
      }).then((result) => {
        queryClient.invalidateQueries({ queryKey: ["kb-items"] });
        queryClient.invalidateQueries({ queryKey: ["kb-chunks"] });
        queryClient.invalidateQueries({ queryKey: ["brain-learnings"] });
        if (result.data?.learnings?.length > 0) {
          showLearnings(result.data.learnings, result.data.sourceName || urlTitle);
        }
      }).catch(console.error);

      return data;
    },
    onSuccess: () => {
      toast.success("URL added! Processing content in background...");
      setUrlDialogOpen(false);
      resetUrlDialog();
      queryClient.invalidateQueries({ queryKey: ["kb-items"] });
      startPolling();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addPdf = useMutation({
    mutationFn: async () => {
      if (!pdfFile) throw new Error("No file selected");

      setPdfProgress({ step: "Uploading file...", percent: 10 });
      const filePath = `${user!.id}/${Date.now()}-${pdfFile.name}`;
      const uploadResult = await runWithRetry(
        () => supabase.storage.from("knowledge-files").upload(filePath, pdfFile),
        2,
        900
      );
      if (uploadResult.error) throw uploadResult.error;

      setPdfProgress({ step: "Creating record...", percent: 25 });
      const insertResult = await runWithRetry(
        () => supabase.from("knowledge_base_items").insert({
          user_id: user!.id,
          title: pdfTitle || pdfFile.name,
          type: "pdf",
          brain_type: pdfBrainType,
          status: "processing",
          file_path: filePath,
        }).select().single(),
        1,
        600
      );
      if (insertResult.error) throw insertResult.error;
      const data = insertResult.data;

      setPdfProgress({ step: "Processing PDF in background...", percent: 50 });

      // Fire processing in background (with one retry for transient network issues)
      void runWithRetry(
        () => supabase.functions.invoke("process-knowledge", {
          body: { itemId: data.id, type: "pdf", filePath },
        }),
        1,
        1200
      ).then((result) => {
        if (result.error || result.data?.error) {
          console.error("PDF processing error:", result.data?.error || result.error?.message);
        }
        queryClient.invalidateQueries({ queryKey: ["kb-items"] });
        queryClient.invalidateQueries({ queryKey: ["kb-chunks"] });
        queryClient.invalidateQueries({ queryKey: ["brain-learnings"] });
        if (result.data?.learnings?.length > 0) {
          showLearnings(result.data.learnings, result.data.sourceName || pdfTitle || pdfFile?.name || "PDF");
        }
      }).catch((e) => {
        console.error("PDF edge function error:", e);
        queryClient.invalidateQueries({ queryKey: ["kb-items"] });
      });

      setPdfProgress({ step: "Queued for processing!", percent: 100 });
      startPolling();

      return data;
    },
    onSuccess: () => {
      toast.success("PDF uploaded and queued for processing");
      setTimeout(() => {
        setPdfDialogOpen(false);
        setPdfTitle("");
        setPdfFile(null);
        setPdfProgress(null);
      }, 1000);
      queryClient.invalidateQueries({ queryKey: ["kb-items"] });
    },
    onError: (e: any) => {
      setPdfProgress(null);
      toast.error(normalizeNetworkError(e));
    },
  });

  // Live learnings counter for processing items
  const [processingCounts, setProcessingCounts] = useState<Record<string, { learnings: number; chunks: number }>>({});

  useEffect(() => {
    const processingItems = items?.filter(i => i.status === "processing") || [];
    if (processingItems.length === 0) {
      if (Object.keys(processingCounts).length > 0) setProcessingCounts({});
      return;
    }

    const poll = async () => {
      const ids = processingItems.map(i => i.id);
      const [brainRes, chunkRes] = await Promise.all([
        supabase.from("sales_brain").select("source_id").in("source_id", ids),
        supabase.from("knowledge_chunks").select("source_id").in("source_id", ids),
      ]);
      const counts: Record<string, { learnings: number; chunks: number }> = {};
      for (const id of ids) {
        counts[id] = {
          learnings: brainRes.data?.filter(r => r.source_id === id).length || 0,
          chunks: chunkRes.data?.filter(r => r.source_id === id).length || 0,
        };
      }
      setProcessingCounts(counts);
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [items]);

  const startPolling = () => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["kb-items"] });
      queryClient.invalidateQueries({ queryKey: ["kb-chunks"] });
    }, 3000);
    setTimeout(() => clearInterval(interval), 60000);
  };

  const handleBatchImport = async () => {
    const urls = batchUrls.split("\n").map((u) => u.trim()).filter((u) => u.length > 0 && (u.startsWith("http://") || u.startsWith("https://")));
    if (urls.length === 0) { toast.error("No valid URLs found"); return; }

    setBatchProcessing(true);
    setBatchProgress({ current: 0, total: urls.length });

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const title = url.includes("youtube.com") || url.includes("youtu.be")
        ? `YouTube Video ${i + 1}`
        : url.includes("instagram.com") ? `Instagram ${i + 1}` : `URL ${i + 1}`;

      try {
        const { data, error } = await supabase.from("knowledge_base_items").insert({
          user_id: user!.id, title, type: "url", url, brain_type: batchBrainType, status: "processing",
        }).select().single();

        if (!error && data) {
          supabase.functions.invoke("process-knowledge", {
            body: { itemId: data.id, url, type: "url" },
          }).then(() => {
            queryClient.invalidateQueries({ queryKey: ["kb-items"] });
            queryClient.invalidateQueries({ queryKey: ["kb-chunks"] });
          }).catch(console.error);
        }
      } catch (e) { console.error(`Failed to add ${url}:`, e); }

      setBatchProgress({ current: i + 1, total: urls.length });
      if (i < urls.length - 1) await new Promise((r) => setTimeout(r, 500));
    }

    toast.success(`${urls.length} URLs queued for processing!`);
    setBatchDialogOpen(false);
    setBatchUrls("");
    setBatchProcessing(false);
    queryClient.invalidateQueries({ queryKey: ["kb-items"] });
    startPolling();
  };

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("knowledge_base_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item deleted");
      queryClient.invalidateQueries({ queryKey: ["kb-items"] });
      queryClient.invalidateQueries({ queryKey: ["kb-chunks"] });
    },
  });

  const retryItem = useMutation({
    mutationFn: async (item: any) => {
      // Reset status to processing
      await supabase.from("knowledge_base_items").update({ status: "processing" }).eq("id", item.id);
      
      // Re-invoke processing
      const body: any = { itemId: item.id, type: item.type };
      if (item.type === "pdf" && item.file_path) {
        body.filePath = item.file_path;
      } else if (item.url) {
        body.url = item.url;
      }

      const result = await supabase.functions.invoke("process-knowledge", { body });
      if (result.error || result.data?.error) {
        throw new Error(result.data?.error || result.error?.message || "Processing failed");
      }
      return result;
    },
    onSuccess: () => {
      toast.success("Retrying processing...");
      queryClient.invalidateQueries({ queryKey: ["kb-items"] });
      queryClient.invalidateQueries({ queryKey: ["kb-chunks"] });
      startPolling();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const getStatusIcon = (status: string) => {
    if (status === "ready") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (status === "processing") return <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />;
    return <AlertCircle className="h-4 w-4 text-destructive" />;
  };

  const getPlatformIcon = (item: any) => {
    if (item.type === "pdf") return <FileText className="h-5 w-5 text-red-600" />;
    if (!item.url) return <FileText className="h-5 w-5 text-primary" />;
    if (item.url.includes("youtube.com") || item.url.includes("youtu.be")) return <Youtube className="h-5 w-5 text-red-500" />;
    if (item.url.includes("instagram.com") || item.url.includes("instagr.am")) return <Instagram className="h-5 w-5 text-pink-500" />;
    return <Globe className="h-5 w-5 text-primary" />;
  };

  const getItemThumbnail = (item: any) => {
    if (!item.url) return null;
    if (item.url.includes("youtube.com") || item.url.includes("youtu.be")) {
      try {
        const u = new URL(item.url);
        const videoId = item.url.includes("youtu.be") ? u.pathname.slice(1) : u.searchParams.get("v");
        if (videoId) return `https://img.youtube.com/vi/${videoId}/default.jpg`;
      } catch { /* ignore */ }
    }
    return null;
  };

  const getChunksForItem = (itemId: string) => chunks?.filter(c => c.source_id === itemId) || [];
  const getLearningsForItem = (itemId: string) => allBrainLearnings?.filter(l => l.source_id === itemId) || [];
  const getPreferredInsightsForItem = (itemId: string) => {
    const itemLearnings = getLearningsForItem(itemId);
    const itemChunks = getChunksForItem(itemId);

    // Always prefer structured learnings (sales_brain) when any exist
    if (itemLearnings.length > 0) {
      return itemLearnings;
    }

    // Only fall back to raw chunks if zero structured learnings exist
    return itemChunks.map((chunk) => ({
      id: chunk.id,
      title: chunk.category?.replace(/_/g, " ") || "Insight",
      category: chunk.category || "general",
      content: chunk.content,
      trigger_phrases: chunk.trigger_phrases,
      sourceType: "chunk",
    }));
  };
  const getInsightCountForItem = (itemId: string) => getPreferredInsightsForItem(itemId).length;

  return (
    <div className="px-4 py-6 md:py-8 max-w-4xl mx-auto overflow-x-hidden">
      {/* Learnings Result Dialog */}
      <Dialog open={learningsDialogOpen} onOpenChange={setLearningsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              ✅ Brain updated!
            </DialogTitle>
            <DialogDescription>
              Here's what I learned from <strong>{learningsSourceName}</strong>:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {processedLearnings?.map((learning: any, idx: number) => {
              const isStructured = !!learning.principle_name;
              const title = isStructured
                ? learning.principle_name
                : learning.title || learning.category?.replace(/_/g, " ") || "Insight";

              return (
                <div key={learning.id || idx} className="p-4 rounded-lg border bg-card space-y-2">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="font-semibold text-sm">{isStructured ? `Principle: ${title}` : `Insight: ${title}`}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">{(learning.category || "general")?.replace(/_/g, " ")}</Badge>
                  </div>
                  <div className="pl-6 space-y-1">
                    <p className="text-sm"><span className="font-medium text-muted-foreground">{isStructured ? "What I Learned:" : "Detail:"}</span> {isStructured ? learning.what_i_learned : learning.content}</p>
                    {isStructured ? (
                      <p className="text-sm"><span className="font-medium text-muted-foreground">How to Apply:</span> {learning.how_to_apply}</p>
                    ) : learning.trigger_phrases ? (
                      <p className="text-sm"><span className="font-medium text-muted-foreground">Trigger Phrases:</span> {learning.trigger_phrases}</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLearningsDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View All Brain Learnings Dialog */}
      <Dialog open={viewAllLearningsOpen} onOpenChange={setViewAllLearningsOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              All Brain Learnings ({allBrainLearnings?.length || 0})
            </DialogTitle>
            <DialogDescription>Principles extracted from uploaded videos &amp; PDFs only (read-only vault)</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-3 py-2 pr-4">
              {allBrainLearnings && allBrainLearnings.length > 0 ? (
                allBrainLearnings.map((learning: any) => (
                  <div key={learning.id} className="p-4 rounded-lg border bg-card space-y-2">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="font-semibold text-sm">{learning.principle_name}</span>
                      <Badge variant="outline" className="text-[10px] ml-auto">{learning.category?.replace(/_/g, " ")}</Badge>
                    </div>
                    <div className="pl-6 space-y-1">
                      <p className="text-sm"><span className="font-medium text-muted-foreground">What I Learned:</span> {learning.what_i_learned}</p>
                      <p className="text-sm"><span className="font-medium text-muted-foreground">How to Apply:</span> {learning.how_to_apply}</p>
                      <p className="text-xs text-muted-foreground mt-1">Source: {learning.source_name} • {learning.brain_type} mode</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No learnings yet</p>
                  <p className="text-sm">Upload videos or PDFs to start building your sales brain</p>
                </div>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewAllLearningsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-3 sm:gap-4 mb-4 sm:mb-8">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Brain className="h-5 w-5 md:h-6 md:w-6 text-primary" />Knowledge Base
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Upload sales training content to make your AI smarter</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="text-xs sm:text-sm" onClick={() => setViewAllLearningsOpen(true)}>
            <BookOpen className="h-4 w-4 mr-1 sm:mr-2" />Brain Learnings
          </Button>
          {/* Batch Import Dialog */}
          <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><ListPlus className="h-4 w-4 mr-2" />Batch Import</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Batch Import URLs</DialogTitle>
                <DialogDescription>Paste multiple YouTube, Instagram, or web URLs (one per line)</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label>URLs (one per line) *</Label>
                  <Textarea value={batchUrls} onChange={(e) => setBatchUrls(e.target.value)}
                    placeholder={"https://youtube.com/watch?v=abc123\nhttps://instagram.com/p/xyz789"} rows={6} />
                  <p className="text-xs text-muted-foreground mt-1">
                    {batchUrls.split("\n").filter((u) => u.trim().startsWith("http")).length} valid URLs detected
                  </p>
                </div>
                <div>
                  <Label>Brain Mode</Label>
                  <Select value={batchBrainType} onValueChange={(v: "friend" | "expert" | "both") => setBatchBrainType(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="both"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4" />Both Modes</div></SelectItem>
                      <SelectItem value="friend"><div className="flex items-center gap-2"><Heart className="h-4 w-4 text-pink-500" />Friend Only</div></SelectItem>
                      <SelectItem value="expert"><div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-blue-500" />Expert Only</div></SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {batchProcessing && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Processing {batchProgress.current}/{batchProgress.total}...</p>
                    <Progress value={(batchProgress.current / batchProgress.total) * 100} />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={handleBatchImport} disabled={batchProcessing || !batchUrls.trim()}>
                  {batchProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</> : "Import All"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* PDF Upload Dialog */}
          <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Upload className="h-4 w-4 mr-2" />Upload PDF</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload PDF</DialogTitle>
                <DialogDescription>Upload a PDF document to extract sales knowledge from</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label>Title</Label>
                  <Input value={pdfTitle} onChange={(e) => setPdfTitle(e.target.value)} placeholder="e.g., Sales Playbook" />
                </div>
                <div>
                  <Label>PDF File *</Label>
                  <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (!file.name.toLowerCase().endsWith(".pdf")) {
                        toast.error("Please select a PDF file");
                        e.target.value = "";
                        return;
                      }
                      setPdfFile(file);
                      if (!pdfTitle) setPdfTitle(file.name.replace(".pdf", ""));
                    }} />
                  <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
                    {pdfFile ? (
                      <div className="flex items-center justify-center gap-2">
                        <FileText className="h-5 w-5 text-red-600" />
                        <span className="text-sm font-medium">{pdfFile.name}</span>
                        <span className="text-xs text-muted-foreground">({(pdfFile.size / 1024 / 1024).toFixed(1)}MB)</span>
                      </div>
                    ) : (
                      <div>
                        <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Click to select a PDF file</p>
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <Label>Brain Mode</Label>
                  <Select value={pdfBrainType} onValueChange={(v: "friend" | "expert" | "both") => setPdfBrainType(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="both"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4" />Both Modes</div></SelectItem>
                      <SelectItem value="friend"><div className="flex items-center gap-2"><Heart className="h-4 w-4 text-pink-500" />Friend Only</div></SelectItem>
                      <SelectItem value="expert"><div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-blue-500" />Expert Only</div></SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {pdfProgress && (
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center gap-2">
                      {pdfProgress.percent < 100 ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                      <span className="text-sm font-medium">{pdfProgress.step}</span>
                    </div>
                    <Progress value={pdfProgress.percent} className="h-2" />
                    <p className="text-xs text-muted-foreground">{pdfProgress.percent}% complete</p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => addPdf.mutate()} disabled={!pdfFile || addPdf.isPending}>
                  {addPdf.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</> : "Upload & Process"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* URL Dialog with Preview */}
          <Dialog open={urlDialogOpen} onOpenChange={(open) => { setUrlDialogOpen(open); if (!open) resetUrlDialog(); }}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add URL</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add URL Content</DialogTitle>
                <DialogDescription>Add a YouTube video, Instagram post, article, or webpage to your knowledge base</DialogDescription>
              </DialogHeader>

              {/* Step 1: Enter URL */}
              {urlStep === "input" && (
                <div className="space-y-4 py-4">
                  <div>
                    <Label>Source Type</Label>
                    <div className="flex gap-2 mt-1">
                      {[
                        { value: "auto" as const, icon: Globe, label: "Auto Detect" },
                        { value: "youtube" as const, icon: Youtube, label: "YouTube" },
                        { value: "instagram" as const, icon: Instagram, label: "Instagram" },
                      ].map((opt) => (
                        <Button
                          key={opt.value}
                          type="button"
                          variant={urlSourceType === opt.value ? "default" : "outline"}
                          size="sm"
                          onClick={() => setUrlSourceType(opt.value)}
                          className="flex-1"
                        >
                          <opt.icon className="h-4 w-4 mr-1" />
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>URL *</Label>
                    <Input value={urlValue} onChange={(e) => setUrlValue(e.target.value)}
                      placeholder={urlSourceType === "instagram" ? "https://instagram.com/p/... or https://instagram.com/reel/..." : "https://youtube.com/watch?v=..."} />
                  </div>

                  {/* Instagram: always manual transcript */}
                  {urlSourceType === "instagram" && (
                    <div className="space-y-2">
                      <Label>Title *</Label>
                      <Input value={urlTitle} onChange={(e) => setUrlTitle(e.target.value)} placeholder="e.g., Prospect Reel Caption" />
                      <Label className="flex items-center gap-2">
                        <Instagram className="h-4 w-4 text-pink-500" />
                        Paste Transcript / Caption *
                      </Label>
                      <Textarea
                        value={manualTranscript}
                        onChange={(e) => setManualTranscript(e.target.value)}
                        placeholder="Paste the Instagram reel transcript or post caption here..."
                        rows={6}
                        className="text-xs font-mono"
                      />
                      <div>
                        <Label>Brain Mode</Label>
                        <Select value={brainType} onValueChange={(v: "friend" | "expert" | "both") => setBrainType(v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="both"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4" />Both Modes</div></SelectItem>
                            <SelectItem value="friend"><div className="flex items-center gap-2"><Heart className="h-4 w-4 text-pink-500" />Friend Only</div></SelectItem>
                            <SelectItem value="expert"><div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-blue-500" />Expert Only</div></SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  <DialogFooter>
                    {urlSourceType === "instagram" ? (
                      <Button onClick={() => addUrl.mutate()} disabled={!urlValue.trim() || !urlTitle.trim() || !manualTranscript.trim() || addUrl.isPending}>
                        {addUrl.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</> : <><CheckCircle2 className="h-4 w-4 mr-2" />Add Instagram Content</>}
                      </Button>
                    ) : (
                      <Button onClick={fetchPreview} disabled={!urlValue.trim() || isFetchingPreview}>
                        {isFetchingPreview ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Fetching preview...</> : <><Eye className="h-4 w-4 mr-2" />Preview & Verify</>}
                      </Button>
                    )}
                  </DialogFooter>
                </div>
              )}

              {/* Step 2: Preview (no transcript) */}
              {urlStep === "preview" && (
                <div className="space-y-4 py-4">
                  <Button variant="ghost" size="sm" onClick={() => setUrlStep("input")}>← Back</Button>

                  {/* Thumbnail Preview */}
                  {urlPreview?.thumbnail && (
                    <div className="rounded-lg overflow-hidden border">
                      <img src={urlPreview.thumbnail} alt="Preview" className="w-full h-48 object-cover" />
                    </div>
                  )}

                  {urlPreview && (
                    <div className="flex items-center gap-2">
                      {urlPreview.type === "youtube" && <Youtube className="h-5 w-5 text-red-500 shrink-0" />}
                      {urlPreview.type === "instagram" && <Instagram className="h-5 w-5 text-pink-500 shrink-0" />}
                      {urlPreview.type === "webpage" && <Globe className="h-5 w-5 text-primary shrink-0" />}
                      <p className="text-sm font-medium">{urlPreview.title || "Untitled"}</p>
                    </div>
                  )}

                  {!urlPreview && (
                    <p className="text-sm text-muted-foreground">Could not preview this URL, but you can still add it.</p>
                  )}

                  <div>
                    <Label>Title *</Label>
                    <Input value={urlTitle} onChange={(e) => setUrlTitle(e.target.value)} placeholder="e.g., Sales Training Video" />
                  </div>
                  <div>
                    <Label>Brain Mode</Label>
                    <Select value={brainType} onValueChange={(v: "friend" | "expert" | "both") => setBrainType(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="both"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4" />Both Modes</div></SelectItem>
                        <SelectItem value="friend"><div className="flex items-center gap-2"><Heart className="h-4 w-4 text-pink-500" />Friend Only</div></SelectItem>
                        <SelectItem value="expert"><div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-blue-500" />Expert Only</div></SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => addUrl.mutate()} disabled={!urlTitle.trim() || addUrl.isPending}>
                      {addUrl.isPending ? "Adding..." : "Add to Knowledge Base"}
                    </Button>
                  </DialogFooter>
                </div>
              )}

              {/* Step 3: Confirm Transcript */}
              {urlStep === "confirm" && (
                <div className="space-y-4 py-4">
                  <Button variant="ghost" size="sm" onClick={() => setUrlStep("input")}>← Back</Button>

                  {/* Thumbnail Preview */}
                  {urlPreview?.thumbnail && (
                    <div className="rounded-lg overflow-hidden border">
                      <img src={urlPreview.thumbnail} alt="Preview" className="w-full h-32 object-cover" />
                    </div>
                  )}

                  {urlPreview && (
                    <div className="flex items-center gap-2">
                      {urlPreview.type === "youtube" && <Youtube className="h-5 w-5 text-red-500 shrink-0" />}
                      {urlPreview.type === "instagram" && <Instagram className="h-5 w-5 text-pink-500 shrink-0" />}
                      <p className="text-sm font-medium">{urlPreview.title || "Untitled"}</p>
                    </div>
                  )}

                  {/* Transcript Preview / Manual Paste */}
                  <div>
                    <Label className="flex items-center gap-2 mb-2">
                      <FileText className="h-4 w-4" />Extracted Content
                      <Badge variant="outline" className="text-xs">Review before learning</Badge>
                    </Label>
                    {urlPreview?.hasTranscript ? (
                      <ScrollArea className="h-32 rounded-md border p-3 bg-muted/30">
                        <p className="text-xs whitespace-pre-wrap font-mono">{urlPreview.transcript}</p>
                      </ScrollArea>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-amber-500 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          Could not auto-extract transcript. Paste it manually below:
                        </p>
                        <Textarea
                          value={manualTranscript}
                          onChange={(e) => setManualTranscript(e.target.value)}
                          placeholder="Paste the video/post transcript or caption here..."
                          rows={4}
                          className="text-xs font-mono"
                        />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      ✓ This is the content the AI will learn from. Confirm it looks correct.
                    </p>
                  </div>

                  <div>
                    <Label>Title *</Label>
                    <Input value={urlTitle} onChange={(e) => setUrlTitle(e.target.value)} placeholder="e.g., Sales Training Video" />
                  </div>
                  <div>
                    <Label>Brain Mode</Label>
                    <Select value={brainType} onValueChange={(v: "friend" | "expert" | "both") => setBrainType(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="both"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4" />Both Modes</div></SelectItem>
                        <SelectItem value="friend"><div className="flex items-center gap-2"><Heart className="h-4 w-4 text-pink-500" />Friend Only</div></SelectItem>
                        <SelectItem value="expert"><div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-blue-500" />Expert Only</div></SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => addUrl.mutate()} disabled={!urlTitle.trim() || addUrl.isPending || (!urlPreview?.hasTranscript && !manualTranscript.trim())}>
                      {addUrl.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</> : <><CheckCircle2 className="h-4 w-4 mr-2" />Confirm & Learn</>}
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {items?.length === 0 ? (
        <Card>
          <CardContent className="py-8 sm:py-12 text-center">
            <Brain className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-medium mb-2">Your Knowledge Base is empty</h3>
            <p className="text-muted-foreground mb-4">Add sales training content to make your AI smarter and more helpful</p>
            <div className="flex gap-2 justify-center flex-wrap">
              <Button variant="outline" size="sm" onClick={() => setPdfDialogOpen(true)}><Upload className="h-4 w-4 mr-1" />Upload PDF</Button>
              <Button variant="outline" size="sm" onClick={() => setBatchDialogOpen(true)}><ListPlus className="h-4 w-4 mr-1" />Batch Import</Button>
              <Button size="sm" onClick={() => setUrlDialogOpen(true)}><Plus className="h-4 w-4 mr-1" />Add URL</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items?.map((item) => {
            const itemChunks = getChunksForItem(item.id);
            const thumbnail = getItemThumbnail(item);
            return (
              <Card key={item.id}>
                <CardContent className="p-3 sm:py-4 sm:p-6">
                  <div className="flex items-start sm:items-center gap-2 sm:gap-4">
                    {/* Thumbnail or Icon */}
                    {thumbnail ? (
                      <img src={thumbnail} alt="" className="h-10 w-14 sm:h-12 sm:w-16 rounded object-cover shrink-0" />
                    ) : (
                      <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        {getPlatformIcon(item)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{item.title}</p>
                        {getStatusIcon(item.status)}
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-[10px] sm:text-xs">{item.type.toUpperCase()}</Badge>
                        <Badge variant="outline" className="text-[10px] sm:text-xs">{item.brain_type}</Badge>
                        {item.url && <p className="text-[10px] sm:text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-[200px] md:max-w-none">{item.url}</p>}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => deleteItem.mutate(item.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  {item.status === "processing" && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex items-center gap-2 mb-2">
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        <p className="text-xs font-medium text-muted-foreground">
                          Processing content — extracting knowledge...
                        </p>
                      </div>
                      {processingCounts[item.id] && (processingCounts[item.id].learnings > 0 || processingCounts[item.id].chunks > 0) && (
                        <div className="flex items-center gap-3 mb-2">
                          {processingCounts[item.id].learnings > 0 && (
                            <Badge variant="secondary" className="text-xs animate-pulse">
                              <Lightbulb className="h-3 w-3 mr-1" />
                              {processingCounts[item.id].learnings} learnings extracted
                            </Badge>
                          )}
                          {processingCounts[item.id].chunks > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {processingCounts[item.id].chunks} chunks
                            </Badge>
                          )}
                        </div>
                      )}
                      <Progress value={undefined} className="h-1.5 animate-pulse" />
                    </div>
                  )}
                  {item.status === "ready" && itemChunks.length > 0 && (
                    <div
                      className="mt-3 pt-3 border-t cursor-pointer hover:bg-accent/50 rounded-b-lg transition-colors -mx-3 -mb-3 sm:-mx-6 sm:-mb-4 px-3 pb-3 sm:px-6 sm:pb-4"
                      onClick={() => {
                        const itemInsights = getPreferredInsightsForItem(item.id);
                        if (itemInsights.length > 0) {
                          setSelectedItemId(item.id);
                          showLearnings(itemInsights, item.title);
                        } else {
                          toast.info("No insights found for this item yet.");
                        }
                      }}
                    >
                      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Learned {getInsightCountForItem(item.id)} insights · <span className="text-primary underline underline-offset-2">View all</span>
                      </p>
                      <div className="space-y-1">
                        {itemChunks.slice(0, 3).map((chunk) => (
                          <div key={chunk.id} className="flex items-start gap-2">
                            <Badge variant="secondary" className="text-[10px] shrink-0 mt-0.5">{chunk.category.replace(/_/g, " ")}</Badge>
                            <p className="text-xs text-muted-foreground line-clamp-1">{chunk.content}</p>
                          </div>
                        ))}
                        {itemChunks.length > 3 && (
                          <p className="text-xs text-primary font-medium">+ {itemChunks.length - 3} more insights →</p>
                        )}
                      </div>
                    </div>
                  )}
                  {item.status === "error" && (
                    <div className="mt-3 pt-3 border-t flex items-center justify-between">
                      <p className="text-xs text-destructive">Failed to process. Try again or use a different URL.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => retryItem.mutate(item)}
                        disabled={retryItem.isPending}
                        className="shrink-0 ml-2"
                      >
                        {retryItem.isPending ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3 mr-1" />
                        )}
                        Retry
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
