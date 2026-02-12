import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/useAuth";

export default function SignUp() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      navigate("/chats", { replace: true });
    }
  }, [user, loading, navigate]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { toast.error("Passwords do not match"); return; }
    if (password.length < 6) { toast.error("Password must be at least 6 characters"); return; }

    setIsLoading(true);
    try {
      // Send OTP — generated server-side
      const res = await supabase.functions.invoke("send-otp", {
        body: { email, type: "signup" },
      });

      if (res.error) {
        const msg = typeof res.error === 'object' && 'message' in res.error ? res.error.message : String(res.error);
        throw new Error(msg);
      }
      if (res.data?.error) throw new Error(res.data.error);

      toast.success("A verification code has been sent to your email!");
      setShowOtp(true);
    } catch (error: any) {
      console.error("Send OTP error:", error);
      const msg = error.message || "Failed to send verification code";
      if (msg.includes("verify a domain") || msg.includes("testing emails")) {
        toast.error("Email delivery requires domain verification. Please contact the admin or use a verified email.");
      } else {
        toast.error(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length < 6) { toast.error("Please enter the 6-digit code"); return; }

    setIsLoading(true);
    try {
      // Verify OTP server-side
      const { data: verifyResult, error: verifyErr } = await supabase.functions.invoke("verify-otp", {
        body: { email, code: otpCode, type: "signup" },
      });

      if (verifyErr) throw verifyErr;
      if (!verifyResult?.valid) {
        toast.error(verifyResult?.error || "Invalid verification code");
        setIsLoading(false);
        return;
      }

      // OTP verified server-side — now create the account
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;

      toast.success("Account created! Redirecting...");
      navigate("/chats");
    } catch (error: any) {
      toast.error(error.message || "Failed to create account");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsLoading(true);
    try {
      const res = await supabase.functions.invoke("send-otp", {
        body: { email, type: "signup" },
      });
      if (res.error) throw res.error;
      if (res.data?.error) throw new Error(res.data.error);

      toast.success("New code sent!");
    } catch (error: any) {
      toast.error(error.message || "Failed to resend code");
    } finally {
      setIsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            {showOtp ? "Verify Your Email" : "Create an account"}
          </CardTitle>
          <CardDescription className="text-center">
            {showOtp
              ? `Enter the 6-digit code sent to ${email}`
              : "Enter your details to get started with Sales Reply Coach"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {showOtp ? (
            <div className="space-y-6">
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button onClick={handleVerifyOtp} className="w-full" disabled={isLoading}>
                {isLoading ? "Verifying..." : "Verify & Continue"}
              </Button>
              <Button variant="ghost" className="w-full" onClick={handleResendCode} disabled={isLoading}>
                {isLoading ? "Sending..." : "Resend Code"}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => { setShowOtp(false); setOtpCode(""); }}
              >
                Back to Sign Up
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" type="text" placeholder="John Doe" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input id="confirmPassword" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Sending code..." : "Sign Up"}
              </Button>
            </form>
          )}
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <div className="text-sm text-center text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
