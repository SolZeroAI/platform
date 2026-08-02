import type { NodeLike } from "./types.ts"

const effectHandlerMethods = new Set([
  "async",
  "gen",
  "promise",
  "suspend",
  "sync",
  "try",
  "tryPromise",
])

export function isNode(value: unknown): value is NodeLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  )
}

export function isNodeType(node: unknown, type: string): node is NodeLike {
  return isNode(node) && node.type === type
}

export function nodeValue(node: NodeLike, key: string): unknown {
  return node[key]
}

export function nodeChild(node: NodeLike, key: string): NodeLike | undefined {
  const value = nodeValue(node, key)
  return isNode(value) ? value : undefined
}

export function nodeChildren(node: NodeLike, key: string): NodeLike[] {
  const value = nodeValue(node, key)
  return Array.isArray(value) ? value.filter(isNode) : []
}

export function parentNode(node: NodeLike): NodeLike | undefined {
  const parent = nodeValue(node, "parent")
  return isNode(parent) ? parent : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function literalValue(node: NodeLike | undefined): unknown {
  if (!node) {
    return undefined
  }
  return nodeValue(node, "value")
}

export function identifierName(node: NodeLike | undefined): string | undefined {
  if (!node) {
    return undefined
  }
  return readString(nodeValue(node, "name")) ?? readString(nodeValue(node, "value"))
}

export function unwrapExpression(node: NodeLike | undefined): NodeLike | undefined {
  let current = node
  while (current) {
    const expression = nodeChild(current, "expression")
    if (
      current.type === "ChainExpression" ||
      current.type === "ParenthesizedExpression" ||
      current.type === "TSInstantiationExpression" ||
      current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "TSTypeAssertion"
    ) {
      current = expression
      continue
    }
    return current
  }
  return undefined
}

function childNodes(node: NodeLike): NodeLike[] {
  const children: NodeLike[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "loc" || key === "range" || key === "start" || key === "end") {
      continue
    }
    if (isNode(value)) {
      children.push(value)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          children.push(item)
        }
      }
    }
  }
  return children
}

export function findDescendant(
  node: NodeLike | undefined,
  predicate: (candidate: NodeLike) => boolean,
  options: { skipRoot?: boolean } = {},
): NodeLike | undefined {
  if (!node) {
    return undefined
  }
  const stack = options.skipRoot ? childNodes(node) : [node]
  const seen = new Set<NodeLike>()
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || seen.has(current)) {
      continue
    }
    seen.add(current)
    if (predicate(current)) {
      return current
    }
    stack.push(...childNodes(current))
  }
  return undefined
}

function matchingDescendants(
  node: NodeLike | undefined,
  predicate: (candidate: NodeLike) => boolean,
  options: { skipRoot?: boolean } = {},
): NodeLike[] {
  if (!node) {
    return []
  }
  const matches: NodeLike[] = []
  const stack = options.skipRoot ? childNodes(node) : [node]
  const seen = new Set<NodeLike>()
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || seen.has(current)) {
      continue
    }
    seen.add(current)
    if (predicate(current)) {
      matches.push(current)
    }
    stack.push(...childNodes(current))
  }
  return matches
}

export function containsNode(
  node: NodeLike | undefined,
  predicate: (candidate: NodeLike) => boolean,
): boolean {
  return findDescendant(node, predicate) !== undefined
}

export function memberParts(node: NodeLike | undefined): string[] | undefined {
  const current = unwrapExpression(node)
  if (!current) {
    return undefined
  }
  const currentType = current.type as string
  if (
    currentType === "Identifier" ||
    currentType === "IdentifierReference" ||
    currentType === "IdentifierName"
  ) {
    const name = identifierName(current)
    return name ? [name] : undefined
  }
  if (
    currentType !== "MemberExpression" &&
    currentType !== "StaticMemberExpression" &&
    currentType !== "ComputedMemberExpression"
  ) {
    return undefined
  }
  const objectParts = memberParts(nodeChild(current, "object"))
  const property = nodeChild(current, "property") ?? nodeChild(current, "expression")
  const propertyName = identifierName(property)
  if (!objectParts || !propertyName) {
    return undefined
  }
  return [...objectParts, propertyName]
}

export function callArguments(node: NodeLike): NodeLike[] {
  return nodeChildren(node, "arguments")
}

export function callee(node: NodeLike): NodeLike | undefined {
  return nodeChild(node, "callee")
}

export function isCallExpression(node: NodeLike | undefined): node is NodeLike {
  return isNodeType(unwrapExpression(node), "CallExpression")
}

export function isCallTo(
  node: NodeLike | undefined,
  objectName: string,
  methodName?: string,
): boolean {
  const call = unwrapExpression(node)
  if (!isCallExpression(call)) {
    return false
  }
  const parts = memberParts(callee(call))
  if (!parts || parts[0] !== objectName) {
    return false
  }
  return methodName === undefined || parts.at(-1) === methodName
}

