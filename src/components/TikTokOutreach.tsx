import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Plus, Copy, Check, Loader2, ExternalLink, UserCheck, MessageSquare, Sparkles,
  Eye, Heart, MessageCircle, Share2, Video, Trash2, Upload, Image, X, Ghost
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type Suggestion = { id: number; type: string; text: string; whyThisWorks?: string };

type TikTokProspect = {
  id: string;
  name: string;
  tiktok_url: string | null;
  profile_pic_url: string | null;
  detected_interests: string | null;
  suggested_comment: string | null;
  has_followed_back: boolean;
  created_at: string;
  conversation_stage: string;
  target_video_url: string | null;
  target_video_caption: string | null;
};

export default function TikTokOutreach({ workspaceId }: { workspaceId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: workspace } = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspaces").select("*").eq("id", workspaceId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: tiktokProspects, isLoading } = useQuery({
    queryKey: ["tiktok-prospects", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospects")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as any[]).filter((p: any) => p.platform === "tiktok") as unknown as TikTokProspect[];
    },
  });

  const getInitials = (name: string) =>
    name.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  const handleAnalyze = async () => {
    if (!tiktokUrl.trim() || !user) return;
    setIsAnalyzing(true);
    setAnalysisResult(null);

    try {
      const { data: prospect, error: pErr } = await supabase
        .from("prospects")
        .insert({
          user_id: user.id,
          workspace_id: workspaceId,
          name: tiktokUrl.trim(),
          tiktok_url: tiktokUrl.trim(),
          platform: "tiktok" as any,
          reply_mode: workspace?.default_reply_mode || "friend",
          conversation_stage: "tiktok_outreach",
        } as any)
        .select()
        .single();
      if (pErr) throw pErr;

      const { data, error } = await supabase.functions.invoke("fetch-tiktok", {
        body: {
          url: tiktokUrl.trim(),
          workspaceId,
          prospectId: prospect.id,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setAnalysisResult(data);
      toast.success("Profile analyzed! Comment generated.");
      queryClient.invalidateQueries({ queryKey: ["tiktok-prospects"] });
    } catch (e: any) {
      console.error("TikTok analyze error:", e);
      toast.error(e.message || "Failed to analyze TikTok profile");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Comment copied!");
  };

  const handleFollowBack = async (prospect: TikTokProspect) => {
    if (!user) return;
    setConvertingId(prospect.id);

    try {
      await supabase.from("prospects").update({
        has_followed_back: true,
        conversation_stage: "first_contact",
      } as any).eq("id", prospect.id);

      const { data: suggestData } = await supabase.functions.invoke("chat-suggest", {
        body: {
          prospectId: prospect.id,
          message: `TikTok prospect @${prospect.name} has followed me back or engaged with my comment. Their bio: ${prospect.detected_interests || "N/A"}. TikTok URL: ${prospect.tiktok_url}. 

CRITICAL CONTEXT: I commented on their TikTok post and they responded (followed back or engaged). Now I need to slide into their DMs with a message that:
1. References the interaction we already had (the comment on their post)
2. Feels like a natural continuation — NOT a cold DM
3. Creates curiosity about what I do and makes them WANT to reply
4. Positions me as someone valuable in their niche, not a random follower
5. Keeps it short (2-3 sentences max) — long DMs get ignored
6. Has a question or hook at the end that makes NOT replying feel like they're missing out

The goal is to start a genuine conversation that leads to them wanting to know more about what I do. Make the message impossible to ignore.`,
          threadType: "friend",
          mode: "first_message",
        },
      });

      // Save the first suggestion to the prospect so the chat page can pick it up
      if (suggestData?.suggestions?.length) {
        const firstSuggestions = suggestData.suggestions;
        // Store all suggestions as JSON in suggested_first_message for the chat to display
        await supabase.from("prospects").update({
          suggested_first_message: JSON.stringify(firstSuggestions),
        }).eq("id", prospect.id);
      }

      queryClient.invalidateQueries({ queryKey: ["tiktok-prospects"] });
      queryClient.invalidateQueries({ queryKey: ["selected-prospect", prospect.id] });
      toast.success("Opening chat with first message ready to copy!");
      navigate(`/chats/${prospect.id}`);
    } catch (e: any) {
      console.error("Follow back error:", e);
      toast.error("Failed to create chat");
    } finally {
      setConvertingId(null);
    }
  };

  const handleDelete = async (prospectId: string) => {
    setDeletingId(prospectId);
    try {
      await supabase.from("chat_messages").delete().eq("prospect_id", prospectId);
      await supabase.from("prospects").delete().eq("id", prospectId);
      queryClient.invalidateQueries({ queryKey: ["tiktok-prospects"] });
      toast.success("Prospect removed");
    } catch (e: any) {
      toast.error("Failed to delete");
    } finally {
      setDeletingId(null);
    }
  };

  const pendingProspects = tiktokProspects?.filter(p => !(p as any).has_followed_back) || [];
  const convertedProspects = tiktokProspects?.filter(p => (p as any).has_followed_back) || [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold flex items-center gap-2 text-sm">
            <Video className="h-4 w-4 shrink-0" />
            TikTok Outreach
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Analyze profiles, comment to trigger follows, then DM
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) { setAnalysisResult(null); setTiktokUrl(""); } }}>
          <DialogTrigger asChild>
            <Button size="sm" className="shrink-0"><Plus className="h-4 w-4 mr-1" />Add TikTok</Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg mx-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Video className="h-5 w-5 shrink-0" />
                Analyze TikTok Profile
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div>
                <Label>TikTok Profile URL *</Label>
                <Input
                  value={tiktokUrl}
                  onChange={(e) => setTiktokUrl(e.target.value)}
                  placeholder="https://tiktok.com/@username"
                  disabled={isAnalyzing}
                  className="text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  We'll analyze their profile, bio, and recent posts to generate a strategic comment
                </p>
              </div>

              {isAnalyzing && (
                <div className="flex items-center gap-3 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                  <div>
                    <p className="font-medium">Analyzing TikTok profile...</p>
                    <p className="text-xs">Scraping bio, posts, and generating a strategic comment</p>
                  </div>
                </div>
              )}

              {analysisResult && (
                <div className="space-y-3">
                  {/* Profile Info */}
                  <div className="flex items-center gap-3 bg-muted/50 rounded-lg p-3">
                    {analysisResult.profilePicUrl && (
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarImage src={analysisResult.profilePicUrl} referrerPolicy="no-referrer" />
                        <AvatarFallback>{getInitials(analysisResult.nickname || analysisResult.username)}</AvatarFallback>
                      </Avatar>
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">@{analysisResult.username}</p>
                      <p className="text-xs text-muted-foreground truncate">{analysisResult.nickname}</p>
                      <p className="text-xs text-muted-foreground">
                        {analysisResult.followersCount?.toLocaleString()} followers · {analysisResult.videoCount} videos
                      </p>
                    </div>
                  </div>

                  {/* Bio */}
                  {analysisResult.bio && (
                    <div className="text-sm bg-muted/30 rounded p-2">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Bio</p>
                      <p className="break-words whitespace-pre-wrap">{analysisResult.bio}</p>
                    </div>
                  )}

                  {/* Suggested Comment */}
                  {analysisResult.suggestedComment && (
                    <Card className="border-primary/30 bg-primary/5 overflow-hidden">
                      <CardContent className="p-3 space-y-2">
                        {/* Target Video */}
                         {(analysisResult.targetVideoCaption || analysisResult.targetVideoUrl) && (
                          <div className="bg-muted/40 rounded p-2">
                            <p className="text-xs font-medium text-muted-foreground mb-1">🎯 Comment on this specific post:</p>
                            {analysisResult.postNumber && (
                              <div className="flex flex-wrap gap-2 mb-1">
                                <Badge variant="secondary" className="text-[10px]">Post #{analysisResult.postNumber} from top</Badge>
                                {analysisResult.videoLikes && <Badge variant="outline" className="text-[10px]">❤️ {Number(analysisResult.videoLikes).toLocaleString()} likes</Badge>}
                                {analysisResult.videoViews && <Badge variant="outline" className="text-[10px]">👁 {Number(analysisResult.videoViews).toLocaleString()} views</Badge>}
                              </div>
                            )}
                            <p className="text-sm italic break-words">"{analysisResult.targetVideoCaption}"</p>
                            {analysisResult.targetVideoUrl && (
                              <a href={analysisResult.targetVideoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1 mt-1 hover:underline">
                                <ExternalLink className="h-3 w-3 shrink-0" />
                                <span>Open this video on TikTok</span>
                              </a>
                            )}
                            {analysisResult.whyThisVideo && (
                              <p className="text-xs text-muted-foreground mt-1 break-words">📌 {analysisResult.whyThisVideo}</p>
                            )}
                          </div>
                        )}

                        {/* Comment Header + Copy */}
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            <Sparkles className="h-4 w-4 text-primary shrink-0" />
                            Suggested Comment
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 text-xs"
                            onClick={() => handleCopy("dialog", analysisResult.suggestedComment)}
                          >
                            {copiedId === "dialog" ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                            Copy
                          </Button>
                        </div>
                        <p className="text-sm break-words whitespace-pre-wrap">{analysisResult.suggestedComment}</p>
                        {analysisResult.commentStrategy && (
                          <p className="text-xs text-muted-foreground break-words">💡 {analysisResult.commentStrategy}</p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  <div className="flex items-center gap-2 text-green-600 text-sm">
                    <Check className="h-4 w-4 shrink-0" />
                    <span>Added to your TikTok outreach list!</span>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setAddOpen(false); setTiktokUrl(""); setAnalysisResult(null); }}>
                      Done
                    </Button>
                  </DialogFooter>
                </div>
              )}

              {!analysisResult && (
                <DialogFooter>
                  <Button onClick={handleAnalyze} disabled={!tiktokUrl.trim() || isAnalyzing} className="w-full sm:w-auto">
                    {isAnalyzing ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Analyzing...</> : "Analyze & Generate Comment"}
                  </Button>
                </DialogFooter>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !tiktokProspects?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <Video className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="font-medium mb-1">No TikTok prospects yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add a TikTok profile to analyze and get a strategic comment suggestion
            </p>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />Add First Profile
            </Button>
          </div>
        ) : (
          <div className="p-3 space-y-5">
            {/* Pending - waiting for follow back */}
            {pendingProspects.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Waiting for Follow Back ({pendingProspects.length})
                </h3>
                <div className="space-y-2">
                  {pendingProspects.map((prospect) => (
                    <Card key={prospect.id} className="p-3 overflow-hidden">
                      {/* Top row: avatar + name + link */}
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-9 w-9 shrink-0">
                          {prospect.profile_pic_url ? (
                            <AvatarImage src={prospect.profile_pic_url} referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          ) : null}
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {getInitials(prospect.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{prospect.name}</p>
                          {prospect.detected_interests && (
                            <p className="text-xs text-muted-foreground line-clamp-2 break-words">{prospect.detected_interests}</p>
                          )}
                        </div>
                        {prospect.tiktok_url && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" asChild>
                            <a href={prospect.tiktok_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                      </div>

                      {/* Suggested comment section */}
                      {(prospect as any).suggested_comment && (
                        <div className="mt-2 bg-muted/30 rounded p-2 space-y-1.5">
                          {(prospect as any).target_video_caption && (
                            <div>
                              <p className="text-xs text-muted-foreground">🎯 Comment on:</p>
                              {/* Show stats line if present (Post #X · likes · views) */}
                              {(prospect as any).target_video_caption.startsWith("Post #") && (
                                <p className="text-xs font-medium text-foreground mt-0.5">
                                  {(prospect as any).target_video_caption.split("\n")[0]}
                                </p>
                              )}
                              {(prospect as any).target_video_url && (
                                <a href={(prospect as any).target_video_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 break-words mt-0.5">
                                  <span className="line-clamp-2">
                                    {(() => {
                                      const cap = (prospect as any).target_video_caption || "";
                                      // Get caption without stats prefix
                                      const lines = cap.split("\n");
                                      const captionText = lines.length > 1 && lines[0].startsWith("Post #") ? lines.slice(1).join("\n") : cap;
                                      return captionText ? `"${captionText}"` : "Open video";
                                    })()}
                                  </span>
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </a>
                              )}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground">💬 Suggested comment:</p>
                          <p className="text-sm break-words whitespace-pre-wrap">{(prospect as any).suggested_comment}</p>
                        </div>
                      )}

                      {/* Action buttons - stacked on mobile */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {(prospect as any).suggested_comment && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => handleCopy(prospect.id, (prospect as any).suggested_comment)}
                          >
                            {copiedId === prospect.id ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                            Copy Comment
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleFollowBack(prospect)}
                          disabled={convertingId === prospect.id}
                        >
                          {convertingId === prospect.id ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <UserCheck className="h-3 w-3 mr-1" />
                          )}
                          Follow Back
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive ml-auto"
                          onClick={() => handleDelete(prospect.id)}
                          disabled={deletingId === prospect.id}
                        >
                          {deletingId === prospect.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}
                          Delete
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Converted - followed back, chat opened */}
            {convertedProspects.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Followed Back — Active Chats ({convertedProspects.length})
                </h3>
                <div className="space-y-2">
                  {convertedProspects.map((prospect) => (
                    <Card
                      key={prospect.id}
                      className="p-3 cursor-pointer hover:bg-muted/50 transition-colors overflow-hidden"
                      onClick={() => navigate(`/chats/${prospect.id}`)}
                    >
                      <div className="flex items-start gap-2.5">
                        <Avatar className="h-9 w-9 shrink-0 mt-0.5">
                          {prospect.profile_pic_url ? (
                            <AvatarImage src={prospect.profile_pic_url} referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          ) : null}
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {getInitials(prospect.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm break-words">{prospect.name}</p>
                          {prospect.tiktok_url && (
                            <a
                              href={prospect.tiktok_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              <span className="truncate">View TikTok Profile</span>
                            </a>
                          )}
                          <p className="text-xs text-muted-foreground break-words line-clamp-2 mt-0.5">
                            {prospect.detected_interests || "Active conversation"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">
                          <UserCheck className="h-3 w-3 mr-0.5" />Followed
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive shrink-0"
                          onClick={(e) => { e.stopPropagation(); handleDelete(prospect.id); }}
                          disabled={deletingId === prospect.id}
                        >
                          {deletingId === prospect.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}
                          Delete
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
