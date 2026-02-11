import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

export default function Login() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Forgot password flow
  const [forgotMode, setForgotMode] = useState<"none" | "email" | "otp" | "newpass">("none");
  const [resetEmail, setResetEmail] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  useEffect(() => {
    if (user) navigate("/chats", { replace: true });
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Welcome back!");
    } catch (error: any) {
      toast.error(error.message || "Failed to sign in");
      setIsLoading(false);
    }
  };

  const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

  const handleForgotSendCode = async () => {
    if (!resetEmail.trim()) { toast.error("Enter your email"); return; }
    setIsLoading(true);
    try {
      const otp = generateOtp();
      // Store OTP in sessionStorage for verification
      sessionStorage.setItem("reset_otp", otp);
      sessionStorage.setItem("reset_otp_time", Date.now().toString());

      const { data, error } = await supabase.functions.invoke("send-otp", {
        body: { email: resetEmail, otp, type: "reset" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success("Reset code sent to your email!");
      setForgotMode("otp");
    } catch (error: any) {
      toast.error(error.message || "Failed to send reset code");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyResetOtp = () => {
    const stored = sessionStorage.getItem("reset_otp");
    const time = parseInt(sessionStorage.getItem("reset_otp_time") || "0");
    if (Date.now() - time > 600000) { toast.error("Code expired. Request a new one."); return; }
    if (resetOtp !== stored) { toast.error("Invalid code"); return; }
    setForgotMode("newpass");
  };

  const handleResetPassword = async () => {
    if (newPassword.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (newPassword !== confirmNewPassword) { toast.error("Passwords don't match"); return; }
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("reset-password", {
        body: { email: resetEmail, newPassword },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success("Password reset! You can now sign in.");
      setForgotMode("none");
      setEmail(resetEmail);
      sessionStorage.removeItem("reset_otp");
      sessionStorage.removeItem("reset_otp_time");
    } catch (error: any) {
      toast.error(error.message || "Failed to reset password");
    } finally {
      setIsLoading(false);
    }
  };

  // Forgot password UI
  if (forgotMode !== "none") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">
              {forgotMode === "email" ? "Reset Password" : forgotMode === "otp" ? "Enter Code" : "Set New Password"}
            </CardTitle>
            <CardDescription className="text-center">
              {forgotMode === "email" ? "Enter your email to receive a reset code" :
                forgotMode === "otp" ? `Enter the 6-digit code sent to ${resetEmail}` :
                  "Create your new password"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {forgotMode === "email" && (
              <>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} placeholder="you@example.com" />
                </div>
                <Button className="w-full" onClick={handleForgotSendCode} disabled={isLoading}>
                  {isLoading ? "Sending..." : "Send Reset Code"}
                </Button>
              </>
            )}
            {forgotMode === "otp" && (
              <>
                <div className="flex justify-center">
                  <InputOTP maxLength={6} value={resetOtp} onChange={setResetOtp}>
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
                <Button className="w-full" onClick={handleVerifyResetOtp} disabled={resetOtp.length < 6}>
                  Verify Code
                </Button>
                <Button variant="ghost" className="w-full" onClick={handleForgotSendCode} disabled={isLoading}>
                  {isLoading ? "Sending..." : "Resend Code"}
                </Button>
              </>
            )}
            {forgotMode === "newpass" && (
              <>
                <div className="space-y-2">
                  <Label>New Password</Label>
                  <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <div className="space-y-2">
                  <Label>Confirm New Password</Label>
                  <Input type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <Button className="w-full" onClick={handleResetPassword} disabled={isLoading}>
                  {isLoading ? "Resetting..." : "Reset Password"}
                </Button>
              </>
            )}
          </CardContent>
          <CardFooter>
            <Button variant="link" className="w-full" onClick={() => { setForgotMode("none"); setResetOtp(""); }}>
              Back to Sign In
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Welcome back</CardTitle>
          <CardDescription className="text-center">Sign in to your Sales Reply Coach account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setForgotMode("email")}>
                  Forgot password?
                </button>
              </div>
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <div className="text-sm text-center text-muted-foreground">
            Don't have an account?{" "}
            <Link to="/signup" className="text-primary hover:underline">Sign up</Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