function isIdentifierCall(node: NodeLike | undefined, name: string): boolean {
  const call = unwrapExpression(node)
  if (!isCallExpression(call)) {
    return false
  }
  return identifierName(unwrapExpression(callee(call))) === name
}

export function isPipeCall(node: NodeLike | undefined): boolean {
  const call = unwrapExpression(node)
  if (!isCallExpression(call)) {
    return false
  }
  if (identifierName(unwrapExpression(callee(call))) === "pipe") {
    return true
  }
  const parts = memberParts(callee(call))
  return parts?.at(-1) === "pipe"
}

export function isEffectCall(node: NodeLike | undefined, methodName?: string): boolean {
  return isCallTo(node, "Effect", methodName)
}

export function effectCallMethod(node: NodeLike | undefined): string | undefined {
  const call = unwrapExpression(node)
  if (!isCallExpression(call)) {
    return undefined
  }
  const parts = memberParts(callee(call))
  return parts?.[0] === "Effect" ? parts.at(-1) : undefined
}

export function isEffectMember(node: NodeLike | undefined, methodName: string): boolean {
  const parts = memberParts(node)
  return parts?.[0] === "Effect" && parts.at(-1) === methodName
}

export function isConsoleAccess(node: NodeLike | undefined): boolean {
  return memberParts(node)?.[0] === "console"
}

export function hasEffectCall(node: NodeLike | undefined, methodName?: string): boolean {
  return containsNode(node, (candidate) => isEffectCall(candidate, methodName))
}

export function firstNestedEffectCall(node: NodeLike): NodeLike | undefined {
  return findDescendant(node, (candidate) => candidate !== node && isEffectCall(candidate), {
    skipRoot: true,
  })
}

function isInlineFunction(node: NodeLike | undefined): boolean {
  const current = unwrapExpression(node)
  return (
    current?.type === "ArrowFunctionExpression" ||
    current?.type === "FunctionExpression" ||
    current?.type === "FunctionDeclaration"
  )
}

export function isIife(node: NodeLike | undefined): boolean {
  const call = unwrapExpression(node)
  return isCallExpression(call) && isInlineFunction(callee(call))
}

export function functionBody(node: NodeLike | undefined): NodeLike | undefined {
  const current = unwrapExpression(node)
  return current ? nodeChild(current, "body") : undefined
}

export function returnStatements(node: NodeLike | undefined): NodeLike[] {
  const statements: NodeLike[] = []
  findDescendant(node, (candidate) => {
    if (candidate.type === "ReturnStatement") {
      statements.push(candidate)
    }
    return false
  })
  return statements
}

export function parentCall(node: NodeLike): NodeLike | undefined {
  let current: NodeLike | undefined = node
  while (current) {
    current = parentNode(current)
    if (current?.type === "CallExpression") {
      return current
    }
  }
  return undefined
}

export function isSchemaFilterCall(node: NodeLike | undefined): boolean {
  if (!isCallExpression(node)) {
    return false
  }
  return isCallTo(node, "S", "filter") || isCallTo(node, "Schema", "filter")
}

function isSideEffectCall(node: NodeLike): boolean {
  if (!isCallExpression(node)) {
    return false
  }
  if (isIdentifierCall(node, "setState") || isIdentifierCall(node, "invalidate")) {
    return true
  }
  const parts = memberParts(callee(node))
  if (!parts) {
    return false
  }
  const method = parts.at(-1)
  const object = parts.at(-2) ?? parts[0]
  return (
    (object === "Atom" && method === "set") ||
    (object === "Ref" && method === "set") ||
    (object === "SubscriptionRef" && method === "set") ||
    (object === "Reactivity" && method === "invalidate") ||
    (object === "Fiber" && method === "interrupt") ||
    (parts[0] === "Effect" && typeof method === "string" && method.startsWith("log")) ||
    parts[0] === "console"
  )
}

export function hasSideEffectCall(node: NodeLike | undefined): boolean {
  return containsNode(node, isSideEffectCall)
}

function isSequencingCall(node: NodeLike): boolean {
  if (!isCallExpression(node)) {
    return false
  }
  if (isPipeCall(node)) {
    return true
  }
  const parts = memberParts(callee(node))
  if (!parts) {
    return false
  }
  const method = parts.at(-1)
  return (
    (parts[0] === "Effect" &&
      (method === "flatMap" ||
        method === "map" ||
        method === "andThen" ||
        method === "tap" ||
        method === "zipRight")) ||
    parts[0] === "Stream"
  )
}

export function hasSequencingCall(node: NodeLike | undefined): boolean {
  if (containsNode(node, isSequencingCall)) {
    return true
  }
  if (!isInlineFunction(node)) {
    return false
  }
  return hasCallbackReturning(node, (body) => containsNode(body, isSequencingCall))
}

