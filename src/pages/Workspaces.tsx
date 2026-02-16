import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Briefcase, Heart, Check, Trash2, Loader2, Search, Link2, Pencil } from "lucide-react";
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
  const [targetAudience, setTargetAudience] = useState("");
  const [businessModel, setBusinessModel] = useState("");
  const [positioning, setPositioning] = useState("");

  // Edit state
  const [editWorkspace, setEditWorkspace] = useState<any>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editNiche, setEditNiche] = useState("");
  const [editInstagram, setEditInstagram] = useState("");
  const [editTiktok, setEditTiktok] = useState("");
  const [editStore, setEditStore] = useState("");
  const [editFramework, setEditFramework] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editBusiness, setEditBusiness] = useState("");
  const [editPositioning, setEditPositioning] = useState("");
  const [editLinkedIds, setEditLinkedIds] = useState<string[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspaces").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: workspaceLinks } = useQuery({
    queryKey: ["workspace-links"],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspace_links" as any).select("*");
      if (error) throw error;
      return data as any[];
    },
    enabled: !!user,
  });

  const friendWorkspaces = workspaces?.filter((w: any) => w.workspace_type === "friend") || [];

  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const resetForm = () => {
    setName(""); setNicheDescription(""); setInstagramUrl(""); setTiktokUrl("");
    setStoreUrl(""); setCustomFramework(""); setWorkspaceType("friend"); setLinkedFriendIds([]);
    setTargetAudience(""); setBusinessModel(""); setPositioning("");
  };

  const openEditDialog = (ws: any) => {
    setEditWorkspace(ws);
    setEditName(ws.name || "");
    setEditNiche(ws.niche_description || "");
    setEditInstagram(ws.instagram_url || "");
    setEditTiktok(ws.tiktok_url || "");
    setEditStore(ws.store_url || "");
    setEditFramework(ws.custom_framework || "");
    setEditTarget(ws.target_audience || "");
    setEditBusiness(ws.business_model || "");
    setEditPositioning(ws.positioning || "");
    // Load existing links for expert workspaces
    const linked = (workspaceLinks || [])
      .filter((l: any) => l.expert_workspace_id === ws.id)
      .map((l: any) => l.friend_workspace_id);
    setEditLinkedIds(linked);
    setEditOpen(true);
  };

  const updateWorkspace = useMutation({
    mutationFn: async () => {
      if (!editWorkspace) return;
      const { error } = await supabase.from("workspaces").update({
        name: editName,
        niche_description: editNiche,
        instagram_url: editInstagram || null,
        tiktok_url: editTiktok || null,
        store_url: editStore || null,
        custom_framework: editFramework || null,
        target_audience: editTarget || null,
        business_model: editBusiness || null,
        positioning: editPositioning || null,
      } as any).eq("id", editWorkspace.id);
      if (error) throw error;

      // Update linked friend workspaces for expert mode
      if (editWorkspace.workspace_type === "expert") {
        await supabase.from("workspace_links" as any).delete().eq("expert_workspace_id", editWorkspace.id);
        if (editLinkedIds.length > 0) {
          const links = editLinkedIds.map((fid: string) => ({
            expert_workspace_id: editWorkspace.id,
            friend_workspace_id: fid,
            user_id: user!.id,
          }));
          await supabase.from("workspace_links" as any).insert(links);
        }
      }
    },
    onSuccess: () => {
      toast.success("Workspace updated!");
      setEditOpen(false);
      setEditWorkspace(null);
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["workspace-links"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to update workspace"),
  });

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
        target_audience: targetAudience || null,
        business_model: businessModel || null,
        positioning: positioning || null,
        is_active: !workspaces?.length,
      } as any).select().single();
      if (error) throw error;

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

  const toggleEditLinkedFriend = (id: string) => {
    setEditLinkedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const canCreate = name.trim() && nicheDescription.trim();
  const canEdit = editName.trim() && editNiche.trim();

  // Shared form fields renderer
  const renderWorkspaceFields = (mode: "create" | "edit") => {
    const isExpert = mode === "create" ? workspaceType === "expert" : editWorkspace?.workspace_type === "expert";
    const vals = mode === "create"
      ? { name, niche: nicheDescription, ig: instagramUrl, tt: tiktokUrl, store: storeUrl, fw: customFramework, ta: targetAudience, bm: businessModel, pos: positioning, linked: linkedFriendIds }
      : { name: editName, niche: editNiche, ig: editInstagram, tt: editTiktok, store: editStore, fw: editFramework, ta: editTarget, bm: editBusiness, pos: editPositioning, linked: editLinkedIds };
    const setters = mode === "create"
      ? { name: setName, niche: setNicheDescription, ig: setInstagramUrl, tt: setTiktokUrl, store: setStoreUrl, fw: setCustomFramework, ta: setTargetAudience, bm: setBusinessModel, pos: setPositioning, toggleLink: toggleLinkedFriend }
      : { name: setEditName, niche: setEditNiche, ig: setEditInstagram, tt: setEditTiktok, store: setEditStore, fw: setEditFramework, ta: setEditTarget, bm: setEditBusiness, pos: setEditPositioning, toggleLink: toggleEditLinkedFriend };

    return (
      <div className="space-y-4 py-2">
        <div>
          <Label>Workspace Name *</Label>
          <Input value={vals.name} onChange={(e) => setters.name(e.target.value)} placeholder="e.g., Digital Marketing, Health & Fitness" />
        </div>

        {mode === "create" && (
          <div>
            <Label>Workspace Type *</Label>
            <Select value={workspaceType} onValueChange={(v: "friend" | "expert") => { setWorkspaceType(v); setLinkedFriendIds([]); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="friend">
                  <div className="flex items-center gap-2"><Heart className="h-4 w-4 text-pink-500" />Friend Mode</div>
                </SelectItem>
                <SelectItem value="expert">
                  <div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-blue-500" />Expert Mode</div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <Label>Niche Description *</Label>
          <Textarea value={vals.niche} onChange={(e) => setters.niche(e.target.value)} placeholder="Describe what you sell or promote..." rows={3} />
        </div>

        <div>
          <Label>Your Instagram URL</Label>
          <Input value={vals.ig} onChange={(e) => setters.ig(e.target.value)} placeholder="https://instagram.com/yourusername" />
        </div>
        <div>
          <Label>Your TikTok URL</Label>
          <Input value={vals.tt} onChange={(e) => setters.tt(e.target.value)} placeholder="https://tiktok.com/@yourusername" />
        </div>
        <div>
          <Label>Your Store/Website URL</Label>
          <Input value={vals.store} onChange={(e) => setters.store(e.target.value)} placeholder="https://yourstore.com" />
        </div>

        {isExpert && (
          <>
            <div>
              <Label>Target Audience</Label>
              <Input value={vals.ta} onChange={(e) => setters.ta(e.target.value)} placeholder="e.g., Female entrepreneurs aged 25-40" />
            </div>
            <div>
              <Label>Business Model</Label>
              <Input value={vals.bm} onChange={(e) => setters.bm(e.target.value)} placeholder="e.g., Coaching, SaaS, E-commerce" />
            </div>
            <div>
              <Label>Market Positioning</Label>
              <Input value={vals.pos} onChange={(e) => setters.pos(e.target.value)} placeholder="e.g., Premium funnel building for coaches" />
            </div>
          </>
        )}

        <div>
          <Label className="text-sm font-semibold">
            {isExpert ? "Strategy & Consultation Framework" : "Custom Conversation Framework / Reply Guide"}
          </Label>
          <p className="text-xs text-muted-foreground mb-2">
            {isExpert
              ? "Paste your strategy framework, marketing steps, funnel creation process, etc."
              : "Paste your custom reply framework here (F.R.I.E.N.D method, scripts, tone rules, etc.)"}
          </p>
          <Textarea
            value={vals.fw}
            onChange={(e) => setters.fw(e.target.value)}
            placeholder={isExpert
              ? "Example: Step 1: Website Audit... Step 2: Funnel Strategy..."
              : "Example: Always start with 'I Was You' story..."}
            rows={6}
          />
        </div>

        {isExpert && (
          <div>
            <Label className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Connect to Friend Workspace
            </Label>
            <p className="text-xs text-muted-foreground mb-2">Select friend workspaces to link. Leave empty if none.</p>
            {friendWorkspaces.length > 0 ? (
              <div className="space-y-2 border rounded-md p-3">
                {friendWorkspaces.map((fw: any) => (
                  <label key={fw.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox checked={vals.linked.includes(fw.id)} onCheckedChange={() => setters.toggleLink(fw.id)} />
                    <Heart className="h-3 w-3 text-pink-500" />
                    {fw.name}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No friend workspaces to link yet.</p>
            )}
          </div>
        )}
      </div>
    );
  };

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
            {renderWorkspaceFields("create")}
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

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" /> Edit Workspace
              {editWorkspace && (
                <Badge variant="outline" className="text-xs ml-2">
                  {editWorkspace.workspace_type === "expert" ? "Expert" : "Friend"}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {renderWorkspaceFields("edit")}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={() => updateWorkspace.mutate()} disabled={!canEdit || updateWorkspace.isPending}>
              {updateWorkspace.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    <Button variant="outline" size="sm" onClick={() => openEditDialog(workspace)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => analyzeProfile(workspace.id)} disabled={analyzingId === workspace.id}>
                      {analyzingId === workspace.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                    {!workspace.is_active && (
                      <Button variant="outline" size="sm" onClick={() => setActive.mutate(workspace.id)}>
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setDeleteConfirmId(workspace.id)}>
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
                  {workspace.target_audience && <div><p className="text-muted-foreground text-xs">Target Audience</p><p className="truncate text-sm">{workspace.target_audience}</p></div>}
                  {workspace.business_model && <div><p className="text-muted-foreground text-xs">Business Model</p><p className="truncate text-sm">{workspace.business_model}</p></div>}
                  {workspace.positioning && <div><p className="text-muted-foreground text-xs">Positioning</p><p className="truncate text-sm">{workspace.positioning}</p></div>}
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this workspace, including all its prospects, messages, and framework data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteConfirmId) {
                  deleteWorkspace.mutate(deleteConfirmId);
                  setDeleteConfirmId(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
