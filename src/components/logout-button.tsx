"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <Button
      onClick={logout}
      variant="outline"
      size="sm"
      className="rounded-lg border-ui-border bg-surface text-ink shadow-none hover:bg-plan-track"
    >
      Sign out
    </Button>
  );
}
