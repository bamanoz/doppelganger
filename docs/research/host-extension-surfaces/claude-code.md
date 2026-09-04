# Claude Code host-extension surface

Claude Code's plugin surface is a declarative, file-and-process-mediated format. It packages Markdown prompts and metadata, JSON hook and MCP configuration, and optional local state; the host discovers those files, starts external processes, composes prompts, and owns permissions and session lifecycle. This record is static source research, not a live Claude Code execution report.

## Snapshot

| Field | Value |
|---|---|
| Repository | [`anthropics/claude-code`](https://github.com/anthropics/claude-code) |
| Exact commit | `aef74afe01f65b602258d6102b0da9730ac6f0aa` |
| Research date | 2026-09-03 |
| Support status | Researched, not implemented |

## Native extension model

A plugin has a required `.claude-plugin/plugin.json` manifest and may add root-level `commands/`, `agents/`, `skills/`, and `hooks/` directories plus a root `.mcp.json`. The manifest's `name` is required; metadata such as version, description, author, and repository is recommended. Component paths can be customized, but custom paths supplement rather than replace the conventional directories, and paths are relative to the plugin root. This is packaging and discovery metadata, not an in-process extension object model.

### Commands and skills

Commands are Markdown files interpreted as prompts when a user invokes a slash command. YAML frontmatter can describe the command, constrain `allowed-tools`, select a model, document an `argument-hint`, and set `disable-model-invocation`. The command body is therefore prompt content, while the host supplies invocation and tool execution.

Skills are also auto-discovered plugin assets under `skills/`; the plugin inventory describes them as reusable guidance that Claude can invoke for matching work. The checkout documents skills primarily as Markdown guidance rather than as callbacks with a typed host API.

### Agents

Agents are Markdown-defined autonomous subprocesses, distinct from user-invoked commands. Required frontmatter includes an identifier and a description explaining triggering conditions; optional frontmatter constrains tools and model. The Markdown body becomes the agent's system prompt. Files in `agents/` are auto-discovered and are automatically namespaced, including `plugin:subdir:agent-name` for nested paths.

### Hooks

Plugin hooks use `hooks/hooks.json` with an outer object containing a `hooks` map; user settings use the direct event map without that wrapper. Hook handlers may be prompt-based or command-based. The documented event set includes `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `SessionStart`, `SessionEnd`, `PreCompact`, and `Notification`. Hook processes receive JSON on stdin and return structured JSON or use documented exit codes.

## Context and prompt composition

`SessionStart` is the closest native context injection point: its output can add context to the default system prompt, and a command hook can persist environment variables through `$CLAUDE_ENV_FILE`. The host's distinction matters: SessionStart adds to the default system prompt, whereas subagents change the system prompt. This makes a SessionStart hook suitable for additive bootstrap context, not replacement of the host's complete system prompt or a proof that every request receives a freshly computed context snapshot.

`UserPromptSubmit` can observe and validate submitted user input, and `PreCompact` can contribute information before compaction. Neither source establishes a general per-request context-provider contract with a typed context object, ordering guarantee, or commit semantics.

## Tools and provider integration

MCP servers may be bundled through `.mcp.json` or declared inline under `mcpServers` in `plugin.json`. The documented transports include local stdio child processes and hosted SSE, HTTP, and WebSocket endpoints. Claude Code manages a stdio process's stdin/stdout lifetime and terminates it when Claude Code exits; hosted transports may use OAuth, with first-use prompting and host-managed tokens.

MCP tools are namespaced as `mcp__plugin_<plugin-name>_<server-name>__<tool-name>`. Commands can pre-allow exact namespaced tools through `allowed-tools`, with a wildcard option explicitly described as less secure. This is a useful sidecar bridge for exposing portable tools, but the host still controls discovery, naming, authorization, and transport lifecycle. The source does not document an extension operation that atomically replaces a tool definition during an active request.

## Approval and interaction

`PreToolUse` runs before a tool and can return `permissionDecision` `allow`, `deny`, or `ask`, plus `updatedInput` and a system message. `Stop` and `SubagentStop` can return `approve` or `block` decisions with a reason. Standard hook output also has `continue`, `suppressOutput`, and `systemMessage`, while exit code 2 feeds stderr back to Claude as a blocking error. These are meaningful approval and completion gates, but they are host-mediated hook decisions rather than a portable approval object or a guarantee that all provider calls pass through one hook.

## Lifecycle

The hook event vocabulary provides boundaries around tool calls, user prompts, session start/end, compaction, notifications, and main-agent or subagent stopping. `SessionEnd` is documented for cleanup, logging, and state preservation; `PreCompact` is for preserving critical context. The changelog also records distinct background sessions, agent views, subagent transcripts, prompt-cache behavior, and cross-session messaging. Those entries demonstrate host lifecycle concepts, but the plugin contract does not expose a portable committed-turn event or a callback that can observe and finalize every logical turn exactly once.

## Scope, state, reload, and trust

### Scope and state

Hook input includes `session_id`, `transcript_path`, `cwd`, `permission_mode`, and `hook_event_name`, with additional event-specific fields. This gives a hook process useful identifiers and filesystem context, but not a documented stable in-process session object. Plugin-local state follows `.claude/plugin-name.local.md`: YAML frontmatter plus Markdown body, read by hooks, commands, and agents, user-managed, and intended to be gitignored. The settings guidance says ordinary changes require restarting Claude Code.

### Reload boundaries

Plugin structure and discovery are session-start/plugin-enable concerns; the plugin-dev guidance says changes take effect on the next Claude Code session. The hookify plugin is a narrow exception: its `.local.md` rule files are read on the next tool use, and toggling `enabled` or deleting a rule takes effect without restart. Changelog entries separately record `.claude/` settings created after startup requiring restart and MCP reconnect/enable being checked against settings and managed policy. These are not evidence of universal hot reload or exact active-session tool replacement.

### Trust and sandbox

Managed settings can block marketplaces, user/project permission rules, and user/project hooks; enterprise-only properties include `allowManagedHooksOnly` and `allowManagedPermissionRulesOnly`. Bash sandboxing applies only to the Bash tool, not Read, Write, WebSearch, WebFetch, MCPs, hooks, or internal commands. The changelog records stricter handling for unsafe `.mcp.json` filesystem objects and managed MCP lockdown. Security-guidance further states that review data (diff paths, hunks, relevant contents, and files read during review) is sent to a configured model endpoint, and labels findings best-effort with no warranty. An adapter must therefore treat hooks and MCP processes as privileged host-controlled boundaries, with explicit data-disclosure and policy implications.

## Doppelganger adapter fit

A practical partial adapter could package portable prompt modules as Claude commands or skills, map portable subagent specifications to Markdown agents, subscribe to lifecycle checks through hooks, and expose portable tools through an MCP sidecar. `SessionStart` can inject additive bootstrap material; `PreToolUse` can mediate selected tool approvals; `Stop`/`SubagentStop` can perform completion checks. Project-scoped configuration can live in a plugin-local state file, with the adapter respecting Claude Code's restart boundary and managed policy.

This adapter fit is intentionally limited. Hooks plus an MCP sidecar cannot currently prove per-request context delivery: SessionStart and prompt hooks provide event-oriented text, not a host-independent context-provider protocol with request identity and ordering guarantees. They cannot prove exact hot tool replacement: MCP discovery and reconnect are host-owned, while ordinary plugin/settings changes are restart-bound and only hookify rules are documented as hot-read. They cannot prove committed-turn lifecycle parity: Stop and SubagentStop are stop decisions, not a portable committed-turn transaction or exactly-once commit notification. Host-specific UI, provider routing, OAuth, and packaging behavior should remain in the Claude adapter rather than the portable core.

## Compatibility gaps

- No general in-process plugin object model or typed extension SDK is evidenced by this checkout; the native seam is files, subprocesses, and host configuration.
- SessionStart context is additive to the default system prompt. It cannot replace or fully inspect the host-composed system prompt.
- Hook stdin exposes identifiers and paths, but the source does not establish a per-request context API, complete request trace, or ordering across all model/provider operations.
- MCP supports external tools and several transports, but host namespacing, allowlists, OAuth, reconnect, and process shutdown remain host-specific.
- Hook approval decisions cover selected tool and stop events; they do not establish a uniform approval protocol for every action or a portable transaction boundary.
- Ordinary plugin and local-settings changes are restart-bound. Hookify's next-tool-use rule reload is a specialized exception, not a universal reload contract.
- Claude's main/background/session/agent/subagent distinctions and prompt-cache behavior do not map directly to a single portable committed-turn lifecycle.
- Sandbox and managed-policy scope is uneven: Bash sandboxing does not cover MCPs, hooks, or several other tools, and enterprise policy may disable user/project hooks or permission rules.
- Security-guidance demonstrates that a plugin can transmit diffs and related file contents to a configured model endpoint; data handling must be explicit in any adapter policy.

## Source evidence

All paths below are repository-relative spans in the pinned checkout; line numbers were verified directly against that checkout.

| Claim | Path | Symbol | Lines |
|---|---|---|---|
| Plugins extend Claude Code with commands, agents, hooks, and MCP servers | `plugins/README.md` | Overview | 3, 7 |
| Standard plugin layout includes manifest and component roots | `plugins/README.md` | Plugin Structure | 47-60 |
| Manifest must be in `.claude-plugin/`; components stay at plugin root | `plugins/plugin-dev/skills/plugin-structure/SKILL.md` | Critical rules | 39-44 |
| `plugin.json` requires `name` and supports metadata | `plugins/plugin-dev/skills/plugin-structure/SKILL.md` | Plugin Manifest | 46-84 |
| Custom paths supplement defaults and are root-relative | `plugins/plugin-dev/skills/plugin-structure/SKILL.md` | Component Path Configuration | 86-106 |
| Commands are Markdown prompts executed during interactive sessions | `plugins/plugin-dev/skills/command-development/SKILL.md` | Overview / Command Basics | 9-25 |
| Command frontmatter controls tools and model | `plugins/plugin-dev/skills/command-development/SKILL.md` | `allowed-tools` / `model` | 112-160 |
| Command frontmatter documents invocation and arguments | `plugins/plugin-dev/skills/command-development/SKILL.md` | `argument-hint` / `disable-model-invocation` | 164-193 |
| Agents are autonomous subprocesses distinct from commands | `plugins/plugin-dev/skills/agent-development/SKILL.md` | Overview | 9-18 |
| Agent description defines triggering conditions and examples | `plugins/plugin-dev/skills/agent-development/SKILL.md` | `description` | 82-90 |
| Agent body becomes its system prompt | `plugins/plugin-dev/skills/agent-development/SKILL.md` | System Prompt Design | 162-164 |
| Agent Markdown files are auto-discovered and namespaced | `plugins/plugin-dev/skills/agent-development/SKILL.md` | Plugin Agents Directory / Namespacing | 289-305 |
| Plugin hook configuration wraps events under `hooks` | `plugins/plugin-dev/skills/hook-development/SKILL.md` | Plugin hooks.json Format | 60-100 |
| PreToolUse can allow, deny, ask, and update input | `plugins/plugin-dev/skills/hook-development/SKILL.md` | PreToolUse output | 121-153 |
| Stop decisions can approve or block stopping | `plugins/plugin-dev/skills/hook-development/SKILL.md` | Stop decision output | 181-208 |
| Lifecycle event vocabulary includes tool, prompt, session, compact, and stop events | `plugins/plugin-dev/skills/hook-development/SKILL.md` | Hook Events Summary | 630-644 |
| SessionStart can persist environment variables | `plugins/plugin-dev/skills/hook-development/SKILL.md` | SessionStart | 238-264 |
| SessionEnd and PreCompact have cleanup/preservation roles | `plugins/plugin-dev/skills/hook-development/SKILL.md` | SessionEnd / PreCompact | 266-276 |
| Hooks receive session and working-directory context via JSON stdin | `plugins/plugin-dev/skills/hook-development/SKILL.md` | Hook Input Format | 300-312 |
| MCP can be bundled in `.mcp.json` or inline `mcpServers` | `plugins/plugin-dev/skills/mcp-integration/SKILL.md` | Configuration Methods | 19-59 |
| MCP supports stdio, SSE, HTTP, and WebSocket forms | `plugins/plugin-dev/skills/mcp-integration/SKILL.md` | MCP Server Types | 65-147 |
| Claude Code manages local MCP child process lifetime | `plugins/plugin-dev/skills/mcp-integration/SKILL.md` | stdio Process management | 90-93 |
| MCP tools are namespaced and can be pre-allowed | `plugins/plugin-dev/skills/mcp-integration/SKILL.md` | MCP Tool Naming / Commands | 190-222 |
| Plugin local state uses `.claude/*.local.md` and is user-managed | `plugins/plugin-dev/skills/plugin-settings/SKILL.md` | Overview | 7-18 |
| Ordinary plugin settings changes require restart | `plugins/plugin-dev/skills/plugin-settings/SKILL.md` | Restart Requirement | 367-380 |
| Hookify rules apply on the next tool use without restart | `plugins/hookify/README.md` | Quick Start | 18-35 |
| Hookify rules can be toggled or deleted as local files | `plugins/hookify/README.md` | Management | 261-281 |
| SessionStart adds to default prompt while subagents change system prompt | `plugins/explanatory-output-style/README.md` | Migration from Output Styles | 53-63 |
| Managed settings can block hooks and permission rules | `examples/settings/README.md` | Configuration Examples | 13-21 |
| Bash sandbox does not apply to MCPs, hooks, or internal commands | `examples/settings/README.md` | Tips | 23-27 |
| Settings created after startup may require restart; MCP and managed policy affect reconnect | `CHANGELOG.md` | Settings/MCP fixes | 18-19, 40-43 |
| Background sessions and subagent transcript/token semantics are host concerns | `CHANGELOG.md` | Session/subagent fixes | 21-24, 37, 44, 61-63 |
| Security guidance transmits diffs and related contents to a model endpoint | `plugins/security-guidance/README.md` | Privacy and data handling | 85-94 |
| Security guidance is best-effort and not a substitute for review or scanning | `plugins/security-guidance/README.md` | Limitations | 96-98 |
