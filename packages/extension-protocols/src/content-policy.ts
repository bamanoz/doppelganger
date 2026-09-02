const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*\S{8,}/i,
]

export function containsCredentialMaterial(content: string): boolean {
  return CREDENTIAL_PATTERNS.some(pattern => pattern.test(content))
}
