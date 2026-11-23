export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
export const OG_FPS = 12
export const OG_LOOP_MS = 5000

export const OG_HOLD = "0%, 6%, 94%, 100%"

export function loopAnimation(name: string): string {
  return `${name} ${OG_LOOP_MS}ms ease-in-out infinite`
}

export function frameCount(): number {
  return Math.round((OG_LOOP_MS / 1000) * OG_FPS)
}

export function frameTimeMs(frameIndex: number): number {
  return (frameIndex / OG_FPS) * 1000
}
