import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { setUserScope } from "@/lib/lsStore";
import { startSync, stopSync } from "@/lib/sync";
import { startStaffSync, stopStaffSync } from "@/lib/staffSync";
import { getStaffSession, isStaffAllowedPath } from "@/lib/staffSession";
import { isEmailAllowed } from "@/lib/allowlist";
import { Loader2 } from "lucide-react";

type AuthStatus = "loading" | "signed-in" | "staff" | "signed-out";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    let active = true;

    const handleSession = async (session: Session | null) => {
      if (!session?.user) {
        const staff = getStaffSession();
        if (staff) {
          stopSync();
          setUserScope(staff.ownerId);
          void startStaffSync(staff);
          if (active) setStatus("staff");
          return;
        }
        setUserScope(null);
        stopSync();
        stopStaffSync();
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
      stopStaffSync();
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
    const onStaffChange = () => {
      void supabase.auth.getSession().then(({ data }) => handleSession(data.session));
    };
    window.addEventListener("linecheck:staff-session", onStaffChange);
    return () => {
      active = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("linecheck:staff-session", onStaffChange);
    };
  }, []);

  const isPublic =
    pathname === "/auth" ||
    pathname.startsWith("/s/") ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/c/");

  useEffect(() => {
    if (status === "signed-out" && !isPublic) {
      navigate({ to: "/auth", replace: true });
    }
    if (status === "staff" && !isPublic && !isStaffAllowedPath(pathname)) {
      navigate({ to: "/receiving", replace: true });
    }
  }, [status, isPublic, pathname, navigate]);

  if (isPublic) return <>{children}</>;

  if (status === "staff") {
    if (!isStaffAllowedPath(pathname)) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      );
    }
    return <>{children}</>;
  }

  if (status !== "signed-in") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  return <>{children}</>;
}

