import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Building2, FileText, Plus, Trash2, Loader2, Save, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type CompanyProfile = {
  id?: string;
  company_name: string;
  what_selling: string;
  target_audience: string;
  pain_points: string;
  objections: string;
  business_type: string;
};

type Material = {
  id: string;
  title: string;
  content: string;
  type: string;
  format: string;
  created_at: string;
};

export default function Company() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CompanyProfile>({
    company_name: "", what_selling: "", target_audience: "",
    pain_points: "", objections: "", business_type: "general",
  });
  const [materials, setMaterials] = useState<Material[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addStep, setAddStep] = useState<"type" | "format" | "content">("type");
  const [newMaterial, setNewMaterial] = useState({ title: "", content: "", type: "script", format: "text" });
  const [savingMaterial, setSavingMaterial] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    const [profileRes, materialsRes] = await Promise.all([
      supabase.from("company_profiles").select("*").eq("user_id", user!.id).maybeSingle(),
      supabase.from("company_materials").select("*").eq("user_id", user!.id).order("created_at", { ascending: false }),
    ]);
    if (profileRes.data) {
      setProfile(profileRes.data as any);
    }
    if (materialsRes.data) {
      setMaterials(materialsRes.data as any);
    }
    setLoading(false);
  };

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const payload = { ...profile, user_id: user.id };
      delete (payload as any).id;
      const { error } = await supabase.from("company_profiles").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
      toast.success("Company profile saved!");
    } catch (e: any) {
      toast.error("Failed to save: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveMaterial = async () => {
    if (!user || !newMaterial.title.trim()) return;
    setSavingMaterial(true);
    try {
      const { error } = await supabase.from("company_materials").insert({
        user_id: user.id,
        title: newMaterial.title,
        content: newMaterial.content,
        type: newMaterial.type,
        format: newMaterial.format,
      });
      if (error) throw error;
      toast.success("Material added!");
      setShowAddModal(false);
      setNewMaterial({ title: "", content: "", type: "script", format: "text" });
      setAddStep("type");
      loadData();
    } catch (e: any) {
      toast.error("Failed to save: " + e.message);
    } finally {
      setSavingMaterial(false);
    }
  };

  const deleteMaterial = async (id: string) => {
    const { error } = await supabase.from("company_materials").delete().eq("id", id);
    if (error) toast.error("Failed to delete");
    else {
      toast.success("Deleted");
      setMaterials(prev => prev.filter(m => m.id !== id));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 md:py-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl md:text-3xl font-bold flex items-center gap-2 md:gap-3">
          My Company <span className="text-2xl">🏢</span>
        </h1>
        <p className="text-muted-foreground mt-1">
          Give your AI assistant deep knowledge about your business by uploading company materials, product information, and sales resources.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start mb-6">
          <TabsTrigger value="overview" className="flex items-center gap-1.5">
            <Building2 className="h-4 w-4" />Company Overview
          </TabsTrigger>
          <TabsTrigger value="materials" className="flex items-center gap-1.5">
            <span>📚</span>Additional Materials
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardContent className="py-6 space-y-5">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2 mb-1">💼 Sales Context & Messaging</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This information will be used by your AI assistant to provide more contextual and relevant responses during sales calls.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-semibold mb-1.5 block">Your Company Name</label>
                  <Input
                    value={profile.company_name}
                    onChange={e => setProfile(p => ({ ...p, company_name: e.target.value }))}
                    placeholder="e.g., AssistAI, TechSolutions Inc., SalesBot..."
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold mb-1.5 block">What are you selling? (in 1-2 lines)</label>
                  <Textarea
                    value={profile.what_selling}
                    onChange={e => setProfile(p => ({ ...p, what_selling: e.target.value }))}
                    placeholder="e.g., We sell AI-powered sales coaching tools..."
                    rows={2}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold mb-1.5 block">Who do you sell to?</label>
                  <Textarea
                    value={profile.target_audience}
                    onChange={e => setProfile(p => ({ ...p, target_audience: e.target.value }))}
                    placeholder="e.g., Small business owners, network marketers, sales teams..."
                    rows={2}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold mb-1.5 block">What are the biggest pain points you solve for?</label>
                  <Textarea
                    value={profile.pain_points}
                    onChange={e => setProfile(p => ({ ...p, pain_points: e.target.value }))}
                    placeholder="e.g., They struggle with cold outreach, don't know how to handle objections..."
                    rows={3}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold mb-1.5 block">What are the usual objections you hear and how do you typically overcome them?</label>
                  <Textarea
                    value={profile.objections}
                    onChange={e => setProfile(p => ({ ...p, objections: e.target.value }))}
                    placeholder="e.g., 'It's too expensive' - We reframe as investment. 'I don't have time' - We show ROI..."
                    rows={3}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold mb-1.5 block">Business Type</label>
                  <div className="flex gap-2 flex-wrap">
                    {["general", "network_marketing", "saas", "consulting", "ecommerce"].map(t => (
                      <button
                        key={t}
                        onClick={() => setProfile(p => ({ ...p, business_type: t }))}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                          profile.business_type === t
                            ? "bg-foreground text-background"
                            : "bg-muted text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <Button onClick={saveProfile} disabled={saving} className="w-full">
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save Company Profile
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="materials">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg flex items-center gap-2">📚 Additional Materials</h3>
            <Button onClick={() => { setShowAddModal(true); setAddStep("type"); }} className="bg-foreground text-background hover:bg-foreground/90">
              <Plus className="h-4 w-4 mr-1" />Add Material
            </Button>
          </div>

          {materials.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <h4 className="font-bold">No Materials Yet</h4>
                <p className="text-sm text-muted-foreground mt-1">Add company documents or scripts to get started</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {materials.map(m => (
                <Card key={m.id}>
                  <CardContent className="py-4 flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-sm truncate">{m.title}</h4>
                        <Badge variant="outline" className="text-[10px] shrink-0">{m.type}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{m.content || "PDF upload"}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(m.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="shrink-0 text-destructive" onClick={() => deleteMaterial(m.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Material Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">📝 Add New Material</DialogTitle>
          </DialogHeader>

          {addStep === "type" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">What type of material is this?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => { setNewMaterial(m => ({ ...m, type: "script" })); setAddStep("format"); }}
                  className="border rounded-xl p-6 text-center hover:border-primary transition-colors"
                >
                  <span className="text-3xl mb-2 block">📝</span>
                  <h4 className="font-bold">Script</h4>
                  <p className="text-xs text-muted-foreground mt-1">Sales scripts and talking points for AI coaching</p>
                </button>
                <button
                  onClick={() => { setNewMaterial(m => ({ ...m, type: "company_info" })); setAddStep("format"); }}
                  className="border rounded-xl p-6 text-center hover:border-primary transition-colors"
                >
                  <span className="text-3xl mb-2 block">🏢</span>
                  <h4 className="font-bold">Company Info</h4>
                  <p className="text-xs text-muted-foreground mt-1">Company documents and background information</p>
                </button>
              </div>
              <Button variant="outline" className="w-full" onClick={() => setShowAddModal(false)}>Cancel</Button>
            </div>
          )}

          {addStep === "format" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">What format is your material?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => { setNewMaterial(m => ({ ...m, format: "text" })); setAddStep("content"); }}
                  className="border rounded-xl p-6 text-center hover:border-primary transition-colors"
                >
                  <span className="text-3xl mb-2 block">✏️</span>
                  <h4 className="font-bold">Text</h4>
                  <p className="text-xs text-muted-foreground mt-1">Enter text content directly</p>
                </button>
                <button
                  onClick={() => { setNewMaterial(m => ({ ...m, format: "pdf" })); setAddStep("content"); }}
                  className="border rounded-xl p-6 text-center hover:border-primary transition-colors"
                >
                  <span className="text-3xl mb-2 block">📄</span>
                  <h4 className="font-bold">PDF Upload</h4>
                  <p className="text-xs text-muted-foreground mt-1">Upload a PDF document</p>
                </button>
              </div>
              <Button variant="outline" className="w-full" onClick={() => setAddStep("type")}>Back</Button>
            </div>
          )}

          {addStep === "content" && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold mb-1.5 block">Title</label>
                <Input
                  value={newMaterial.title}
                  onChange={e => setNewMaterial(m => ({ ...m, title: e.target.value }))}
                  placeholder="Enter a title for this material..."
                />
              </div>
              {newMaterial.format === "text" ? (
                <div>
                  <label className="text-sm font-semibold mb-1.5 block">Content</label>
                  <Textarea
                    value={newMaterial.content}
                    onChange={e => setNewMaterial(m => ({ ...m, content: e.target.value }))}
                    placeholder="Enter your text content here..."
                    rows={6}
                  />
                </div>
              ) : (
                <div className="border-2 border-dashed rounded-xl p-8 text-center">
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">Drop your PDF here or click to browse. Max size: 10MB</p>
                  <Button variant="outline" className="mt-3">Choose PDF File</Button>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setAddStep("format")}>Cancel</Button>
                <Button className="flex-1" onClick={saveMaterial} disabled={savingMaterial || !newMaterial.title.trim()}>
                  {savingMaterial ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <span className="mr-2">💾</span>}
                  Save Material
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
