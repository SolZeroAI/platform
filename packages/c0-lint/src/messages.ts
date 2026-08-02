import type { C0RuleName } from "./rule-names.ts"

export const messages: Record<C0RuleName, string> = {
  "max-file-lines":
    "Rule: keep authored files at or below 1000 lines. Why: oversized files hide ownership boundaries and slow review. Fix: split the file into logical modules, components, services, or utilities.",
  "no-if-statement":
    "Rule: avoid imperative if branching. Why: it hides control flow in Effect code. Fix: use Option.match/Either.match/Match.value or data combinators, then run one Effect pipeline.",
  "no-ternary":
    "Rule: avoid ternary branching. Why: it hides decisions inside expressions. Fix: use Option.match/Either.match/Match.value or compute a named value before running one flat Effect pipeline.",
  "no-pipe-ladder":
    "Rule: avoid nested pipe() chains. Why: they hide sequencing. Fix: refactor into one flat pipeline with a single decision point.",
  "no-flatmap-ladder":
    "Rule: avoid nested Effect.flatMap. Why: it hides sequencing and pushes laddered control flow. Fix: build context once (Effect.all/Effect.map) and run a single flatMap.",
  "no-effect-ladder":
    "Rule: avoid nested Effect combinators. Why: they hide sequencing and create laddered control flow. Fix: build context once (Effect.all/Effect.map) and then run a single flat pipeline.",
  "no-effect-call-in-effect-arg":
    "Rule: avoid Effect calls nested as arguments (Effect.xx(Effect.yy(...))). Why: it hides sequencing. Fix: build the inner Effect first, then use pipe/Effect.flatMap/Effect.andThen to keep a single flat pipeline.",
  "no-nested-effect-call":
    "Rule: avoid deeply nested Effect calls (Effect.xx(Effect.yy(Effect.zz(...)))). Why: they hide sequencing and spread flow. Fix: build values first, then run one flat Effect pipeline.",
  "no-effect-as":
    "Rule: avoid Effect.as. Why: it hides sequencing and turns effects into placeholders. Fix: use Effect.map for value mapping or Effect.asVoid after explicit pipeline steps.",
  "no-call-tower":
    "Rule: avoid nested Effect call towers (Effect.fn(Effect.fn(...))). Why: it hides sequencing. Fix: build the inner Effect first, then use pipe/Effect.flatMap/Effect.andThen for a single flat pipeline.",
  "no-option-as":
    "Rule: avoid Option.as. Why: it hides selection and encourages placeholder flows. Fix: use Option.map or Option.match and return the value explicitly.",
  "no-arrow-ladder":
    "Rule: avoid nested IIFEs. Why: they hide sequencing and push wrapper hacks. Fix: bind a named context with const and keep one flat pipeline with a single Match/Option decision.",
  "no-branch-in-object":
    "Rule: avoid Match/Option/Either inside object literals. Why: it hides the decision and invites workaround scaffolding. Fix: compute the value first, then build the object from named values with one flat decision.",
  "no-iife-wrapper":
    "Rule: avoid immediate invocation of inline functions. Why: it hides decisions and sequencing. Fix: bind a named context with const and keep one Match/Option decision in a flat pipeline.",
  "no-return-in-arrow":
    "Rule: avoid block-bodied arrow callbacks with returns. Why: they hide local control flow. Fix: use expression-only callbacks and move the logic into a single pipeline (pipe/Match/Option/A.map).",
  "no-effect-never":
    "Rule: avoid Effect.never. Why: it hides lifecycle and leaks resources. Fix: use Stream or explicit acquire/release lifecycles with clear teardown.",
  "no-effect-async":
    "Rule: avoid Effect.async. Why: callback-style wiring hides lifecycle and escapes declarative flow. Fix: use Stream or structured Effect lifecycles (acquire/use/release).",
  "no-effect-do":
    "Rule: avoid Effect.Do. Why: it pushes Effect code toward imperative builder choreography. Fix: use one flat pipe-based Effect flow or one direct top-level Effect.gen with direct yields, not nested generators or wrapper helpers.",
  "no-effect-bind":
    "Rule: avoid Effect.bind. Why: it hides sequencing inside builder-style accumulation. Fix: use one flat pipe-based Effect flow or one direct top-level Effect.gen with direct yields, not nested generators or wrapper helpers.",
  "no-nested-effect-gen":
    "Rule: avoid nested Effect.gen. Why: nested generators hide sequencing. Fix: flatten to a single Effect.gen per method or a single flat pipeline.",
  "no-match-void-branch":
    "Rule: avoid void Match branches. Why: they hide guard-style control flow. Fix: remove the no-op branch or select a value and run one Effect pipeline outside the Match.",
  "no-match-effect-branch":
    "Rule: avoid multi-step sequencing inside Match/Option branches. Why: it hides control flow. Fix: select a value in Match/Option, then run one Effect pipeline outside.",
  "warn-effect-sync-wrapper":
    "Rule: avoid Effect.sync around side effects. Why: it hides intent. Fix: use Effect.log* or an explicit pipeline step for the side effect.",
  "no-effect-side-effect-wrapper":
    "Rule: avoid Effect.as/Effect.zipRight for side effects. Why: they hide side effects and discard values. Fix: use explicit pipeline steps that return real values (Effect.flatMap/andThen/tap).",
  "no-effect-orElse-ladder":
    "Rule: avoid Effect.orElse around sequencing chains. Why: it hides error handling and splits the flow. Fix: move error handling to a single terminal decision after the pipeline.",
  "no-return-in-callback":
    "Rule: avoid return statements in callbacks. Why: they hide local control flow. Fix: use expression callbacks or move the branch into a named value before the Effect pipeline.",
  "no-manual-effect-channels":
    "Rule: avoid manual Effect channel tuples (`Effect.Effect<...>` / `Layer.Layer<...>`). Why: channels compose through the Effect pipeline and services; hand-written tuples desync from the real flow. Fix: drop the generic and let the return type infer from the Effect/Layer you return.",
  "prevent-dynamic-imports":
    "Rule: avoid dynamic module imports. Why: they hide dependencies and control flow behind deferred module loading, which makes code paths harder to read and verify. Fix: use static module imports so module dependencies stay explicit at the file boundary.",
  "prefer-option-over-null":
    "Rule: avoid nullable return/local types in Effect-bearing code. Why: nullable unions hide absence in plain TypeScript control flow. Fix: return Option.Option<T> and branch with Option.match, Option.map, or Option.flatMap.",
  "avoid-untagged-errors":
    "Rule: avoid bare Error values in recoverable Effect failure channels. Why: untagged errors cannot be handled precisely with catchTag/catchTags. Fix: use Schema.TaggedErrorClass for API errors, Data.TaggedError for internal Effect errors, or Effect.die for unrecoverable defects.",
  "use-effect-otel":
    "Rule: use Effect OTEL-aware logging for C0 API/Worker/server observability. Why: raw console bypasses Effect logs, spans, and Cloudflare Observability collection. Fix: use Effect.log*, Effect.withSpan, or request telemetry helpers.",
}
