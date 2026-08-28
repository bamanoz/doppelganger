const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*\S{8,}/i,
]

const RECURSIVE_BLOCKS: readonly RegExp[] = [
  /<!--\s*doppelganger:start\s*-->[\s\S]*?<!--\s*doppelganger:end\s*-->/giu,
  /\[Doppelganger (?:Context|Memory)[^\]]*\][\s\S]*?(?=\n\n|$)/giu,
  /\[Memory (?:decision|fact|preference|procedure);[^\]]*\]\s*[^\n]*(?:\n[^\n]*)?/giu,
]

export function containsMemorySecret(content: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(content))
}

export function stripRecursiveMemoryContent(content: string): string {
  for (const pattern of RECURSIVE_BLOCKS) content = content.replace(pattern, '')
  return content.trim()
}
