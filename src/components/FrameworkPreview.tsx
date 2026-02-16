import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";

interface ParsedFramework {
  voice_style?: string;
  identity_mode?: string;
  never_rules?: string[];
  always_rules?: string[];
  step_flow?: { step: number; name: string; description: string }[];
  objection_map?: Record<string, string>;
  emotional_hooks?: string[];
  cta_style?: string;
  summary?: string;
  [key: string]: any;
}

interface Props {
  parsedFramework: ParsedFramework | null;
}

export default function FrameworkPreview({ parsedFramework }: Props) {
  if (!parsedFramework) return null;

  return (
    <div className="mt-3 p-3 bg-muted rounded-lg space-y-2">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <p className="text-xs font-semibold">Framework Analyzed & Saved!</p>
      </div>

      {parsedFramework.voice_style && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Voice:</span>
          <Badge variant="outline" className="text-xs">{parsedFramework.voice_style}</Badge>
        </div>
      )}

      {parsedFramework.step_flow && parsedFramework.step_flow.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Key Flow:</span>
          <Badge variant="outline" className="text-xs">
            {parsedFramework.step_flow.length}-Step {parsedFramework.step_flow[0]?.name || "Flow"}
          </Badge>
        </div>
      )}

      {parsedFramework.never_rules && parsedFramework.never_rules.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Main Rule:</span>
          <Badge variant="secondary" className="text-xs">
            NEVER: {parsedFramework.never_rules[0]?.substring(0, 50)}
          </Badge>
        </div>
      )}

      {parsedFramework.cta_style && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">CTA:</span>
          <Badge variant="outline" className="text-xs">{parsedFramework.cta_style}</Badge>
        </div>
      )}

      {parsedFramework.summary && (
        <p className="text-xs text-muted-foreground italic">{parsedFramework.summary}</p>
      )}

      <p className="text-xs text-green-600 font-medium">
        ✅ The AI will now reply EXACTLY using this guide + core brain principles.
      </p>
    </div>
  );
}
