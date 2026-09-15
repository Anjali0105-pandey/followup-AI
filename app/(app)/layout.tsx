import Sidebar from "@/components/shell/Sidebar";
import TopBar from "@/components/shell/TopBar";
import GoToShortcuts from "@/components/shell/GoToShortcuts";
import { ToastProvider } from "@/components/shell/Toast";
import { GeneratorProvider } from "@/components/generator/GeneratorProvider";
import { currentUser, navCounts } from "@/lib/repo/workspace";
import { AI_MODE } from "@/lib/ai";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [user, counts] = await Promise.all([currentUser(), navCounts()]);

  return (
    <ToastProvider>
      <GeneratorProvider>
        <GoToShortcuts />
        <div className="flex min-h-dvh">
          <Sidebar counts={counts} user={{ name: user.name, role: user.role, workspace: user.workspace }} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar aiMode={AI_MODE} />
            <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
          </div>
        </div>
      </GeneratorProvider>
    </ToastProvider>
  );
}
