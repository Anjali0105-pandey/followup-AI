import type { ReactNode } from "react";

/** Shared frame for the sign-in and sign-up screens. */
export default function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="text-center">
        <div className="mb-3 flex items-center justify-center gap-2">
          <span
            aria-hidden
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-brand text-[15px] font-semibold text-white"
          >
            F
          </span>
          <span className="t-h1">FollowUp AI</span>
        </div>
        <h1 className="t-h2">{title}</h1>
        <p className="t-meta mx-auto mt-1 max-w-sm">{subtitle}</p>
      </div>

      {children}
    </main>
  );
}
