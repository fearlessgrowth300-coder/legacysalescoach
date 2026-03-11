import { useRef, useState, useCallback } from "react";
import { Trash2, Pencil } from "lucide-react";

interface SwipeToDeleteProps {
  onDelete: () => void;
  onSwipeRight?: () => void;
  children: React.ReactNode;
  className?: string;
}

const THRESHOLD = 80;

export default function SwipeToDelete({ onDelete, onSwipeRight, children, className = "" }: SwipeToDeleteProps) {
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

    if (isHorizontal.current === null && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      isHorizontal.current = Math.abs(dx) > Math.abs(dy);
    }

    if (!isHorizontal.current) return;
    e.stopPropagation();

    // Allow both left (delete) and right (rename) swipe
    const clamped = Math.max(-(THRESHOLD + 20), Math.min(onSwipeRight ? THRESHOLD + 20 : 0, dx));
    setOffsetX(clamped);
  }, [swiping, onSwipeRight]);

  const handleTouchEnd = useCallback(() => {
    setSwiping(false);
    if (offsetX < -THRESHOLD) {
      setOffsetX(-300);
      setTimeout(() => onDelete(), 250);
    } else if (offsetX > THRESHOLD && onSwipeRight) {
      setOffsetX(0);
      onSwipeRight();
    } else {
      setOffsetX(0);
    }
    isHorizontal.current = null;
  }, [offsetX, onDelete, onSwipeRight]);

  const deleteProgress = Math.min(1, Math.abs(Math.min(0, offsetX)) / THRESHOLD);
  const renameProgress = Math.min(1, Math.max(0, offsetX) / THRESHOLD);

  return (
    <div
      className={`relative overflow-hidden rounded-lg ${className}`}
      ref={containerRef}
      style={{ touchAction: "pan-y", overflowX: "hidden" }}
    >
      {/* Delete background (right side) */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-end px-4 rounded-lg transition-colors"
        style={{
          backgroundColor: `hsl(0 ${60 + deleteProgress * 24}% ${50 - deleteProgress * 10}%)`,
          width: `${Math.abs(Math.min(0, offsetX)) + 10}px`,
          opacity: Math.min(1, Math.abs(Math.min(0, offsetX)) / 30),
        }}
      >
        <Trash2 className="h-4 w-4 text-white" style={{ transform: `scale(${0.8 + deleteProgress * 0.4})` }} />
      </div>

      {/* Rename background (left side) */}
      {onSwipeRight && (
        <div
          className="absolute inset-y-0 left-0 flex items-center justify-start px-4 rounded-lg transition-colors"
          style={{
            backgroundColor: `hsl(var(--primary) / ${0.3 + renameProgress * 0.5})`,
            width: `${Math.max(0, offsetX) + 10}px`,
            opacity: Math.min(1, Math.max(0, offsetX) / 30),
          }}
        >
          <Pencil className="h-4 w-4 text-primary-foreground" style={{ transform: `scale(${0.8 + renameProgress * 0.4})` }} />
        </div>
      )}

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
