import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Brain, FileText, Plus, Trash2, Loader2, CheckCircle2, Clock, AlertCircle,
  Link as LinkIcon, Globe, Youtube, Sparkles, Heart, Briefcase
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function KnowledgeBase() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [urlTitle, setUrlTitle] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [brainType, setBrainType] = useState<"friend" | "expert" | "both">("both");

  const { data: items } = useQuery({
    queryKey: ["kb-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("knowledge_base_items").select("*").order("created_at", { ascending: false });
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

      // Trigger processing via edge function
      await supabase.functions.invoke("process-knowledge", {
        body: { itemId: data.id, url: urlValue, type: "url" },
      });
      return data;
    },
    onSuccess: () => {
      toast.success("URL added! Processing content...");
      setUrlDialogOpen(false);
      setUrlTitle("");
      setUrlValue("");
      queryClient.invalidateQueries({ queryKey: ["kb-items"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("knowledge_base_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item deleted");
      queryClient.invalidateQueries({ queryKey: ["kb-items"] });
    },
  });

  const getStatusIcon = (status: string) => {
    if (status === "ready") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (status === "processing") return <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />;
    return <AlertCircle className="h-4 w-4 text-destructive" />;
  };

  const detectPlatform = (url: string) => {
    if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
    if (url.includes("instagram.com")) return "instagram";
    if (url.includes("tiktok.com")) return "tiktok";
    return "web";
  };

  const getPlatformIcon = (url: string | null) => {
    if (!url) return <FileText className="h-5 w-5 text-primary" />;
    const platform = detectPlatform(url);
    if (platform === "youtube") return <Youtube className="h-5 w-5 text-red-500" />;
    return <Globe className="h-5 w-5 text-primary" />;
  };

  return (
    <div className="container py-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />Knowledge Base
          </h1>
          <p className="text-muted-foreground">Upload sales training content to make your AI smarter</p>
        </div>
        <Dialog open={urlDialogOpen} onOpenChange={setUrlDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Add URL</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add URL Content</DialogTitle>
              <DialogDescription>Add a YouTube video, article, or webpage to your knowledge base</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label>Title *</Label>
                <Input value={urlTitle} onChange={(e) => setUrlTitle(e.target.value)} placeholder="e.g., Sales Training Video" />
              </div>
              <div>
                <Label>URL *</Label>
                <Input value={urlValue} onChange={(e) => setUrlValue(e.target.value)} placeholder="https://youtube.com/watch?v=..." />
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

      {items?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Brain className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-medium mb-2">Your Knowledge Base is empty</h3>
            <p className="text-muted-foreground mb-4">Add sales training content to make your AI smarter and more helpful</p>
            <Button onClick={() => setUrlDialogOpen(true)}><Plus className="h-4 w-4 mr-2" />Add Your First Content</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items?.map((item) => (
            <Card key={item.id}>
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    {getPlatformIcon(item.url)}
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
