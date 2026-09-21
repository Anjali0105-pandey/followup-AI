import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Sidebar from "@/components/shell/Sidebar";
import TopBar from "@/components/shell/TopBar";
import GoToShortcuts from "@/components/shell/GoToShortcuts";
import { ToastProvider } from "@/components/shell/Toast";
import { GeneratorProvider } from "@/components/generator/GeneratorProvider";
import { currentUser, navCounts, touchLastActive } from "@/lib/repo/workspace";
import { effectiveAiMode } from "@/lib/repo/credentials";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  /* The auth gate for the whole product. Every signed-in screen is inside this
     route group, so checking here covers them all — and a page added later is
     protected by construction rather than by remembering to list its path. */
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [user, counts] = await Promise.all([currentUser(), navCounts()]);
  const aiMode = await effectiveAiMode(user.id);

  /* Stamp activity here, where every signed-in screen passes through.
     touchLastActive() had no caller at all, so last_active_at was frozen at
     first sign-in and the Admin page's "Active this week" and "Last active"
     columns were permanently wrong. Not awaited: an activity stamp must never
     add latency to a page render, and losing one on a crash costs nothing. */
  void touchLastActive(user.id).catch(() => {});

  return (
    <ToastProvider>
      <GeneratorProvider>
        <GoToShortcuts />
        <div className="flex min-h-dvh">
          <Sidebar
            counts={counts}
            user={{ name: user.name, role: user.role, workspace: user.workspace, isAdmin: user.isAdmin }}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar aiMode={aiMode} />
            <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
          </div>
        </div>
      </GeneratorProvider>
    </ToastProvider>
  );
}
