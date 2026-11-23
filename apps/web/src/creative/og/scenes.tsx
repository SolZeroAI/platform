/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { CSSProperties, ReactElement, ReactNode } from "react"
import type { OgCopy } from "./copy"
import { OG_HEIGHT, OG_HOLD, OG_WIDTH, loopAnimation } from "./frame"
import { MARK_SIZE } from "./mark"

export interface OgSceneProps {
  readonly copy: OgCopy
  readonly markCss: string
  readonly offsets: readonly { readonly offsetX: number; readonly offsetY: number }[]
  readonly themeCss: string
}

const stageStyle: CSSProperties = {
  width: OG_WIDTH,
  height: OG_HEIGHT,
  display: "flex",
  position: "relative",
  overflow: "hidden",
  boxSizing: "border-box",
  backgroundColor: "var(--color-kumo-canvas)",
  color: "var(--text-color-kumo-default)",
  fontFamily: "Manrope",
}

function Stage({
  themeCss,
  motionCss,
  children,
}: {
  readonly themeCss: string
  readonly motionCss: string
  readonly children: ReactNode
}): ReactElement {
  return (
    <div style={stageStyle}>
      <style>{`${themeCss}\n${motionCss}`}</style>
      {children}
    </div>
  )
}

function Lockup({
  name,
  size = 48,
}: {
  readonly name: string
  readonly size?: number
}): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <img src="solzero-logo" width={size} height={size} />
      <span style={{ fontSize: size * 0.58, fontWeight: 700, letterSpacing: "-0.03em" }}>
        {name}
      </span>
    </div>
  )
}

const inUseMotion = `
  @keyframes in-use-line {
    ${OG_HOLD} { transform: scaleX(1); }
    36% { transform: scaleX(0.12); }
  }
  @keyframes in-use-reply {
    ${OG_HOLD} { opacity: 1; transform: translateY(0px); }
    30%, 52% { opacity: 0; transform: translateY(10px); }
  }
  @keyframes in-use-send {
    ${OG_HOLD} { transform: scale(1); }
    28%, 36% { transform: scale(0.82); }
  }
`

function InUseScene({ copy, themeCss }: OgSceneProps): ReactElement {
  return (
    <Stage themeCss={themeCss} motionCss={inUseMotion}>
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: 900,
            display: "flex",
            flexDirection: "column",
            padding: "40px 48px 36px",
            borderRadius: 28,
            backgroundColor: "var(--color-kumo-elevated)",
            border: "1px solid var(--color-kumo-line)",
            boxShadow: "0 24px 70px var(--color-kumo-shadow-drop)",
          }}
        >
          <Lockup name={copy.brandName} />
          <span
            style={{
              marginTop: 36,
              fontSize: 40,
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: "-0.035em",
            }}
          >
            {copy.placeholder}
          </span>
          <div
            style={{
              width: 220,
              height: 6,
              marginTop: 22,
              borderRadius: 99,
              backgroundColor: "var(--color-kumo-brand)",
              transformOrigin: "left center",
              animation: loopAnimation("in-use-line"),
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 32,
            }}
          >
            <span
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "var(--color-kumo-brand)",
                animation: loopAnimation("in-use-reply"),
              }}
            >
              {copy.preparingAgent}
            </span>
            <div
              style={{
                width: 64,
                height: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 99,
                backgroundColor: "var(--color-kumo-brand)",
                animation: loopAnimation("in-use-send"),
              }}
            >
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: "9px solid transparent",
                  borderRight: "9px solid transparent",
                  borderBottom: "15px solid var(--color-kumo-canvas)",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </Stage>
  )
}

function smokeOrb(
  color: string,
  left: number,
  top: number,
  size: number,
  name: string,
): ReactElement {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: size,
        height: size,
        borderRadius: 999,
        backgroundImage: `radial-gradient(circle at 40% 40%, ${color} 0%, transparent 68%)`,
        filter: "blur(18px)",
        animation: loopAnimation(name),
      }}
    />
  )
}

