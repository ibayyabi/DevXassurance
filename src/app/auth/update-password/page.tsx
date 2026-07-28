import { AuthShell } from "@/components/auth-shell";
import { UpdatePasswordForm } from "@/components/update-password-form";

export default function Page() {
  return (
    <AuthShell
      title="Choose a new password"
      description="Set a strong password for your X-Assurance account."
    >
      <UpdatePasswordForm />
    </AuthShell>
  );
}
