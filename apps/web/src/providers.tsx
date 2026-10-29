"use client"

import { Toasty } from "@cloudflare/kumo/components/toast"
import { QueryClientProvider } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { queryClient } from "@/lib/api-hooks"
import { ThemeProvider } from "@/lib/theme"
import { appToastManager } from "@/lib/toast-manager"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ClientToasty>{children}</ClientToasty>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

function ClientToasty({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <>{children}</>
  }

  return <Toasty toastManager={appToastManager}>{children}</Toasty>
}