const heroMotion = `
  @keyframes smoke-a {
    ${OG_HOLD} { transform: translate(0px, 0px); }
    40% { transform: translate(84px, -28px); }
    70% { transform: translate(-36px, 30px); }
  }
  @keyframes smoke-b {
    ${OG_HOLD} { transform: translate(0px, 0px); }
    46% { transform: translate(-78px, 22px); }
    74% { transform: translate(42px, -18px); }
  }
  @keyframes smoke-c {
    ${OG_HOLD} { transform: translate(0px, 0px) scale(1); }
    52% { transform: translate(20px, 16px) scale(1.16); }
  }
  @keyframes smoke-fill {
    ${OG_HOLD} { background-position: 20% 40%; }
    50% { background-position: 80% 60%; }
  }
`

function HeroSmokeScene({ copy, themeCss }: OgSceneProps): ReactElement {
  const [blue, bright, white] = copy.smokeColors

  return (
    <Stage themeCss={themeCss} motionCss={heroMotion}>
      {smokeOrb(blue, 280, -30, 540, "smoke-a")}
      {smokeOrb(bright, 560, 20, 420, "smoke-b")}
      {smokeOrb(blue, 430, 70, 260, "smoke-c")}
      <div
        style={{
          position: "absolute",
          left: 450,
          top: 48,
          width: 300,
          height: 300,
          backgroundImage: `radial-gradient(circle at 32% 28%, ${white} 0%, transparent 26%), radial-gradient(circle at 68% 64%, ${bright} 0%, transparent 42%), linear-gradient(165deg, ${bright}, ${blue})`,
          backgroundSize: "180% 180%",
          maskImage: "url(solzero-logo-mask)",
          maskSize: "contain",
          maskRepeat: "no-repeat",
          maskPosition: "center",
          animation: loopAnimation("smoke-fill"),
          zIndex: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          bottom: 58,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          zIndex: 3,
        }}
      >
        <span style={{ fontSize: 64, fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1 }}>
          {copy.welcome}
        </span>
        <span
          style={{
            marginTop: 16,
            fontSize: 28,
            lineHeight: 1.3,
            color: "var(--text-color-kumo-subtle)",
          }}
        >
          {copy.placeholder}
        </span>
      </div>
    </Stage>
  )
}

const doneMotion = `
  @keyframes done-glow {
    ${OG_HOLD} { transform: scale(1); opacity: 0.45; }
    48% { transform: scale(1.28); opacity: 0.85; }
    72% { transform: scale(1.04); opacity: 0.3; }
  }
  @keyframes done-mark {
    ${OG_HOLD} { transform: scale(1); }
    42% { transform: scale(1.08); }
    68% { transform: scale(0.98); }
  }
`

function DoneScene({ copy, themeCss }: OgSceneProps): ReactElement {
  return (
    <Stage themeCss={themeCss} motionCss={doneMotion}>
      <div
        style={{
          position: "absolute",
          left: 330,
          top: 70,
          width: 540,
          height: 540,
          borderRadius: 999,
          backgroundImage: "radial-gradient(circle, var(--color-kumo-success) 0%, transparent 68%)",
          filter: "blur(8px)",
          animation: loopAnimation("done-glow"),
        }}
      />
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
        }}
      >
        <div
          style={{
            width: 92,
            height: 92,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 99,
            backgroundColor: "var(--color-kumo-success)",
            animation: loopAnimation("done-mark"),
          }}
        >
          <div
            style={{
              width: 22,
              height: 40,
              marginTop: -6,
              borderRight: "7px solid var(--color-kumo-canvas)",
              borderBottom: "7px solid var(--color-kumo-canvas)",
              transform: "rotate(45deg)",
            }}
          />
        </div>
        <span
          style={{
            marginTop: 28,
            fontSize: 132,
            fontWeight: 700,
            lineHeight: 0.9,
            letterSpacing: "-0.05em",
          }}
        >
          Done.
        </span>
        <span
          style={{
            marginTop: 22,
            fontSize: 32,
            color: "var(--text-color-kumo-subtle)",
          }}
        >
          {copy.tagline}
        </span>
      </div>
    </Stage>
  )
}

