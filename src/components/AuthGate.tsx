import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { setUserScope } from "@/lib/lsStore";
import { startSync, stopSync } from "@/lib/sync";
import { isEmailAllowed } from "@/lib/allowlist";
import { Loader2 } from "lucide-react";

type AuthStatus = "loading" | "signed-in" | "signed-out";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    let active = true;

    const handleSession = async (session: Session | null) => {
      if (!session?.user) {
        setUserScope(null);
        stopSync();
        if (active) setStatus("signed-out");
        return;
      }
      const allowed = await isEmailAllowed(session.user.email);
      if (!allowed) {
        try {
          sessionStorage.setItem(
            "linecheck:auth:denied",
            session.user.email || "unknown",
          );
        } catch {}
        await supabase.auth.signOut();
        setUserScope(null);
        stopSync();
        if (active) setStatus("signed-out");
        return;
      }
      setUserScope(session.user.id);
      void startSync(session.user.id);
      if (active) setStatus("signed-in");
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      void handleSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      void handleSession(session);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const isPublic = pathname === "/auth" || pathname.startsWith("/s/");

  useEffect(() => {
    if (status === "signed-out" && !isPublic) {
      navigate({ to: "/auth", replace: true });
    }
  }, [status, isPublic, navigate]);

  if (isPublic) return <>{children}</>;

  if (status !== "signed-in") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  return <>{children}</>;
}
