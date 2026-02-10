import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Brain, FileText, Plus, Trash2, Loader2, CheckCircle2, AlertCircle,
  Link as LinkIcon, Globe, Youtube, Sparkles, Heart, Briefcase, Upload, Instagram, ListPlus
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

      supabase.functions.invoke("process-knowledge", {
        body: { itemId: data.id, url: urlValue, type: "url" },
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["kb-items"] });
        queryClient.invalidateQueries({ queryKey: ["kb-chunks"] });
      }).catch(console.error);

      return data;
    },
    onSuccess: () => {
      toast.success("URL added! Processing content in background...");
      setUrlDialogOpen(false);
      setUrlTitle("");
      setUrlValue("");
      queryClient.invalidateQueries({ queryKey: ["kb-items"] });
      startPolling();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addPdf = useMutation({
    mutationFn: async () => {
      if (!pdfFile) throw new Error("No file selected");

      const filePath = `${user!.id}/${Date.now()}-${pdfFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("knowledge-files")
        .upload(filePath, pdfFile);
      if (uploadError) throw uploadError;

      const { data, error } = await supabase.from("knowledge_base_items").insert({
        user_id: user!.id,
        title: pdfTitle || pdfFile.name,
        type: "pdf",
        brain_type: pdfBrainType,
        status: "processing",
        file_path: filePath,
      }).select().single();
      if (error) throw error;

      supabase.functions.invoke("process-knowledge", {
        body: { itemId: data.id, type: "pdf", filePath },
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["kb-items"] });
        queryClient.invalidateQueries({ queryKey: ["kb-chunks"] });
      }).catch(console.error);

      return data;
    },
    onSuccess: () => {
      toast.success("PDF uploaded! Processing content...");
      setPdfDialogOpen(false);
      setPdfTitle("");
      setPdfFile(null);
      queryClient.invalidateQueries({ queryKey: ["kb-items"] });
      startPolling();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startPolling = () => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["kb-items"] });
      queryClient.invalidateQueries({ queryKey: ["kb-chunks"] });
    }, 3000);
    setTimeout(() => clearInterval(interval), 60000);
  };

  const handleBatchImport = async () => {
    const urls = batchUrls
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.length > 0 && (u.startsWith("http://") || u.startsWith("https://")));

    if (urls.length === 0) {
      toast.error("No valid URLs found");
      return;
    }

    setBatchProcessing(true);
    setBatchProgress({ current: 0, total: urls.length });

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const title = url.includes("youtube.com") || url.includes("youtu.be")
        ? `YouTube Video ${i + 1}`
        : url.includes("instagram.com")
        ? `Instagram ${i + 1}`
        : `URL ${i + 1}`;

      try {
        const { data, error } = await supabase.from("knowledge_base_items").insert({
          user_id: user!.id,
          title,
          type: "url",
          url,
          brain_type: batchBrainType,
          status: "processing",
        }).select().single();

        if (!error && data) {
          supabase.functions.invoke("process-knowledge", {
            body: { itemId: data.id, url, type: "url" },
          }).then(() => {
            queryClient.invalidateQueries({ queryKey: ["kb-items"] });
            queryClient.invalidateQueries({ queryKey: ["kb-chunks"] });
          }).catch(console.error);
        }
      } catch (e) {
        console.error(`Failed to add ${url}:`, e);
      }

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

  const getChunksForItem = (itemId: string) => chunks?.filter(c => c.source_id === itemId) || [];

  return (
    <div className="container py-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />Knowledge Base
          </h1>
          <p className="text-muted-foreground">Upload sales training content to make your AI smarter</p>
        </div>
        <div className="flex gap-2">
          {/* Batch Import Dialog */}
          <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><ListPlus className="h-4 w-4 mr-2" />Batch Import</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Batch Import URLs</DialogTitle>
                <DialogDescription>Paste multiple YouTube, Instagram, or web URLs (one per line) to process them all at once</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label>URLs (one per line) *</Label>
                  <Textarea
                    value={batchUrls}
                    onChange={(e) => setBatchUrls(e.target.value)}
                    placeholder={"https://youtube.com/watch?v=abc123\nhttps://youtube.com/watch?v=def456\nhttps://instagram.com/p/xyz789"}
                    rows={6}
                  />
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
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setPdfFile(file);
                        if (!pdfTitle) setPdfTitle(file.name.replace(".pdf", ""));
                      }
                    }}
                  />
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  >
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
              </div>
              <DialogFooter>
                <Button onClick={() => addPdf.mutate()} disabled={!pdfFile || addPdf.isPending}>
                  {addPdf.isPending ? "Uploading..." : "Upload & Process"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* URL Dialog */}
          <Dialog open={urlDialogOpen} onOpenChange={setUrlDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add URL</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add URL Content</DialogTitle>
                <DialogDescription>Add a YouTube video, Instagram post, article, or webpage to your knowledge base</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label>Title *</Label>
                  <Input value={urlTitle} onChange={(e) => setUrlTitle(e.target.value)} placeholder="e.g., Sales Training Video" />
                </div>
                <div>
                  <Label>URL *</Label>
                  <Input value={urlValue} onChange={(e) => setUrlValue(e.target.value)} placeholder="https://youtube.com/watch?v=... or https://instagram.com/p/..." />
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
              </div>
              <DialogFooter>
                <Button onClick={() => addUrl.mutate()} disabled={!urlTitle.trim() || !urlValue.trim() || addUrl.isPending}>
                  {addUrl.isPending ? "Adding..." : "Add to Knowledge Base"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {items?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Brain className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-medium mb-2">Your Knowledge Base is empty</h3>
            <p className="text-muted-foreground mb-4">Add sales training content to make your AI smarter and more helpful</p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => setPdfDialogOpen(true)}><Upload className="h-4 w-4 mr-2" />Upload PDF</Button>
              <Button variant="outline" onClick={() => setBatchDialogOpen(true)}><ListPlus className="h-4 w-4 mr-2" />Batch Import</Button>
              <Button onClick={() => setUrlDialogOpen(true)}><Plus className="h-4 w-4 mr-2" />Add URL</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items?.map((item) => {
            const itemChunks = getChunksForItem(item.id);
            return (
              <Card key={item.id}>
                <CardContent className="py-4">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      {getPlatformIcon(item)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{item.title}</p>
                        {getStatusIcon(item.status)}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">{item.type.toUpperCase()}</Badge>
                        <Badge variant="outline" className="text-xs">{item.brain_type}</Badge>
                        {item.url && <p className="text-xs text-muted-foreground truncate">{item.url}</p>}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => deleteItem.mutate(item.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  {item.status === "ready" && itemChunks.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Learned {itemChunks.length} insights:
                      </p>
                      <div className="space-y-1">
                        {itemChunks.slice(0, 5).map((chunk) => (
                          <div key={chunk.id} className="flex items-start gap-2">
                            <Badge variant="secondary" className="text-[10px] shrink-0 mt-0.5">{chunk.category.replace(/_/g, " ")}</Badge>
                            <p className="text-xs text-muted-foreground line-clamp-1">{chunk.content}</p>
                          </div>
                        ))}
                        {itemChunks.length > 5 && (
                          <p className="text-xs text-muted-foreground">+ {itemChunks.length - 5} more insights</p>
                        )}
                      </div>
                    </div>
                  )}
                  {item.status === "error" && (
                    <p className="text-xs text-destructive mt-2">Failed to process. Try again or use a different URL.</p>
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
