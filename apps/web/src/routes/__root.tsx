import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Providers } from "@/providers"
import { getS0Brand } from "@/lib/brand"
import appCss from "@/styles/app.css?url"
import manropeLatin400 from "@fontsource/manrope/files/manrope-latin-400-normal.woff2?url"

const appStylesheetHref = import.meta.env.DEV ? `${appCss}?direct` : appCss

export const Route = createRootRoute({
  head: () => {
    const brand = getS0Brand()
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: `${brand.name} Agent` },
        {
          name: "description",
          content: "AI agent platform for software engineering workflows",
        },
      ],
      links: [
        { rel: "icon", href: brand.faviconPath },
        { rel: "apple-touch-icon", sizes: "180x180", href: brand.appleTouchIconPath },
        {
          rel: "preload",
          href: manropeLatin400,
          as: "font",
          type: "font/woff2",
          crossOrigin: "",
        },
        { rel: "stylesheet", href: appStylesheetHref },
      ],
    }
  },
  notFoundComponent: NotFound,
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Providers>
        <Outlet />
      </Providers>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="font-sans">
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-kumo-base text-kumo-default">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-kumo-subtle">The page you requested does not exist.</p>
      </div>
    </div>
  )
}