export function isBranchCall(node: NodeLike | undefined): boolean {
  return (
    isCallTo(node, "Option", "match") || isCallTo(node, "Either", "match") || isMatchValuePipe(node)
  )
}

export function isMatchValuePipe(node: NodeLike | undefined): boolean {
  const call = unwrapExpression(node)
  if (!call || !isPipeCall(call)) {
    return false
  }
  const callCallee = callee(call)
  const target =
    (callCallee ? nodeChild(callCallee, "object") : undefined) ?? callArguments(call)[0]
  return isCallTo(target, "Match", "value")
}

export function isEffectVoid(node: NodeLike | undefined): boolean {
  return isEffectMember(node, "void")
}

export function hasCallbackReturning(
  node: NodeLike | undefined,
  predicate: (body: NodeLike) => boolean,
): boolean {
  const body = functionBody(node)
  if (!body) {
    return false
  }
  if (body.type === "BlockStatement") {
    return returnStatements(body).some((statement) => {
      const argument = nodeChild(statement, "argument")
      return argument ? predicate(argument) : false
    })
  }
  return predicate(body)
}

export function typeNameText(node: NodeLike | undefined): string | undefined {
  const current = unwrapExpression(node)
  if (!current) {
    return undefined
  }
  const directName = identifierName(current)
  if (directName) {
    return directName
  }
  if (current.type === "TSQualifiedName") {
    const left = typeNameText(nodeChild(current, "left"))
    const right = typeNameText(nodeChild(current, "right"))
    return left && right ? `${left}.${right}` : (left ?? right)
  }
  const parts = memberParts(current)
  return parts?.join(".")
}

export function propertyKeyName(node: NodeLike | undefined): string | undefined {
  if (!node) {
    return undefined
  }
  const key = nodeChild(node, "key")
  return identifierName(key) ?? readString(literalValue(key))
}

export function propertyValue(node: NodeLike | undefined): NodeLike | undefined {
  return node ? nodeChild(node, "value") : undefined
}

function isBareErrorConstructor(node: NodeLike): boolean {
  const current = unwrapExpression(node)
  if (!current || (current.type !== "NewExpression" && current.type !== "CallExpression")) {
    return false
  }
  return identifierName(unwrapExpression(callee(current))) === "Error"
}

export function bareErrorConstructors(node: NodeLike | undefined): NodeLike[] {
  return matchingDescendants(node, isBareErrorConstructor)
}

function isEffectHandlerFunction(node: NodeLike | undefined): boolean {
  const functionNode = unwrapExpression(node)
  if (!functionNode || !isInlineFunction(functionNode)) {
    return false
  }

  const directParent = parentNode(functionNode)
  if (!directParent) {
    return false
  }

  if (isCallExpression(directParent)) {
    const method = effectCallMethod(directParent)
    return (
      method !== undefined &&
      effectHandlerMethods.has(method) &&
      callArguments(directParent).some((argument) => unwrapExpression(argument) === functionNode)
    )
  }

  const objectExpression = parentNode(directParent)
  if (!objectExpression) {
    return false
  }
  const effectCall = parentNode(objectExpression)
  if (!isCallExpression(effectCall)) {
    return false
  }

  const method = effectCallMethod(effectCall)
  return (
    (method === "try" || method === "tryPromise") &&
    callArguments(effectCall).some((argument) => argument === objectExpression) &&
    propertyValue(directParent) === functionNode &&
    (propertyKeyName(directParent) === "try" || propertyKeyName(directParent) === "catch")
  )
}

export function isInsideEffectHandler(node: NodeLike): boolean {
  let current: NodeLike | undefined = parentNode(node)
  while (current) {
    if (isEffectHandlerFunction(current)) {
      return true
    }
    current = parentNode(current)
  }
  return false
}

export function hasNullishUnionMember(node: NodeLike): boolean {
  if (node.type !== "TSUnionType") {
    return false
  }
  return nodeChildren(node, "types").some(
    (typeNode) => typeNode.type === "TSNullKeyword" || typeNode.type === "TSUndefinedKeyword",
  )
}

function isFunctionNode(node: NodeLike | undefined): boolean {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression"
  )
}

export function isNullableLocalOrReturnType(node: NodeLike): boolean {
  const annotation = parentNode(node)
  if (annotation?.type !== "TSTypeAnnotation") {
    return false
  }
  const owner = parentNode(annotation)
  if (isFunctionNode(owner)) {
    return true
  }
  if (!owner) {
    return false
  }
  return owner.type === "Identifier" && parentNode(owner)?.type === "VariableDeclarator"
}

export function isConsoleCall(node: NodeLike): boolean {
  if (!isCallExpression(node)) {
    return false
  }
  return isConsoleAccess(callee(node))
}
