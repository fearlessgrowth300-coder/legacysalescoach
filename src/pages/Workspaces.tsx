import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Briefcase, Heart, Check, Trash2, Loader2, Search, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function Workspaces() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [name, setName] = useState("");
  const [workspaceType, setWorkspaceType] = useState<"friend" | "expert">("friend");
  const [nicheDescription, setNicheDescription] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [customFramework, setCustomFramework] = useState("");
  const [linkedFriendIds, setLinkedFriendIds] = useState<string[]>([]);

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspaces").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const friendWorkspaces = workspaces?.filter((w: any) => w.workspace_type === "friend") || [];

  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const resetForm = () => {
    setName(""); setNicheDescription(""); setInstagramUrl(""); setTiktokUrl("");
    setStoreUrl(""); setCustomFramework(""); setWorkspaceType("friend"); setLinkedFriendIds([]);
  };

  const createWorkspace = useMutation({
    mutationFn: async () => {
      const { data: inserted, error } = await supabase.from("workspaces").insert({
        user_id: user!.id,
        name,
        workspace_type: workspaceType,
        niche_description: nicheDescription,
        instagram_url: instagramUrl || null,
        tiktok_url: tiktokUrl || null,
        store_url: storeUrl || null,
        default_reply_mode: workspaceType,
        custom_framework: customFramework || null,
        is_active: !workspaces?.length,
      } as any).select().single();
      if (error) throw error;

      // Save linked friend workspaces for expert mode
      if (workspaceType === "expert" && linkedFriendIds.length > 0 && inserted) {
        const links = linkedFriendIds.map((fid) => ({
          expert_workspace_id: (inserted as any).id,
          friend_workspace_id: fid,
          user_id: user!.id,
        }));
        await supabase.from("workspace_links" as any).insert(links);
      }

      return inserted;
    },
    onSuccess: async (inserted) => {
      toast.success("Workspace created! Analyzing profile...");
      setNewWorkspaceOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      // Auto-analyze
      if (inserted) {
        try {
          await supabase.functions.invoke("analyze-profile", { body: { workspaceId: (inserted as any).id } });
          toast.success("Profile analyzed & framework saved!");
          queryClient.invalidateQueries({ queryKey: ["workspaces"] });
        } catch {
          toast.info("Workspace saved, but auto-analysis failed. You can analyze manually.");
        }
      }
    },
    onError: (e: any) => toast.error(e.message || "Failed to create workspace"),
  });

  const setActive = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("workspaces").update({ is_active: false }).eq("user_id", user!.id);
      const { error } = await supabase.from("workspaces").update({ is_active: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Workspace activated!"); queryClient.invalidateQueries({ queryKey: ["workspaces"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteWorkspace = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workspaces").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Workspace deleted"); queryClient.invalidateQueries({ queryKey: ["workspaces"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const analyzeProfile = async (workspaceId: string) => {
    setAnalyzingId(workspaceId);
    try {
      const { error } = await supabase.functions.invoke("analyze-profile", { body: { workspaceId } });
      if (error) throw error;
      toast.success("Profile analyzed successfully!");
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to analyze profile");
    } finally {
      setAnalyzingId(null);
    }
  };

  const toggleLinkedFriend = (id: string) => {
    setLinkedFriendIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const canCreate = name.trim() && nicheDescription.trim();

  return (
    <div className="px-4 py-6 md:py-8 max-w-4xl mx-auto overflow-x-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Workspaces</h1>
          <p className="text-sm text-muted-foreground">Each workspace = independent memory container with its own framework</p>
        </div>
        <Dialog open={newWorkspaceOpen} onOpenChange={setNewWorkspaceOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-2" />New Workspace</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create New Workspace</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Workspace Name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Digital Marketing, Health & Fitness" />
              </div>

              <div>
                <Label>Workspace Type *</Label>
                <Select value={workspaceType} onValueChange={(v: "friend" | "expert") => { setWorkspaceType(v); setLinkedFriendIds([]); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friend">
                      <div className="flex items-center gap-2"><Heart className="h-4 w-4 text-pink-500" />Friend Mode (Warm, Casual)</div>
                    </SelectItem>
                    <SelectItem value="expert">
                      <div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-blue-500" />Expert Mode (Professional)</div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {workspaceType === "friend"
                    ? "DM Closer — rapport building, warm leads, soft selling"
                    : "Authority Builder — professional strategy & closing"}
                </p>
              </div>

              <div>
                <Label>Niche Description *</Label>
                <Textarea value={nicheDescription} onChange={(e) => setNicheDescription(e.target.value)} placeholder="Describe what you sell or promote, your audience, and positioning..." rows={3} />
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

              {/* Custom Framework */}
              <div>
                <Label className="text-sm font-semibold">Custom Conversation Framework / Reply Guide</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Paste your custom reply framework here (F.R.I.E.N.D method, scripts, closing strategy, tone rules, etc.)
                </p>
                <Textarea
                  value={customFramework}
                  onChange={(e) => setCustomFramework(e.target.value)}
                  placeholder="Example: Always start with 'I Was You' story... Use these 5 scripts for price objections... Tone must be big-sister energy..."
                  rows={6}
                />
              </div>

              {/* Expert mode: link to friend workspaces */}
              {workspaceType === "expert" && friendWorkspaces.length > 0 && (
                <div>
                  <Label className="flex items-center gap-2">
                    <Link2 className="h-4 w-4" /> Link to Friend Workspaces
                  </Label>
                  <p className="text-xs text-muted-foreground mb-2">Select friend workspaces whose frameworks this expert workspace can access</p>
                  <div className="space-y-2 border rounded-md p-3">
                    {friendWorkspaces.map((fw: any) => (
                      <label key={fw.id} className="flex items-center gap-2 cursor-pointer text-sm">
                        <Checkbox checked={linkedFriendIds.includes(fw.id)} onCheckedChange={() => toggleLinkedFriend(fw.id)} />
                        <Heart className="h-3 w-3 text-pink-500" />
                        {fw.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {workspaceType === "expert" && friendWorkspaces.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No friend workspaces to link yet. Create a friend workspace first.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setNewWorkspaceOpen(false); resetForm(); }}>Cancel</Button>
              <Button onClick={() => createWorkspace.mutate()} disabled={!canCreate || createWorkspace.isPending}>
                {createWorkspace.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                Analyze & Save
              </Button>
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
          {workspaces?.map((workspace: any) => (
            <Card key={workspace.id} className={workspace.is_active ? "border-primary" : ""}>
              <CardHeader className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-base sm:text-lg truncate">{workspace.name}</CardTitle>
                      {workspace.is_active && <Badge variant="default" className="text-xs">Active</Badge>}
                      <Badge variant="outline" className="text-xs">
                        {workspace.workspace_type === "expert" ? <><Briefcase className="h-3 w-3 mr-1 text-blue-500" />Expert</> : <><Heart className="h-3 w-3 mr-1 text-pink-500" />Friend</>}
                      </Badge>
                    </div>
                    <CardDescription className="mt-1 text-xs sm:text-sm line-clamp-2">{workspace.niche_description || "No description"}</CardDescription>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => analyzeProfile(workspace.id)} disabled={analyzingId === workspace.id}>
                      {analyzingId === workspace.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                    {!workspace.is_active && (
                      <Button variant="outline" size="sm" onClick={() => setActive.mutate(workspace.id)}>
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => deleteWorkspace.mutate(workspace.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div><p className="text-muted-foreground text-xs">Instagram</p><p className="truncate text-sm">{workspace.instagram_url || "Not set"}</p></div>
                  <div><p className="text-muted-foreground text-xs">TikTok</p><p className="truncate text-sm">{workspace.tiktok_url || "Not set"}</p></div>
                  <div><p className="text-muted-foreground text-xs">Store</p><p className="truncate text-sm">{workspace.store_url || "Not set"}</p></div>
                  <div><p className="text-muted-foreground text-xs">Products</p><p className="truncate text-sm">{workspace.products_detected || "Not analyzed"}</p></div>
                </div>
                {workspace.custom_framework && (
                  <div className="mt-3 p-3 bg-muted rounded-lg">
                    <p className="text-xs font-medium mb-1">Custom Framework</p>
                    <p className="text-xs text-muted-foreground line-clamp-3">{workspace.custom_framework}</p>
                  </div>
                )}
                {workspace.profile_analysis && (
                  <div className="mt-3 p-3 bg-muted rounded-lg">
                    <p className="text-xs font-medium mb-1">Profile Analysis</p>
                    <p className="text-xs text-muted-foreground">{workspace.profile_analysis}</p>
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
