# pi-modular-soul

Keep a SOUL in one Markdown document. Pi reads its always-loaded sections and this conversation's selected optional modules before **every model request**, including requests within a tool loop. Catalogue reads also read the file directly. There is no startup catalogue or modification-time cache.

Requires Node 22.18+ and Pi 1.5.2+ (`@earendil-works/pi-coding-agent`). Uses normal Pi extensions in the TUI, RPC, and SDK. MIT licensed. No separate server, database, account system, or document editor.

## Install and configure

```sh
pi install git:github.com/aristath/pi-modular-soul
```

A local checkout also works: `npm install` inside it, then `pi install /path/to/pi-modular-soul`. Pi records the package registration in its settings. Restart Pi or use `/reload` after installing or changing configuration. File-content edits need neither.

Add the following to `~/.pi/agent/settings.json` (or the workspace's `.pi/settings.json`):

```json
{
  "modularSoul": {
    "defaultSoul": "studio",
    "souls": {
      "studio": "~/identities/studio.md",
      "research": "~/identities/research.md"
    }
  }
}
```

The names and files are examples. Keep real documents and deployment settings outside this public package. Paths may be absolute, start with `~/`, or be relative to the Pi workspace. Configuration is JSON; no environment variables are needed. Remove any other SOUL loader's package registration to avoid loading two identities.

New sessions bind to `defaultSoul` and start with no optional modules selected. Without a default, no SOUL is injected until a trusted user/host selects one. A saved session keeps its own binding even if the global default changes. Missing configured files never cause a fallback to another user's document.

User commands (available through Pi's usual command handling):

```text
/soul                 Show the effective selection
/soul list            List configured SOUL names
/soul research        Select research and reset optional modules
```

The initial CLI flag `pi --soul research` selects a named SOUL only when there is no saved binding. It never overrides a resumed chat. Only configured names are accepted; chat text and model names do not select identities. These commands are trusted user actions; the model's tools cannot choose another profile. The name `list` is reserved for the listing command (hosts can still bind it explicitly).

`pi --soul none` disables this package for that process, including SOUL content,
loading instructions, tools, and `/soul`. It takes precedence over a saved
session selection. Saved selections and configuration are left intact; starting
Pi again without the flag restores normal SOUL behavior. `none` is reserved in
the CLI flag for this purpose.

## Author a document

See the complete, fictional [example](examples/SOUL.md). Each section starts with a YAML block bounded by lines containing `---`:

```markdown
---
module: core
description: The essential identity.
always_load: true
---

You are a fictional studio assistant. Be clear and honest about uncertainty.

---
module: creativity
description: Activate when creating illustrations or other media.
---

Explore several visual directions before choosing one.

---
module: communication
description: Activate when explaining complicated ideas.
---

Use concrete examples and explain unfamiliar terms.
```

Authoring rules:

1. `module` is a unique, nonempty, single-line string. Keep it stable; tools and saved selections use this identifier. Quote YAML-sensitive values. Surrounding identifier whitespace is trimmed.
2. `description` is optional text describing when to activate the section. It is returned in the live catalogue, without the body.
3. `always_load` is a boolean, default `false`. `true` includes the section automatically and excludes it from the selectable catalogue. Boolean strings `"true"` and `"false"` are also accepted. There is no `hidden` setting; unrecognized metadata has no effect.
4. Everything after a header until the next module header is that module's body. Bodies retain their original text, ordering, and newlines; no summarization. Keep any necessary separator/newline in the authored body. Text before the first module header is always included, unchanged.
5. Ordinary Markdown horizontal rules and ordinary YAML frontmatter without a `module` key remain authored text. Metadata examples in fenced backtick/tilde code blocks are literal body text. Only unfenced YAML blocks with a top-level `module` key define sections. Use fenced code for literal examples of section metadata.
6. Duplicate identifiers, invalid YAML in module headers, missing closing delimiters, invalid metadata types, and a header starting with malformed `module identifier` produce a safe error. Diagnostic messages never quote document text. Do not work around an error by loading the entire file. Fix the header; the next request retries automatically.
7. Add a section by appending its complete header and body. Change a body or description in place. Remove a section by removing its header and body. Removing selected identifiers makes their old text disappear; the saved flags remain available if those identifiers return. Renaming an identifier requires selecting the new identifier.

If the file defines **no modules**, the whole file is loaded **as-is**, including ordinary frontmatter, BOM, and CRLF/CR/LF newlines. No conversion is required. Plain files have an empty catalogue. A malformed modular file is an error, never a reason to expose all optional bodies.

## Agent tools

The agent receives small loading instructions and tools with the installed README path. It can read this README with its normal file-reading tools before authoring sections. This package provides no editing tools.

```javascript
get_soul_catalogue({})
// Current optional identifiers/descriptions, selected source path and format.
// Always-loaded sections and all section bodies are excluded.

load_soul({"modules":["creativity","communication"]})
// The COMPLETE optional selection, replacing the previous one.

load_soul({"modules":["communication"]})
// Unloads creativity.

load_soul({"modules":[]})
// Only always-loaded sections and preamble remain.
```

Selections are deduplicated and loaded in document order. Always-loaded identifiers may be supplied but are not stored as optional flags. An unavailable identifier rejects the entire selection change and returns `changed:false`, the effective selection, and `unavailable` identifiers. A successful result confirms `modules`, `always_loaded`, and `changed:true`. Read failures return an error without claiming success or changing flags. Catalogue errors are explicit; an old catalogue is never returned as current.

Read the catalogue again when needed. New sections and descriptions are available immediately. Newly added always-loaded sections appear automatically. Editing an inactive section never activates it. The next provider request sees current core/active text, including changes made during a tool loop. Already-submitted requests are not changed or cancelled.

## Sessions and trusted hosts

The package appends native custom entries of type `pi-modular-soul:selection`:

```json
{"version":1,"soul":"studio","modules":["creativity"]}
```

It reads the latest entry on the **active branch**. It stores no document bodies or catalogues in those entries. Restart, resume, chat switching, tree navigation, fork, and compaction retain the state appropriate to the selected branch. Different conversations have independent optional flags. SOUL bodies are projected into each request's system sections, not appended to canonical chat history. Unloading removes loader-supplied text without deleting ordinary messages, tool results, legitimate quotations, or other extensions' sections. A model may still remember content it explicitly quoted into the conversation; the loader does not rewrite that history.

For a multi-user SDK host, authenticate the user in the host, map that trusted identity to a configured SOUL name, and bind it **before initializing extensions**:

```javascript
import { SessionManager, createAgentSession } from '@earendil-works/pi-coding-agent';
import { bindSoul, readSelection } from 'pi-modular-soul/state';

// The host supplies workspace, agentDir, sessionsDir and authenticatedSoulName.
const manager = SessionManager.create(workspace, sessionsDir);
bindSoul(manager, authenticatedSoulName); // optional third argument: module IDs
const { session } = await createAgentSession({
  cwd: workspace, agentDir, sessionManager: manager
});
await session.bindExtensions({ mode: 'rpc' });
```

For resuming, open the native session and check `readSelection(manager)` against the authenticated user's authorization before exposing it. Do not blindly rebind every request: that would reset module flags. A session's metadata is not an access-control system. Hosts must isolate/authorize session files, settings, and permitted file tools. Do not let arbitrary model/user content supply a file path or authenticated user identity. Hosts that create private/background conversations can copy the SOUL identifier into a new binding with `modules:[]`, then let that new conversation choose its own modules.

## Live loading and recovery

Every request attempts a fresh read and parse. Within a running extension instance, the most recently readable document is retained **only for recovery**, scoped to the selected SOUL name and configured path. During a transient read/parse failure the previous usable text is composed with the current flags, a warning is emitted, and the next request retries. No other profile is substituted. Healthy reads immediately replace the recovery snapshot. Successful removal of a module removes its old body even if the old flags remain.

Snapshots are in memory only: a first read failure after restarting has no saved identity text to recover. Pi continues with an explicit unavailable-SOUL notice and no substituted identity. Fix the configured file/permissions; the next request loads it automatically. Selection metadata is retained. Session startup clears recovery snapshots to keep conversations isolated.

The package reserves only system section keys `pi_modular_soul` and `pi_modular_soul_usage`. It preserves Pi's other prompt sections and tools. It also supports an extension's `forceSystemPrompt` while adding the live SOUL. Correct live loading can rebuild provider input and affect prompt-cache hits; no cache preservation is promised.

## Troubleshooting and development

Warnings contain safe error descriptions without source snippets. Check `/soul`, the configured name/path, file permissions, and YAML headers. `get_soul_catalogue` reads the actual file on each call; a failed read never returns a stale catalogue. Unknown stored module IDs remain stored but contribute no body until available again. Correct malformed metadata instead of removing a privacy boundary.

Source-path mapping changes require Pi settings reload; document-content changes do not. If no SOUL appears, confirm this package is registered and the default/name exists. Check that an SDK host bound extensions and that its tool allowlist includes `get_soul_catalogue` and `load_soul`. Remove competing SOUL loaders. No model provider or service endpoint is bundled.

```sh
npm ci
npm test
npm pack --dry-run
```

Tests use fictional documents, isolated Pi configuration, actual SDK sessions, and controlled provider streams. No live inference is used.
