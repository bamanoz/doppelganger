## MODIFIED Requirements

### Requirement: Session isolation
Each runtime session SHALL have an independent plugin tree and SHALL NOT share mutable plugin objects, handlers, lifecycle fibers, or feature metadata with another session.

#### Scenario: Concurrent sessions for one Runtime Preset
- **WHEN** the same Runtime Preset is activated in two concurrent host sessions
- **THEN** each activation receives an independent plugin tree and shares data only through storage explicitly configured by composed plugins

## REMOVED Requirements

### Requirement: Scoped activation metadata
**Reason:** The requirement assigns instance, project, and instance-home concepts to the generic runtime. The implemented Runtime Preset architecture limits runtime-owned metadata to stable host session ID, selected Runtime Preset ID, and optional absolute workspace root; all feature metadata is extension-owned.

**Migration:** Consumers SHALL use Runtime Session metadata for `sessionId`, Runtime Preset ID, and optional workspace root. Persona or other domain extensions SHALL mount their own immutable activation metadata for instance, principal, project, identity, traits, storage, or other feature concepts.
