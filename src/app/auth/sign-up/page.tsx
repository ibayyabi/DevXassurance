import { AuthShell } from "@/components/auth-shell";
import { SignUpForm } from "@/components/sign-up-form";

export default function Page() {
  return (
    <AuthShell
      title="Create your account"
      description="Set up secure access, then create or join a project assurance workspace."
    >
      <SignUpForm />
    </AuthShell>
  );
}
