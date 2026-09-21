import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy` — Clerk's
 * docs still say `middleware.ts`, which is a no-op on this version.
 *
 * This only makes the Clerk session available to the request. It deliberately
 * does NOT decide what is protected: Clerk deprecated `createRouteMatcher`
 * because path matching can diverge from how Next actually routes, leaving
 * pages reachable. The real gate is in app/(app)/layout.tsx, which every
 * signed-in screen renders through.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Everything except Next internals and static files, unless they carry a
    // query string.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
