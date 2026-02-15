import { useRef, useState, useCallback } from "react";
import { Trash2 } from "lucide-react";

interface SwipeToDeleteProps {
  onDelete: () => void;
  children: React.ReactNode;
  className?: string;
}

const THRESHOLD = 80;

export default function SwipeToDelete({ onDelete, children, className = "" }: SwipeToDeleteProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const isHorizontal = useRef<boolean | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isHorizontal.current = null;
    setSwiping(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    // Determine direction lock on first significant move
    if (isHorizontal.current === null && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      isHorizontal.current = Math.abs(dx) > Math.abs(dy);
    }

    if (!isHorizontal.current) return;

    // Prevent page-level horizontal scroll when swiping a row
    e.stopPropagation();

    // Only allow left swipe (negative)
    const clamped = Math.min(0, Math.max(-THRESHOLD - 20, dx));
    setOffsetX(clamped);
  }, [swiping]);

  const handleTouchEnd = useCallback(() => {
    setSwiping(false);
    if (offsetX < -THRESHOLD) {
      // Animate out then delete
      setOffsetX(-300);
      setTimeout(() => onDelete(), 250);
    } else {
      setOffsetX(0);
    }
    isHorizontal.current = null;
  }, [offsetX, onDelete]);

  const deleteProgress = Math.min(1, Math.abs(offsetX) / THRESHOLD);

  return (
    <div
      className={`relative overflow-hidden rounded-lg ${className}`}
      ref={containerRef}
      style={{ touchAction: "pan-y", overflowX: "hidden" }}
    >
      {/* Delete background */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-end px-4 rounded-lg transition-colors"
        style={{
          backgroundColor: `hsl(0 ${60 + deleteProgress * 24}% ${50 - deleteProgress * 10}%)`,
          width: `${Math.abs(offsetX) + 10}px`,
          opacity: Math.min(1, Math.abs(offsetX) / 30),
        }}
      >
        <Trash2 className="h-4 w-4 text-white" style={{ transform: `scale(${0.8 + deleteProgress * 0.4})` }} />
      </div>

      {/* Swipeable content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: swiping ? "none" : "transform 0.25s ease-out",
          willChange: "transform",
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}
