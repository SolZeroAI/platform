"use client"

import { Toasty } from "@cloudflare/kumo/components/toast"
import { useEffect, useState } from "react"
import { ThemeProvider } from "@/lib/theme"
import { appToastManager } from "@/lib/toast-manager"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ClientToasty>{children}</ClientToasty>
    </ThemeProvider>
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
