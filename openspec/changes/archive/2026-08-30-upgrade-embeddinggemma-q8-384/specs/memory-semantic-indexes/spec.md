## MODIFIED Requirements

### Requirement: Local multilingual embedding is available
The local embedder plugin SHALL provide a pinned multilingual EmbeddingGemma 300M configuration using the repository's verified q8 ONNX artifact set with normalized 384-dimensional output produced by truncating the model's 768-dimensional sentence embedding to the supported 384-dimensional Matryoshka width and re-normalizing it. It SHALL provide 384-dimensional all-MiniLM-L6-v2 only as an explicit compatibility selection. Accelerator unavailability SHALL fall back to CPU without changing vector-space identity. The selected EmbeddingGemma artifact paths, byte sizes, SHA-256 values, model revision, artifact digest, pooling, projection, dimensions, normalization, and cosine metric SHALL be immutable and covered by contract tests.

#### Scenario: New multilingual configuration is selected
- **WHEN** a preset configures the default local multilingual model
- **THEN** Russian and English document and query text are embedded in the same declared q8/384 vector space, every returned vector has 384 dimensions, and every returned vector is L2-normalized

#### Scenario: q8 artifacts are selected
- **WHEN** the EmbeddingGemma model is acquired from the pinned revision
- **THEN** the loader requests q8 execution and validates the q8 artifact set by exact path, byte count, and SHA-256 before publishing the runtime

#### Scenario: Legacy q4/256 cache is present
- **WHEN** a cache contains only the prior q4 artifacts or the configured artifact metadata does not match q8
- **THEN** acquisition does not treat that cache as a valid q8/384 runtime and reports the existing offline or corrupt-cache diagnostic according to cache availability

#### Scenario: MiniLM compatibility is selected
- **WHEN** a preset explicitly selects all-MiniLM-L6-v2
- **THEN** the generation identity records MiniLM and no existing EmbeddingGemma generation is reused

#### Scenario: Requested accelerator is unavailable
- **WHEN** the configured execution accelerator cannot be loaded
- **THEN** embedding falls back to CPU with a diagnostic and preserves the same q8/384 model-space identity

### Requirement: Semantic generations rebuild without mixed vector spaces
A rebuild or backend/model change SHALL populate a new isolated generation from deterministic pages of canonical current eligible revisions, verify it, and switch the local active-generation pointer only after successful completion. Changing EmbeddingGemma from q4/256 to q8/384 SHALL always produce a distinct generation identity. The coordinator SHALL rebuild from canonical memory and SHALL NOT copy, reinterpret, resize, or query vectors from the incompatible q4/256 generation. Failure SHALL leave the previous generation active.

#### Scenario: q8/384 rebuild succeeds
- **WHEN** the configured EmbeddingGemma identity changes from q4/256 to q8/384 and every canonical active revision is projected and generation verification passes
- **THEN** the q8/384 generation becomes active atomically, the q4/256 generation remains isolated as retained or failed historical state, and semantic queries use only q8/384 vectors

#### Scenario: q8/384 rebuild is interrupted
- **WHEN** q8/384 embedding or backend writing fails before generation verification
- **THEN** searches continue using the previous q4/256 generation and do not query the incomplete q8/384 generation

#### Scenario: Backend selection changes with q8/384
- **WHEN** a preset changes vector backends while q8/384 is configured
- **THEN** the selected backend is rebuilt from canonical memory using q8/384 embeddings rather than copying vectors or state from the former backend
