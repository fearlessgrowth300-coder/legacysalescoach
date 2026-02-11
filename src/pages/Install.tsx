import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, CheckCircle, Smartphone } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const Install = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream);

    // Check if prompt was already captured globally
    if ((window as any).__pwaInstallPrompt) {
      setDeferredPrompt((window as any).__pwaInstallPrompt as BeforeInstallPromptEvent);
    }

    // Listen for late-arriving prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    // Listen for global signal
    const readyHandler = () => {
      if ((window as any).__pwaInstallPrompt) {
        setDeferredPrompt((window as any).__pwaInstallPrompt as BeforeInstallPromptEvent);
      }
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("pwa-prompt-ready", readyHandler);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("pwa-prompt-ready", readyHandler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferredPrompt(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Smartphone className="mx-auto h-12 w-12 text-primary mb-2" />
          <CardTitle className="text-2xl">Install Sales Coach</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {installed ? (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle className="h-10 w-10 text-green-500" />
              <p className="text-muted-foreground">App installed! You can find it on your home screen.</p>
            </div>
          ) : deferredPrompt ? (
            <>
              <p className="text-muted-foreground">
                Install the app for faster access, offline support, and a native feel.
              </p>
              <Button onClick={handleInstall} size="lg" className="w-full gap-2">
                <Download className="h-4 w-4" /> Install Now
              </Button>
            </>
          ) : isIOS ? (
            <div className="space-y-3 text-muted-foreground text-sm">
              <p className="font-medium text-foreground">To install on iPhone/iPad:</p>
              <ol className="list-decimal list-inside space-y-1 text-left">
                <li>Tap the <strong>Share</strong> button (square with arrow)</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
                <li>Tap <strong>Add</strong> to confirm</li>
              </ol>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Open this page in Chrome or Edge on your phone to install the app.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Install;
