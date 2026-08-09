interface AiTypingIndicatorProps {
  label?: string;
  className?: string;
}

export default function AiTypingIndicator({
  label = "Legacy Coach is typing",
  className = "",
}: AiTypingIndicatorProps) {
  return (
    <div
      className={`ai-typing-row flex items-end gap-2 ${className}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="ai-typing-avatar" aria-hidden="true">
        <img src="/legacy-coach-192.png" alt="" />
      </div>
      <div className="ai-typing-bubble" aria-hidden="true">
        <span className="ai-typing-dot" style={{ animationDelay: "0ms" }} />
        <span className="ai-typing-dot" style={{ animationDelay: "160ms" }} />
        <span className="ai-typing-dot" style={{ animationDelay: "320ms" }} />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
