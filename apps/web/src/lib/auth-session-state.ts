export interface AppSession {
  user: {
    id: string
    name: string
    email: string
    image?: string | null
  }
  isAdmin: boolean
}

export function resolveAppSession({
  clientUser,
  initialSession,
  pending,
}: {
  clientUser: AppSession["user"] | null
  initialSession: AppSession | null
  pending: boolean
}): AppSession | null {
  if (pending) {
    return initialSession
  }
  if (!clientUser) {
    return null
  }

  return {
    user: clientUser,
    isAdmin: initialSession?.user.id === clientUser.id && initialSession.isAdmin === true,
  }
}
