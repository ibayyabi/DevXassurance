import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to review project conditions, evidence, and management reports."
    >
      <LoginForm />
    </AuthShell>
  );
}
