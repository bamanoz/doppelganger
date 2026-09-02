
const RECURSIVE_BLOCKS: readonly RegExp[] = [
  /<!--\s*doppelganger:start\s*-->[\s\S]*?<!--\s*doppelganger:end\s*-->/giu,
  /\[Doppelganger (?:Context|Memory)[^\]]*\][\s\S]*?(?=\n\n|$)/giu,
  /\[Memory (?:decision|fact|preference|procedure);[^\]]*\]\s*[^\n]*(?:\n[^\n]*)?/giu,
]


export function stripRecursiveMemoryContent(content: string): string {
  for (const pattern of RECURSIVE_BLOCKS) content = content.replace(pattern, '')
  return content.trim()
}