const beatMotion = `
  @keyframes beat-0 {
    0%, 6%, 94%, 100% { opacity: 1; }
    24%, 78% { opacity: 0; }
  }
  @keyframes beat-1 {
    0%, 28%, 52%, 100% { opacity: 0; }
    32%, 46% { opacity: 1; }
  }
  @keyframes beat-2 {
    0%, 56%, 84%, 100% { opacity: 0; }
    60%, 76% { opacity: 1; }
  }
  @keyframes beat-dot-0 {
    0%, 6%, 94%, 100% { transform: scale(1); background-color: var(--color-kumo-brand); }
    24%, 78% { transform: scale(0.72); background-color: var(--color-kumo-line); }
  }
  @keyframes beat-dot-1 {
    0%, 28%, 52%, 100% { transform: scale(0.72); background-color: var(--color-kumo-line); }
    32%, 46% { transform: scale(1); background-color: var(--color-kumo-brand); }
  }
  @keyframes beat-dot-2 {
    0%, 56%, 84%, 100% { transform: scale(0.72); background-color: var(--color-kumo-line); }
    60%, 76% { transform: scale(1); background-color: var(--color-kumo-brand); }
  }
`

function ThreeBeatsScene({ copy, themeCss }: OgSceneProps): ReactElement {
  return (
    <Stage themeCss={themeCss} motionCss={beatMotion}>
      <div style={{ position: "absolute", left: 64, top: 52, zIndex: 2 }}>
        <Lockup name={copy.brandName} size={44} />
      </div>
      {copy.beats.map((beat, index) => (
        <div
          key={beat}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: loopAnimation(`beat-${index}`),
          }}
        >
          <span
            style={{ fontSize: 148, fontWeight: 700, letterSpacing: "-0.055em", lineHeight: 1 }}
          >
            {beat}
          </span>
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 58,
          display: "flex",
          justifyContent: "center",
          gap: 16,
          zIndex: 2,
        }}
      >
        {copy.beats.map((beat, index) => (
          <div
            key={`${beat}-dot`}
            style={{
              width: 18,
              height: 18,
              borderRadius: 99,
              animation: loopAnimation(`beat-dot-${index}`),
            }}
          />
        ))}
      </div>
    </Stage>
  )
}

const surfaceMotion = `
  @keyframes surface-0 {
    ${OG_HOLD} { opacity: 1; transform: translateY(0px); }
    32%, 74% { opacity: 0; transform: translateY(-18px); }
  }
  @keyframes surface-1 {
    ${OG_HOLD}, 26%, 60% { opacity: 0; transform: translateY(18px); }
    36%, 52% { opacity: 1; transform: translateY(0px); }
  }
  @keyframes surface-2 {
    ${OG_HOLD}, 52% { opacity: 0; transform: translateY(18px); }
    64%, 82% { opacity: 1; transform: translateY(0px); }
  }
`

