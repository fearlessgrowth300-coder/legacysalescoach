import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Link as LinkIcon, BookOpen } from "lucide-react";

export type SelectedPrinciple = {
  id: string;
  principle_name: string;
  source_id: string | null;
  source_title: string;
  source_url: string | null;
  source_type: string;
  why_relevant: string;
};

type Props = {
  content: string;
  selectedPrinciples?: SelectedPrinciple[];
  frameworkName?: string;
};

const CITE_RE = /\[\[cite:([0-9a-f-]{8,})\]\]/gi;

/**
 * Renders assistant content with [[cite:<id>]] tokens replaced by numbered
 * superscript chips, plus a "Sources" footer linking each principle to its
 * source upload (deep-link to /knowledge?item=<source_id>).
 */
export default function BrainCitations({ content, selectedPrinciples, frameworkName }: Props) {
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const principles = useMemo(() => selectedPrinciples || [], [selectedPrinciples]);
  const idToNumber = useMemo(() => {
    const m = new Map<string, number>();
    principles.forEach((p, i) => m.set(p.id.toLowerCase(), i + 1));
    return m;
  }, [principles]);

  // Replace [[cite:id]] with markdown link tokens we can post-render with `a` component
  const transformed = useMemo(() => {
    if (!principles.length) return content.replace(CITE_RE, ""); // strip orphan tokens
    return content.replace(CITE_RE, (_match, rawId) => {
      const id = String(rawId).toLowerCase();
      const n = idToNumber.get(id);
      if (!n) return ""; // invalid id → drop silently
      // Use a custom protocol so ReactMarkdown components.a can intercept
      return `[^${n}](cite:${id})`;
    });
  }, [content, principles, idToNumber]);

  const scrollToSource = (id: string) => {
    setHighlightId(id);
    const el = document.getElementById(`brain-source-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setHighlightId(null), 1800);
  };

  return (
    <>
      <div className="prose prose-sm dark:prose-invert max-w-full break-words overflow-hidden [&>*]:max-w-full [&_pre]:overflow-x-auto [&_p]:break-words [&_li]:break-words [&_strong]:break-words [&_h1]:break-words [&_h2]:break-words [&_h3]:break-words [&_blockquote]:break-words" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
        <ReactMarkdown
          components={{
            a: ({ href, children, ...props }) => {
              if (typeof href === "string" && href.startsWith("cite:")) {
                const id = href.slice(5);
                return (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); scrollToSource(id); }}
                    className="inline-flex items-center justify-center align-super text-[10px] font-bold w-4 h-4 rounded-full bg-primary/15 text-primary hover:bg-primary/25 transition-colors mx-0.5 cursor-pointer no-underline"
                    title={principles.find((p) => p.id.toLowerCase() === id)?.principle_name || "Source"}
                  >
                    {String(children).replace(/^\^/, "")}
                  </button>
                );
              }
              return <a href={href} {...props}>{children}</a>;
            },
          }}
        >
          {transformed}
        </ReactMarkdown>
      </div>

      {principles.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground">
              Sources{frameworkName ? ` · ${frameworkName}` : ""}
            </span>
          </div>
          <ol className="space-y-1.5">
            {principles.map((p, i) => {
              const isHighlighted = highlightId === p.id.toLowerCase();
              const href = p.source_id ? `/knowledge?item=${p.source_id}` : (p.source_url || "#");
              return (
                <li
                  key={p.id}
                  id={`brain-source-${p.id.toLowerCase()}`}
                  className={`flex gap-2 text-xs transition-colors rounded-md p-1.5 -mx-1.5 ${isHighlighted ? "bg-primary/10" : ""}`}
                >
                  <span className="font-bold text-primary shrink-0">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground break-words">{p.principle_name}</div>
                    <div className="text-muted-foreground break-words">{p.why_relevant}</div>
                    <a
                      href={href}
                      className="inline-flex items-center gap-1 mt-0.5 text-primary/80 hover:text-primary hover:underline"
                      target={p.source_url && !p.source_id ? "_blank" : undefined}
                      rel="noopener noreferrer"
                    >
                      <LinkIcon className="h-3 w-3" />
                      <span className="truncate">{p.source_title || "Source"}</span>
                    </a>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </>
  );
}
