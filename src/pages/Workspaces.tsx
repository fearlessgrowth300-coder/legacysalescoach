import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Briefcase, Heart, Check, Trash2, Target, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function Workspaces() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [name, setName] = useState("");
  const [nicheDescription, setNicheDescription] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [defaultReplyMode, setDefaultReplyMode] = useState<"friend" | "expert">("friend");

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspaces").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const activeWorkspace = workspaces?.find((w) => w.is_active);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const createWorkspace = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("workspaces").insert({
        user_id: user!.id,
        name,
        niche_description: nicheDescription || null,
        instagram_url: instagramUrl || null,
        tiktok_url: tiktokUrl || null,
        store_url: storeUrl || null,
        default_reply_mode: defaultReplyMode,
        is_active: !workspaces?.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Workspace created!");
      setNewWorkspaceOpen(false);
      setName(""); setNicheDescription(""); setInstagramUrl(""); setTiktokUrl(""); setStoreUrl("");
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to create workspace"),
  });

  const setActive = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("workspaces").update({ is_active: false }).eq("user_id", user!.id);
      const { error } = await supabase.from("workspaces").update({ is_active: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Workspace activated!");
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to activate workspace"),
  });

  const deleteWorkspace = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workspaces").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Workspace deleted");
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete workspace"),
  });

  const analyzeProfile = async (workspaceId: string) => {
    setAnalyzingId(workspaceId);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-profile", {
        body: { workspaceId },
      });
      if (error) throw error;
      toast.success("Profile analyzed successfully!");
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to analyze profile");
    } finally {
      setAnalyzingId(null);
    }
  };

  return (
    <div className="container py-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Workspaces</h1>
          <p className="text-muted-foreground">Each workspace represents a different niche or business you're promoting</p>
        </div>
        <Dialog open={newWorkspaceOpen} onOpenChange={setNewWorkspaceOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />New Workspace</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create New Workspace</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label>Workspace Name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Digital Marketing, Health & Fitness" />
              </div>
              <div>
                <Label>Niche Description</Label>
                <Textarea value={nicheDescription} onChange={(e) => setNicheDescription(e.target.value)} placeholder="Describe what you sell or promote..." rows={3} />
              </div>
              <div>
                <Label>Your Instagram URL</Label>
                <Input value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} placeholder="https://instagram.com/yourusername" />
              </div>
              <div>
                <Label>Your TikTok URL</Label>
                <Input value={tiktokUrl} onChange={(e) => setTiktokUrl(e.target.value)} placeholder="https://tiktok.com/@yourusername" />
              </div>
              <div>
                <Label>Your Store/Website URL</Label>
                <Input value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://yourstore.com" />
              </div>
              <div>
                <Label>Default Reply Mode</Label>
                <Select value={defaultReplyMode} onValueChange={(v: "friend" | "expert") => setDefaultReplyMode(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friend"><div className="flex items-center gap-2"><Heart className="h-4 w-4 text-pink-500" />Friend Mode</div></SelectItem>
                    <SelectItem value="expert"><div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-blue-500" />Expert Mode</div></SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewWorkspaceOpen(false)}>Cancel</Button>
              <Button onClick={() => createWorkspace.mutate()} disabled={!name.trim() || createWorkspace.isPending}>Create Workspace</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {workspaces?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Briefcase className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-medium mb-2">No workspaces yet</h3>
            <p className="text-muted-foreground mb-4">Create your first workspace to start chatting with prospects</p>
            <Button onClick={() => setNewWorkspaceOpen(true)}><Plus className="h-4 w-4 mr-2" />Create Workspace</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {workspaces?.map((workspace) => (
            <Card key={workspace.id} className={workspace.is_active ? "border-primary" : ""}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle>{workspace.name}</CardTitle>
                      {workspace.is_active && <Badge variant="default" className="text-xs">Active</Badge>}
                      {workspace.default_reply_mode === "expert" ? <Briefcase className="h-4 w-4 text-blue-500" /> : <Heart className="h-4 w-4 text-pink-500" />}
                    </div>
                    <CardDescription className="mt-1">{workspace.niche_description || "No description"}</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => analyzeProfile(workspace.id)}
                      disabled={analyzingId === workspace.id}
                    >
                      {analyzingId === workspace.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                      Analyze
                    </Button>
                    {!workspace.is_active && (
                      <Button variant="outline" size="sm" onClick={() => setActive.mutate(workspace.id)}>
                        <Check className="h-4 w-4 mr-1" />Set Active
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => deleteWorkspace.mutate(workspace.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Instagram</p><p className="truncate">{workspace.instagram_url || "Not set"}</p></div>
                  <div><p className="text-muted-foreground">TikTok</p><p className="truncate">{workspace.tiktok_url || "Not set"}</p></div>
                  <div><p className="text-muted-foreground">Store</p><p className="truncate">{workspace.store_url || "Not set"}</p></div>
                  <div><p className="text-muted-foreground">Products Detected</p><p className="truncate">{workspace.products_detected || "Not analyzed"}</p></div>
                </div>
                {workspace.profile_analysis && (
                  <div className="mt-4 p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">Profile Analysis</p>
                    <p className="text-sm text-muted-foreground">{workspace.profile_analysis}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