function SurfacesScene({ copy, themeCss }: OgSceneProps): ReactElement {
  return (
    <Stage themeCss={themeCss} motionCss={surfaceMotion}>
      <div style={{ display: "flex", flex: 1 }}>
        <div
          style={{
            width: 520,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "64px 48px 64px 72px",
          }}
        >
          <Lockup name={copy.brandName} />
          <span
            style={{ fontSize: 58, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.045em" }}
          >
            {copy.tagline}
          </span>
        </div>
        <div style={{ width: 1, margin: "64px 0", backgroundColor: "var(--color-kumo-line)" }} />
        <div style={{ position: "relative", flex: 1 }}>
          {copy.surfaces.map((surface, index) => (
            <div
              key={surface}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                paddingLeft: 56,
                animation: loopAnimation(`surface-${index}`),
              }}
            >
              <span
                style={{
                  fontSize: 84,
                  fontWeight: 700,
                  letterSpacing: "-0.05em",
                  lineHeight: 0.95,
                }}
              >
                {surface}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Stage>
  )
}

const workflowMotion = `
  @keyframes workflow-lap {
    0%, 6% { offset-distance: 0%; }
    94%, 100% { offset-distance: 100%; }
  }
`

const WORKFLOW_TRACK = { left: 360, top: 248, width: 700, height: 210 }

function WorkflowScene({ copy, themeCss }: OgSceneProps): ReactElement {
  const [webhook, agent, approval, email] = copy.stops

  return (
    <Stage themeCss={themeCss} motionCss={workflowMotion}>
      <div style={{ position: "absolute", left: 72, top: 48 }}>
        <Lockup name={copy.brandName} size={40} />
      </div>
      <span
        style={{
          position: "absolute",
          left: 72,
          top: 112,
          fontSize: 42,
          fontWeight: 700,
          letterSpacing: "-0.04em",
        }}
      >
        {copy.workflowTitle}
      </span>
      <div
        style={{
          position: "absolute",
          left: WORKFLOW_TRACK.left,
          top: WORKFLOW_TRACK.top,
          width: WORKFLOW_TRACK.width,
          height: WORKFLOW_TRACK.height,
          border: "2px solid var(--color-kumo-line)",
        }}
      />
      <span style={stopStyle(WORKFLOW_TRACK.left, WORKFLOW_TRACK.top - 52)}>{webhook}</span>
      <span
        style={stopStyle(
          WORKFLOW_TRACK.left + WORKFLOW_TRACK.width - 320,
          WORKFLOW_TRACK.top - 52,
          "right",
        )}
      >
        {agent}
      </span>
      <span
        style={stopStyle(
          WORKFLOW_TRACK.left + WORKFLOW_TRACK.width - 320,
          WORKFLOW_TRACK.top + WORKFLOW_TRACK.height + 18,
          "right",
        )}
      >
        {approval}
      </span>
      <span style={stopStyle(WORKFLOW_TRACK.left, WORKFLOW_TRACK.top + WORKFLOW_TRACK.height + 18)}>
        {email}
      </span>
      <div
        style={{
          position: "absolute",
          left: WORKFLOW_TRACK.left - 11,
          top: WORKFLOW_TRACK.top - 11,
          width: 22,
          height: 22,
          borderRadius: 99,
          backgroundColor: "var(--color-kumo-brand)",
          boxShadow: "0 0 16px var(--color-kumo-brand)",
          offsetPath: `path('M 11 11 L ${WORKFLOW_TRACK.width + 11} 11 L ${WORKFLOW_TRACK.width + 11} ${WORKFLOW_TRACK.height + 11} L 11 ${WORKFLOW_TRACK.height + 11} Z')`,
          offsetRotate: "0deg",
          animation: loopAnimation("workflow-lap"),
          zIndex: 2,
        }}
      />
    </Stage>
  )
}

function stopStyle(left: number, top: number, align: "left" | "right" = "left"): CSSProperties {
  return {
    position: "absolute",
    left,
    top,
    width: 320,
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: "-0.03em",
    textAlign: align,
  }
}

const MARK_PANES = [
  { left: 0, top: 0, shiftX: 0, shiftY: 0 },
  { left: 0.5, top: 0, shiftX: -0.5, shiftY: 0 },
  { left: 0.5, top: 0.5, shiftX: -0.5, shiftY: -0.5 },
  { left: 0, top: 0.5, shiftX: 0, shiftY: -0.5 },
] as const

function MarkScene({ copy, markCss, offsets, themeCss }: OgSceneProps): ReactElement {
  return (
    <Stage themeCss={themeCss} motionCss={markCss}>
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", width: MARK_SIZE, height: MARK_SIZE }}>
          {offsets.map((offset, index) => {
            const pane = MARK_PANES[index]

            if (!pane) return null

            return (
              <div
                key={`${offset.offsetX}-${offset.offsetY}`}
                style={{
                  position: "absolute",
                  left: pane.left * MARK_SIZE,
                  top: pane.top * MARK_SIZE,
                  width: MARK_SIZE / 2,
                  height: MARK_SIZE / 2,
                  overflow: "hidden",
                  animation: loopAnimation(`mark-piece-${index}`),
                }}
              >
                <img
                  src="solzero-logo"
                  width={MARK_SIZE}
                  height={MARK_SIZE}
                  style={{
                    position: "absolute",
                    left: pane.shiftX * MARK_SIZE,
                    top: pane.shiftY * MARK_SIZE,
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ position: "absolute", left: 64, bottom: 48 }}>
        <Lockup name={copy.brandName} />
      </div>
    </Stage>
  )
}

export const ogConcepts = [
  { id: "in-use", name: "In use", Scene: InUseScene },
  { id: "hero-smoke", name: "Landing smoke", Scene: HeroSmokeScene },
  { id: "done", name: "Done", Scene: DoneScene },
  { id: "three-beats", name: "Chat, build, automate", Scene: ThreeBeatsScene },
  { id: "surfaces", name: "Agents, workflows, bots", Scene: SurfacesScene },
  { id: "workflow", name: "Workflow loop", Scene: WorkflowScene },
  { id: "mark", name: "The mark", Scene: MarkScene },
] as const

export type OgConceptId = (typeof ogConcepts)[number]["id"]
