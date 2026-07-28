import { AuthShell } from "@/components/auth-shell";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function Page() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter your work email and we will send you a secure reset link."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
