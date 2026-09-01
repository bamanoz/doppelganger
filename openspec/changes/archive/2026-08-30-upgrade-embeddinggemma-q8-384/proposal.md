## Why

The current multilingual EmbeddingGemma profile truncates its 768-dimensional output to 256 dimensions and uses q4 weights, while the existing runtime already supports q8 loading and arbitrary Matryoshka output widths. Moving the default profile to pinned q8 weights with 384 normalized dimensions aligns it with the established MiniLM-shaped backend configuration without adding Python, sidecars, services, or packages.

## What Changes

- Change the existing `embeddinggemma-300m` local profile from q4 to pinned q8 ONNX artifacts.
- Change its declared projection from normalized 256-dimensional Matryoshka truncation to normalized 384-dimensional truncation.
- Preserve the current query/document preprocessing, lazy Transformers.js runtime, cache validation, accelerator fallback, and explicit separation between embedding generation and vector storage.
- Update the development semantic Runtime Preset and documented SQLite exact, Chroma, Qdrant, and pgvector examples to require 384 dimensions.
- Rebuild semantic projections into a new generation rather than mixing or copying existing 256-dimensional vectors.
- Compare q4/256 and q8/384 on the existing Russian/English retrieval benchmark and record quality, latency, cold-start, memory, and index-size evidence.
- Keep MiniLM as an explicit compatibility profile and keep SQLite exact as the local default backend; vector backend selection remains independent of embedder selection.
- **BREAKING**: existing EmbeddingGemma 256-dimensional semantic generations are incompatible with the new default identity and require a full derived-index rebuild before semantic activation can switch to q8/384.
- Retain the current trusted-pinned-artifact deployment restriction; this change does not claim to resolve the reviewed Transformers.js/ONNX transitive advisories.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memory-semantic-indexes`: change the required default local multilingual EmbeddingGemma identity to pinned q8 weights and normalized 384-dimensional Matryoshka output, while preserving backend-independent explicit vectors and generation-safe rebuild behavior.

## Impact

- `packages/extension-embedding-local`: model identity, pinned artifact manifest, cache validation fixtures, and output-size expectations.
- `packages/extension-memory-vectors`: conformance and end-to-end fixtures that currently assume 256-dimensional EmbeddingGemma vectors; backend implementations remain dimension-parameterized.
- `dev/doppelganger/.runtime-presets/aiden-semantic`: vector-index dimension configuration and first activation rebuild.
- `openspec/specs/memory-semantic-indexes`, README, semantic-memory operations guidance, and audit/security wording that names the 256-dimensional profile.
- Existing canonical memory, revisions, FTS5 state, tools, host transport, package boundaries, and backend selection contracts remain unchanged.
