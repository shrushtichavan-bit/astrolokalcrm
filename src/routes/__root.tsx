import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-[28px] font-bold tracking-tight text-[#1A1A1A]">Page not found</h1>
        <p className="mt-2 text-sm text-[#6B6B6B]">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-[8px] bg-[#F45722] px-5 py-2.5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#D94A1E]"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-[28px] font-bold tracking-tight text-[#1A1A1A]">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-[#6B6B6B]">
          Try again, or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-[8px] bg-[#F45722] px-5 py-2.5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#D94A1E]"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-[8px] border border-[#EBEBEB] bg-white px-5 py-2.5 text-[15px] font-semibold text-[#1A1A1A] transition-colors duration-150 hover:border-[#D0D0D0] hover:bg-[#F9F9F9]"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "AstroLokal CRM" },
      { name: "description", content: "AstroLokal lead and interview pipeline" },
      { name: "author", content: "AstroLokal" },
      { property: "og:title", content: "AstroLokal CRM" },
      { property: "og:description", content: "AstroLokal lead and interview pipeline" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/logo.svg" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster
        position="bottom-right"
        closeButton={false}
        toastOptions={{
          style: {
            background: "#1A1A1A",
            color: "#FFFFFF",
            border: "none",
            borderRadius: "10px",
            padding: "14px 18px",
            fontSize: "14px",
            minWidth: "300px",
          },
        }}
      />
    </QueryClientProvider>
  );
}
