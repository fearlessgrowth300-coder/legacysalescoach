import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fetchInstagramProfile } from "@/lib/fetch-instagram";
import { friendDraftPayload, objectValue, storyLines } from "@/lib/friend-workspace";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, FileCheck2, Loader2, ScanSearch, ShieldCheck, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

type Props = {
  workspace: any;
  userId: string;
  onChanged?: () => void;
};

const cleanPathPart = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

const friendSetupErrorMessage = (error: any) => {
  const message = error?.message || String(error || "Friend setup failed");
  if (/schema cache|friend_persona_status|friend_setup_mode|workspace_proof_assets|workspace-proof/i.test(message)) {
    return "Friend Setup needs its Lovable Cloud database upgrade. Apply the included Friend Persona migration, reload the schema, then try again.";
  }
  return message;
};

export default function FriendWorkspaceSetup({ workspace, userId, onChanged }: Props) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const hydratedWorkspaceRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"custom" | "auto">((workspace.friend_setup_mode as any) || "custom");
  const [personaName, setPersonaName] = useState("");
  const [personaRole, setPersonaRole] = useState("");
  const [voiceNotes, setVoiceNotes] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [audience, setAudience] = useState("");
  const [painPoints, setPainPoints] = useState("");
  const [objections, setObjections] = useState("");
  const [backstory, setBackstory] = useState("");
  const [transformation, setTransformation] = useState("");
  const [stories, setStories] = useState("");
  const [expert, setExpert] = useState("");
  const [referralTriggers, setReferralTriggers] = useState("");
  const [offerName, setOfferName] = useState("");
  const [offerDescription, setOfferDescription] = useState("");
  const [personalExperience, setPersonalExperience] = useState("");
  const [offerPrice, setOfferPrice] = useState("");
  const [offerFor, setOfferFor] = useState("");
  const [offerNotFor, setOfferNotFor] = useState("");
  const [referralUrl, setReferralUrl] = useState("");
  const [forbiddenClaims, setForbiddenClaims] = useState("");
  const [learningMode, setLearningMode] = useState<"review" | "positive_outcomes">("review");
  const [draft, setDraft] = useState<Record<string, any>>(objectValue(workspace.auto_profile_draft));

  const [proofTitle, setProofTitle] = useState("");
  const [proofType, setProofType] = useState("sales");
  const [proofValue, setProofValue] = useState("");
  const [proofDate, setProofDate] = useState("");
  const [proofDescription, setProofDescription] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) {
      hydratedWorkspaceRef.current = null;
      return;
    }
    // A workspace query refresh creates a new `workspace` object. Do not let
    // that background refresh overwrite a draft that was just returned by the
    // analyzer while this dialog is still open.
    if (hydratedWorkspaceRef.current === workspace.id) return;
    hydratedWorkspaceRef.current = workspace.id;
    const persona = objectValue(workspace.friend_persona);
    const offer = objectValue(workspace.offer_truth);
    setTab((workspace.friend_setup_mode as any) || "custom");
    setPersonaName(persona.display_name || workspace.name || "");
    setPersonaRole(persona.role || "");
    setVoiceNotes(persona.voice_notes || "");
    setInstagramUrl(workspace.instagram_url || "");
    setTiktokUrl(workspace.tiktok_url || "");
    setAudience(workspace.audience_description || "");
    setPainPoints(workspace.pain_points || "");
    setObjections(workspace.common_objections || "");
    setBackstory(workspace.friend_backstory || "");
    setTransformation(workspace.transformation || "");
    setStories(Array.isArray(workspace.approved_stories) ? workspace.approved_stories.join("\n---\n") : "");
    setExpert(workspace.expert_description || "");
    setReferralTriggers(workspace.referral_triggers || "");
    setOfferName(offer.name || "");
    setOfferDescription(offer.description || "");
    setPersonalExperience(offer.personal_experience || "");
    setOfferPrice(offer.price || "");
    setOfferFor(offer.who_it_is_for || "");
    setOfferNotFor(offer.who_it_is_not_for || "");
    setReferralUrl(offer.referral_url || workspace.store_url || "");
    setForbiddenClaims(workspace.forbidden_claims || "");
    setLearningMode(workspace.friend_learning_mode === "positive_outcomes" ? "positive_outcomes" : "review");
    setDraft(objectValue(workspace.auto_profile_draft));
  }, [open, workspace]);

  const { data: proofAssets = [], error: proofAssetsError } = useQuery({
    queryKey: ["workspace-proof-assets", workspace.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_proof_assets")
        .select("*")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: open,
    retry: false,
  });

  const approvedProofCount = useMemo(() => proofAssets.filter((asset: any) => asset.approved_for_ai).length, [proofAssets]);

  const syncApprovedPersona = async () => {
    const { data, error } = await supabase.functions.invoke("analyze-profile", {
      body: { workspaceId: workspace.id, syncApproved: true },
    });
    if (error || data?.error) throw new Error(data?.error || error?.message || "Could not sync approved persona");
  };

  const saveCustom = useMutation({
    mutationFn: async () => {
      const payload = {
        friend_setup_mode: "custom",
        friend_persona_status: "approved",
        friend_persona: { display_name: personaName.trim(), role: personaRole.trim(), voice_notes: voiceNotes.trim() },
        instagram_url: instagramUrl.trim() || null,
        tiktok_url: tiktokUrl.trim() || null,
        audience_description: audience.trim() || null,
        pain_points: painPoints.trim() || null,
        common_objections: objections.trim() || null,
        friend_backstory: backstory.trim() || null,
        transformation: transformation.trim() || null,
        approved_stories: storyLines(stories),
        expert_description: expert.trim() || null,
        referral_triggers: referralTriggers.trim() || null,
        offer_truth: {
          name: offerName.trim(),
          description: offerDescription.trim(),
          personal_experience: personalExperience.trim(),
          price: offerPrice.trim(),
          who_it_is_for: offerFor.trim(),
          who_it_is_not_for: offerNotFor.trim(),
          referral_url: referralUrl.trim(),
        },
        store_url: referralUrl.trim() || workspace.store_url || null,
        forbidden_claims: forbiddenClaims.trim() || null,
        friend_learning_mode: learningMode,
        friend_persona_approved_at: new Date().toISOString(),
        friend_persona_version: Number(workspace.friend_persona_version || 1) + 1,
      };
      const { error } = await supabase.from("workspaces").update(payload as any).eq("id", workspace.id).eq("user_id", userId);
      if (error) throw error;
      try {
        await syncApprovedPersona();
        return { syncWarning: false };
      } catch (error) {
        console.warn("Approved Friend persona saved but search sync failed", error);
        return { syncWarning: true };
      }
    },
    onSuccess: (result) => {
      toast.success("Friend identity, offer and referral rules approved.");
      if (result?.syncWarning) toast.warning("The setup is saved, but its search index still needs to be refreshed.");
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      onChanged?.();
      setOpen(false);
    },
    onError: (error: any) => toast.error(friendSetupErrorMessage(error)),
  });

  const analyzeAutomatic = useMutation({
    mutationFn: async () => {
      if (!instagramUrl.trim() && !tiktokUrl.trim()) throw new Error("Add an Instagram or TikTok profile first.");
      const snapshots: string[] = [];
      if (instagramUrl.trim()) {
        const instagram = await fetchInstagramProfile(instagramUrl.trim());
        snapshots.push(`INSTAGRAM PROFILE\n${instagram.summary || JSON.stringify(instagram).slice(0, 12000)}`);
      }
      if (tiktokUrl.trim()) {
        const { data, error } = await supabase.functions.invoke("fetch-tiktok", {
          body: { url: tiktokUrl.trim() },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || "TikTok analysis failed");
        snapshots.push(`TIKTOK PROFILE\n${data.summary || JSON.stringify(data).slice(0, 12000)}`);
      }
      const { error: linkError } = await supabase.from("workspaces").update({
        instagram_url: instagramUrl.trim() || null,
        tiktok_url: tiktokUrl.trim() || null,
        friend_setup_mode: "auto",
        friend_persona_status: "draft",
      } as any).eq("id", workspace.id).eq("user_id", userId);
      if (linkError) throw new Error(friendSetupErrorMessage(linkError));

      const { data, error } = await supabase.functions.invoke("analyze-profile", {
        body: { workspaceId: workspace.id, profileSnapshot: snapshots.join("\n\n"), draftOnly: true },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Automatic profile analysis failed");
      let nextDraft = objectValue(data?.draft || data?.persona);

      // The Edge Function persists the draft before responding. Verify that
      // persisted value when a proxy/provider returns a success envelope
      // without the nested draft payload.
      if (Object.keys(nextDraft).length === 0) {
        const { data: savedWorkspace, error: savedDraftError } = await supabase
          .from("workspaces")
          .select("auto_profile_draft")
          .eq("id", workspace.id)
          .eq("user_id", userId)
          .single();
        if (savedDraftError) throw savedDraftError;
        nextDraft = objectValue((savedWorkspace as any)?.auto_profile_draft);
      }

      if (Object.keys(nextDraft).length === 0) {
        throw new Error("Profile analysis finished, but no review draft was returned. Please analyze the profile again.");
      }
      return nextDraft;
    },
    onSuccess: (result) => {
      setDraft(result);
      queryClient.setQueryData<any[]>(["workspaces"], (current) => current?.map((item) => (
        item.id === workspace.id
          ? { ...item, auto_profile_draft: result, friend_setup_mode: "auto", friend_persona_status: "draft" }
          : item
      )));
      toast.success("Automatic profile draft is ready. Review it before approval.");
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (error: any) => toast.error(friendSetupErrorMessage(error)),
  });

  const approveAutomatic = useMutation({
    mutationFn: async () => {
      if (Object.keys(draft).length === 0) throw new Error("Analyze the profile before approving it.");
      const payload = {
        ...friendDraftPayload(draft),
        instagram_url: instagramUrl.trim() || null,
        tiktok_url: tiktokUrl.trim() || null,
        friend_learning_mode: learningMode,
        friend_persona_version: Number(workspace.friend_persona_version || 1) + 1,
      };
      const { error } = await supabase.from("workspaces").update(payload as any).eq("id", workspace.id).eq("user_id", userId);
      if (error) throw error;
      try {
        await syncApprovedPersona();
        return { syncWarning: false };
      } catch (error) {
        console.warn("Automatic Friend persona approved but search sync failed", error);
        return { syncWarning: true };
      }
    },
    onSuccess: (result) => {
      toast.success("Automatic Friend persona approved and activated.");
      if (result?.syncWarning) toast.warning("The persona is active, but its search index still needs to be refreshed.");
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      onChanged?.();
      setOpen(false);
    },
    onError: (error: any) => toast.error(friendSetupErrorMessage(error)),
  });

  const addProof = useMutation({
    mutationFn: async () => {
      if (!proofTitle.trim()) throw new Error("Give this result a clear title.");
      let storagePath: string | null = null;
      if (proofFile) {
        const extension = proofFile.name.includes(".") ? proofFile.name.split(".").pop() : "file";
        storagePath = `${userId}/${workspace.id}/${crypto.randomUUID()}-${cleanPathPart(proofTitle)}.${cleanPathPart(extension || "file")}`;
        const { error: uploadError } = await supabase.storage.from("workspace-proof").upload(storagePath, proofFile, {
          contentType: proofFile.type || undefined,
          upsert: false,
        });
        if (uploadError) throw uploadError;
      }
      const { error } = await supabase.from("workspace_proof_assets").insert({
        user_id: userId,
        workspace_id: workspace.id,
        title: proofTitle.trim(),
        result_type: proofType,
        result_value: proofValue.trim() || null,
        result_date: proofDate || null,
        description: proofDescription.trim() || null,
        storage_path: storagePath,
        mime_type: proofFile?.type || null,
        approved_for_ai: false,
      });
      if (error) {
        if (storagePath) await supabase.storage.from("workspace-proof").remove([storagePath]);
        throw error;
      }
    },
    onSuccess: () => {
      setProofTitle(""); setProofValue(""); setProofDate(""); setProofDescription(""); setProofFile(null);
      if (fileRef.current) fileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["workspace-proof-assets", workspace.id] });
      toast.success("Result added. Approve it when the facts are correct.");
    },
    onError: (error: any) => toast.error(friendSetupErrorMessage(error)),
  });

  const toggleProof = async (asset: any, approved: boolean) => {
    const { error } = await supabase.from("workspace_proof_assets").update({ approved_for_ai: approved }).eq("id", asset.id);
    if (error) return toast.error(error.message);
    queryClient.invalidateQueries({ queryKey: ["workspace-proof-assets", workspace.id] });
    toast.success(approved ? "This verified result may now be referenced." : "The AI will no longer reference this result.");
  };

  const deleteProof = async (asset: any) => {
    if (asset.storage_path) await supabase.storage.from("workspace-proof").remove([asset.storage_path]);
    const { error } = await supabase.from("workspace_proof_assets").delete().eq("id", asset.id);
    if (error) return toast.error(error.message);
    queryClient.invalidateQueries({ queryKey: ["workspace-proof-assets", workspace.id] });
  };

  const draftPersona = objectValue(draft.friend_persona || draft.persona);
  const draftOffer = objectValue(draft.offer_truth);
  const loadDraftIntoCustom = () => {
    const payload = friendDraftPayload(draft);
    const persona = objectValue(payload.friend_persona);
    const offer = objectValue(payload.offer_truth);
    setPersonaName(persona.display_name || "");
    setPersonaRole(persona.role || "");
    setVoiceNotes(persona.voice_notes || "");
    setAudience(payload.audience_description || "");
    setPainPoints(payload.pain_points || "");
    setObjections(payload.common_objections || "");
    setBackstory(payload.friend_backstory || "");
    setTransformation(payload.transformation || "");
    setStories(Array.isArray(payload.approved_stories) ? payload.approved_stories.join("\n---\n") : "");
    setExpert(payload.expert_description || "");
    setReferralTriggers(payload.referral_triggers || "");
    setOfferName(offer.name || "");
    setOfferDescription(offer.description || "");
    setPersonalExperience(offer.personal_experience || "");
    setOfferPrice(offer.price || "");
    setOfferFor(offer.who_it_is_for || "");
    setOfferNotFor(offer.who_it_is_not_for || "");
    setReferralUrl(offer.referral_url || "");
    setForbiddenClaims(payload.forbidden_claims || "");
    setTab("custom");
    toast.info("Draft loaded into Custom setup. Edit every detail, then approve it there.");
  };

  const proofEvidenceSection = (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><FileCheck2 className="h-4 w-4" /> Verified sales and result evidence</h3>
          <p className="text-xs text-muted-foreground">Upload sales screenshots or PDFs here. Uploads stay private, and the AI may reference only results you explicitly approve.</p>
        </div>
        <Badge variant="secondary">{approvedProofCount} approved</Badge>
      </div>
      {proofAssetsError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {friendSetupErrorMessage(proofAssetsError)}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>Result title</Label><Input value={proofTitle} onChange={(e) => setProofTitle(e.target.value)} placeholder="First 10 sales" /></div>
        <div><Label>Type</Label><Select value={proofType} onValueChange={setProofType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sales">Sales</SelectItem><SelectItem value="income">Income</SelectItem><SelectItem value="client_result">Client result</SelectItem><SelectItem value="milestone">Milestone</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>Exact factual value</Label><Input value={proofValue} onChange={(e) => setProofValue(e.target.value)} placeholder="$1,250 or 10 sales" /></div>
        <div><Label>Date</Label><Input type="date" value={proofDate} onChange={(e) => setProofDate(e.target.value)} /></div>
      </div>
      <div><Label>Context and limitations</Label><Textarea value={proofDescription} onChange={(e) => setProofDescription(e.target.value)} rows={2} placeholder="What produced this result, whose result it is, and any important context" /></div>
      <div><Label>Sales screenshot or PDF proof</Label><Input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setProofFile(e.target.files?.[0] || null)} /></div>
      <Button type="button" variant="outline" onClick={() => addProof.mutate()} disabled={addProof.isPending || Boolean(proofAssetsError)}><Upload className="h-4 w-4 mr-2" />Add verified result</Button>
      <div className="space-y-2">
        {proofAssets.map((asset: any) => (
          <div key={asset.id} className="flex items-start gap-3 rounded-md bg-muted/60 p-3">
            <Checkbox checked={asset.approved_for_ai} onCheckedChange={(checked) => toggleProof(asset, checked === true)} className="mt-0.5" />
            <div className="flex-1 min-w-0"><p className="text-sm font-medium">{asset.title}{asset.result_value ? ` · ${asset.result_value}` : ""}</p><p className="text-xs text-muted-foreground line-clamp-2">{asset.description || "No context added"}</p><p className="text-[11px] mt-1">{asset.approved_for_ai ? "Approved factual result" : "Not available to AI"}</p></div>
            <Button variant="ghost" size="icon" onClick={() => deleteProof(asset)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Sparkles className="h-4 w-4" /> Friend Setup
          {workspace.friend_persona_status === "approved" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Friend Persona & Referral Engine</DialogTitle>
          <DialogDescription>Define the real identity, result evidence, offer and expert this AI may use in conversations.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as "custom" | "auto")}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="custom">Custom setup</TabsTrigger>
            <TabsTrigger value="auto">Automatic profile setup</TabsTrigger>
          </TabsList>

          <TabsContent value="custom" className="space-y-6 mt-5">
            <section className="space-y-3 rounded-lg border p-4">
              <div><h3 className="font-semibold">Friend identity</h3><p className="text-xs text-muted-foreground">Who the AI is allowed to represent and how it should sound.</p></div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><Label>Persona name</Label><Input value={personaName} onChange={(e) => setPersonaName(e.target.value)} placeholder="e.g. Digital Mom Friend" /></div>
                <div><Label>Role and positioning</Label><Input value={personaRole} onChange={(e) => setPersonaRole(e.target.value)} placeholder="Peer who used the course and refers friends" /></div>
              </div>
              <div><Label>Voice and personality</Label><Textarea value={voiceNotes} onChange={(e) => setVoiceNotes(e.target.value)} rows={3} placeholder="Calm, curious, short messages, never pushy…" /></div>
              <div className="grid sm:grid-cols-2 gap-3"><div><Label>Instagram</Label><Input value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} /></div><div><Label>TikTok</Label><Input value={tiktokUrl} onChange={(e) => setTiktokUrl(e.target.value)} /></div></div>
            </section>

            <section className="space-y-3 rounded-lg border p-4">
              <div><h3 className="font-semibold">Audience intelligence</h3><p className="text-xs text-muted-foreground">The people this Friend understands and the problems it can recognize.</p></div>
              <div><Label>Audience</Label><Textarea value={audience} onChange={(e) => setAudience(e.target.value)} rows={3} /></div>
              <div className="grid sm:grid-cols-2 gap-3"><div><Label>Pains and gaps</Label><Textarea value={painPoints} onChange={(e) => setPainPoints(e.target.value)} rows={5} placeholder="One per line" /></div><div><Label>Common objections</Label><Textarea value={objections} onChange={(e) => setObjections(e.target.value)} rows={5} placeholder="One per line" /></div></div>
            </section>

            <section className="space-y-3 rounded-lg border p-4">
              <div><h3 className="font-semibold">Real story library</h3><p className="text-xs text-muted-foreground">Only add experiences that really happened. Separate multiple approved stories with a line containing ---.</p></div>
              <div><Label>Backstory</Label><Textarea value={backstory} onChange={(e) => setBackstory(e.target.value)} rows={4} /></div>
              <div><Label>Transformation</Label><Textarea value={transformation} onChange={(e) => setTransformation(e.target.value)} rows={3} /></div>
              <div><Label>Approved stories</Label><Textarea value={stories} onChange={(e) => setStories(e.target.value)} rows={6} placeholder={'My first true story…\n---\nAnother true story…'} /></div>
            </section>

            <section className="space-y-3 rounded-lg border p-4">
              <div><h3 className="font-semibold">Offer truth</h3><p className="text-xs text-muted-foreground">What the Friend genuinely used and may recommend. Empty facts must never be invented.</p></div>
              <div className="grid sm:grid-cols-2 gap-3"><div><Label>Course/product</Label><Input value={offerName} onChange={(e) => setOfferName(e.target.value)} /></div><div><Label>Exact price, if public</Label><Input value={offerPrice} onChange={(e) => setOfferPrice(e.target.value)} placeholder="Leave blank if unknown" /></div></div>
              <div><Label>What the offer does</Label><Textarea value={offerDescription} onChange={(e) => setOfferDescription(e.target.value)} rows={3} /></div>
              <div><Label>Your genuine experience using it</Label><Textarea value={personalExperience} onChange={(e) => setPersonalExperience(e.target.value)} rows={3} /></div>
              <div className="grid sm:grid-cols-2 gap-3"><div><Label>Who it is for</Label><Textarea value={offerFor} onChange={(e) => setOfferFor(e.target.value)} rows={3} /></div><div><Label>Who it is not for</Label><Textarea value={offerNotFor} onChange={(e) => setOfferNotFor(e.target.value)} rows={3} /></div></div>
              <div><Label>Website/referral link</Label><Input value={referralUrl} onChange={(e) => setReferralUrl(e.target.value)} placeholder="https://…" /></div>
            </section>

            <section className="space-y-3 rounded-lg border p-4">
              <div><h3 className="font-semibold">Expert handoff</h3><p className="text-xs text-muted-foreground">Who receives the referral and the exact signals that make a handoff appropriate.</p></div>
              <div><Label>Expert or team</Label><Textarea value={expert} onChange={(e) => setExpert(e.target.value)} rows={4} /></div>
              <div><Label>Referral-ready signals</Label><Textarea value={referralTriggers} onChange={(e) => setReferralTriggers(e.target.value)} rows={4} placeholder="One signal per line" /></div>
              <div><Label>Forbidden or unverified claims</Label><Textarea value={forbiddenClaims} onChange={(e) => setForbiddenClaims(e.target.value)} rows={3} placeholder="Income promises, guaranteed timelines, claims the AI must never make…" /></div>
            </section>

            {proofEvidenceSection}

            <section className="space-y-2 rounded-lg border p-4"><Label>Learning behavior</Label><Select value={learningMode} onValueChange={(value: any) => setLearningMode(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="review">Review personality improvements before applying</SelectItem><SelectItem value="positive_outcomes">Auto-learn patterns only from positive outcomes</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">Individual prospect memories stay separate. One conversation cannot overwrite the workspace identity.</p></section>

            <DialogFooter><Button onClick={() => saveCustom.mutate()} disabled={saveCustom.isPending}>{saveCustom.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}Save & approve Friend setup</Button></DialogFooter>
          </TabsContent>

          <TabsContent value="auto" className="space-y-5 mt-5">
            <div className="rounded-lg border p-4 space-y-3"><div><h3 className="font-semibold">Analyze the account owner</h3><p className="text-xs text-muted-foreground">The app reads profile details and recent content to propose a personality and audience model. Nothing becomes active until approval.</p></div><div><Label>Instagram profile</Label><Input value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} placeholder="https://instagram.com/username" /></div><div><Label>TikTok profile</Label><Input value={tiktokUrl} onChange={(e) => setTiktokUrl(e.target.value)} placeholder="https://tiktok.com/@username" /></div><Button onClick={() => analyzeAutomatic.mutate()} disabled={analyzeAutomatic.isPending}>{analyzeAutomatic.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ScanSearch className="h-4 w-4 mr-2" />}Analyze bio, posts and style</Button></div>

            {Object.keys(draft).length > 0 ? <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Review automatic draft</h3><p className="text-xs text-muted-foreground">Check every fact before it becomes available in live conversations.</p></div><Badge variant="outline" className="border-amber-500/50">Draft</Badge></div><div className="grid sm:grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-muted-foreground">Persona</p><p>{draftPersona.display_name || draftPersona.workspace_name || "Not inferred"}</p></div><div><p className="text-xs text-muted-foreground">Voice</p><p>{draftPersona.voice_notes || draftPersona.tone || "Not inferred"}</p></div><div><p className="text-xs text-muted-foreground">Audience</p><p>{String(draft.audience_description || draftPersona.audience || "Not inferred")}</p></div><div><p className="text-xs text-muted-foreground">Offer</p><p>{draftOffer.name || "Not safely detected"}</p></div></div><div><p className="text-xs text-muted-foreground">Profile evidence</p><p className="text-sm line-clamp-5">{String(draft.profile_evidence || draft.profile_analysis || "No summary")}</p></div><details className="rounded-md bg-background/70 p-3"><summary className="text-sm font-medium cursor-pointer">Review every inferred field</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{JSON.stringify(draft, null, 2)}</pre></details><div className="rounded-md bg-background/70 p-3 text-xs"><strong>Safety:</strong> inferred income, personal results and purchases are excluded unless you add and approve them as factual evidence.</div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={loadDraftIntoCustom}>Edit draft before approval</Button><Button onClick={() => approveAutomatic.mutate()} disabled={approveAutomatic.isPending}>{approveAutomatic.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}Approve and activate this Friend</Button></div></div> : <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground"><Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" /><p className="text-sm">No automatic draft yet.</p></div>}

            {proofEvidenceSection}

            <section className="space-y-2 rounded-lg border p-4"><Label>Learning behavior after approval</Label><Select value={learningMode} onValueChange={(value: any) => setLearningMode(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="review">Review personality improvements before applying</SelectItem><SelectItem value="positive_outcomes">Auto-learn patterns only from positive outcomes</SelectItem></SelectContent></Select></section>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
