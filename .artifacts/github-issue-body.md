### Description

`/compact` can fail before summarization starts for large restored sessions because the compaction request itself is larger than the selected model's context window.

In the reproduced case, the stored session is not already compacted and has a large amount of historical tool output and reasoning metadata. When `/compact` prepares the summarization request, the request includes enough historical payload that the provider rejects it with a context-length error rather than producing a summary.

Observed error class/message locally was equivalent to:

```text
Session too large to compact - context exceeds model limit even after stripping media
```

or, from the provider:

```text
This model's maximum context length is 400000 tokens. However, your messages resulted in more tokens than this model supports.
```

I have an anonymized SQLite database fixture that reproduces the problem without real project/customer/message content. GitHub CLI cannot upload issue attachments, so I will attach `opencode-compact-large-session-repro.db.gz` to this issue manually after creation.

Fixture details:

- Session ID: `ses_2fa010245ffew9MZDGHCeeCEsP`
- Messages: `794`
- Parts: `3924`
- Part JSON bytes: about `34.6 MB`
- Compressed DB attachment size: about `932 KB`
- Compressed DB SHA256: `add0dde02f0f5e0442d222c5e81aaae9353c81a6436c67197e5346b08f4fde6a`
- Content anonymization: text, tool output, file content, reasoning text, encrypted reasoning content, tool inputs, dynamic diagnostic keys, project names, paths, and events are replaced with placeholders/tokens while preserving payload shape and approximate string sizes.

Verification from a local harness with no provider API call:

```json
{
  "mode": "legacy-measure",
  "result": "overflow",
  "measuredTokens": 788327,
  "measuredBytes": 3153309,
  "beforeMessages": 794,
  "overflowDetected": true
}
```

The same artifact on a local fixed branch, using adaptive compaction request sizing, successfully compacts:

```json
{
  "mode": "fixed",
  "result": "continue",
  "measuredTokens": 308291,
  "measuredBytes": 1233163,
  "beforeMessages": 794,
  "afterMessages": 796,
  "compacted": true,
  "overflowDetected": false
}
```

Related issues that appear adjacent but do not include a concrete anonymized DB fixture: #17340 and #26707.

### Plugins

Not required to reproduce with the artifact. The verification harness uses a fake processor and no provider API call.

### OpenCode version

Current dev / `1.15.12` era before the local fix. The local fixed branch reports `0.0.0-fix/compact-large-sessions-202605290813`.

### Steps to reproduce

1. Download the attached `opencode-compact-large-session-repro.db.gz` artifact.
2. Decompress it:

```sh
gunzip -k opencode-compact-large-session-repro.db.gz
```

3. Start OpenCode with the decompressed database:

```sh
OPENCODE_DB=/absolute/path/to/opencode-compact-large-session-repro.db opencode
```

4. Open session `ses_2fa010245ffew9MZDGHCeeCEsP`.
5. Run `/compact`.

Expected: OpenCode should prepare a summarization request safely below the selected model's usable input budget and compact the session.

Actual before the fix: `/compact` prepares an oversized summarization request and fails with a context-length error before a summary can be produced.

### Screenshot and/or share link

An anonymized DB fixture should be attached to this issue: `opencode-compact-large-session-repro.db.gz`.

### Operating System

Linux x64

### Terminal

OpenCode TUI / CLI
