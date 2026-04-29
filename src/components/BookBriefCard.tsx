import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BookOpen, CheckCircle2, Loader2, AlertCircle, Sparkles, RotateCcw } from "lucide-react";

export interface ChapterStatus {
  index: number;
  title: string;
  one_line?: string;
  status: "pending" | "extracting" | "done" | "failed";
  principle_count?: number;
  summary?: string;
  error?: string;
}

export interface BookBrief {
  title?: string;
  author?: string;
  core_system?: string;
  what_this_book_teaches?: string;
  chapters?: ChapterStatus[];
}

interface Props {
  brief: BookBrief;
  status: "mapping" | "extracting" | "ready" | "error" | string;
  totalPrinciples?: number;
  topTechniques?: { principle_name: string; category?: string; what_i_learned?: string }[];
  categoriesCount?: number;
  onRetryChapter?: (chapterIndex: number) => void;
  retryingIndex?: number | null;
}

export function BookBriefCard({
  brief,
  status,
  totalPrinciples = 0,
  topTechniques = [],
  categoriesCount = 0,
  onRetryChapter,
  retryingIndex = null,
}: Props) {
  const isLive = status === "mapping" || status === "extracting";
  const isReady = status === "ready";

  return (
    <Card className="p-4 sm:p-5 space-y-4 border-primary/30">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 shrink-0">
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base sm:text-lg font-semibold leading-tight">
              {brief.title || "Untitled Book"}
            </h3>
            {brief.author && (
              <span className="text-xs sm:text-sm text-muted-foreground">· {brief.author}</span>
            )}
          </div>
          {brief.core_system && (
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              <span className="font-medium text-foreground">Core system:</span> {brief.core_system}
            </p>
          )}
        </div>
      </div>

      {/* Live banner */}
      {isLive && (
        <div className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
          <span className="text-xs sm:text-sm">Brain is now learning…</span>
        </div>
      )}

      {/* Briefing */}
      {brief.what_this_book_teaches && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            What this book teaches
          </p>
          <p className="text-sm leading-relaxed">{brief.what_this_book_teaches}</p>
        </div>
      )}

      {/* Chapters */}
      {brief.chapters && brief.chapters.length > 0 && (() => {
        const total = brief.chapters.length;
        const doneCount = brief.chapters.filter((c) => c.status === "done").length;
        const extractingCount = brief.chapters.filter((c) => c.status === "extracting").length;
        const failedCount = brief.chapters.filter((c) => c.status === "failed").length;
        // Done = 1.0, extracting = 0.5, pending/failed = 0
        const progressPct = Math.round(
          ((doneCount + extractingCount * 0.5) / total) * 100,
        );
        return (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Chapters ({total})
              </p>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {doneCount}/{total} done{failedCount > 0 ? ` · ${failedCount} failed` : ""}
              </span>
            </div>
            <Progress value={progressPct} className="h-1.5 mb-3" />
            <ul className="space-y-1.5">
              {brief.chapters.map((c) => (
                <li
                  key={c.index}
                  className="rounded-md border bg-card/40 px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-muted-foreground mr-1">{c.index}.</span>
                      <span className="truncate">{c.title}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.status === "done" && (
                        <Badge variant="secondary" className="text-[11px]">
                          <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                          {c.principle_count ?? 0} principles
                        </Badge>
                      )}
                      {c.status === "extracting" && (
                        <Badge variant="outline" className="text-[11px]">
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          extracting…
                        </Badge>
                      )}
                      {c.status === "pending" && (
                        <Badge variant="outline" className="text-[11px] text-muted-foreground">
                          pending
                        </Badge>
                      )}
                      {c.status === "failed" && (
                        <>
                          <Badge variant="destructive" className="text-[11px]">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            failed
                          </Badge>
                          {onRetryChapter && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px]"
                              disabled={retryingIndex === c.index}
                              onClick={() => onRetryChapter(c.index)}
                            >
                              {retryingIndex === c.index ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <>
                                  <RotateCcw className="h-3 w-3 mr-1" /> Retry
                                </>
                              )}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {c.status === "done" && c.summary && (
                    <p className="mt-1.5 text-xs text-muted-foreground leading-snug pl-4 border-l-2 border-primary/30">
                      <span className="font-medium text-foreground/80">What I learned:</span> {c.summary}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* The receipt */}
      {isReady && totalPrinciples > 0 && (
        <div className="rounded-md bg-primary/10 border border-primary/30 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">
              {totalPrinciples} new principles unlocked across {categoriesCount} categories
            </p>
          </div>
          {topTechniques.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Top techniques
              </p>
              <ul className="space-y-1">
                {topTechniques.slice(0, 3).map((t, i) => (
                  <li key={i} className="text-xs">
                    <span className="font-medium">{t.principle_name}</span>
                    {t.category && (
                      <span className="text-muted-foreground"> · {t.category}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
