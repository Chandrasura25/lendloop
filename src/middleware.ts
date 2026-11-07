import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Route protection is a UX convenience. The real access control is enforced inside every
// Convex function (see convex/lib/auth.ts), so data stays protected even without this.
const isProtected = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
