# /compact fails on large restored sessions before summarization

## Summary

Running `/compact` on a large restored session can exceed the model context window before compaction starts. The request payload includes historical tool outputs and reasoning metadata, so the summarization request itself can be larger than the target model accepts.

## Reproducer Artifact

Attached artifact: `opencode-compact-large-session-repro.db.gz`

The database contains one anonymized session:

- Session ID: `ses_2fa010245ffew9MZDGHCeeCEsP`
- Messages: `794`
- Parts: `3924`
- Part JSON bytes: approximately `34.6 MB`
- Original content was replaced with placeholders while preserving payload shape and approximate string sizes.

## Reproduction Steps

1. Decompress the artifact:

```sh
gunzip -k opencode-compact-large-session-repro.db.gz
```

2. Start OpenCode using the decompressed DB:

```sh
OPENCODE_DB=/absolute/path/to/opencode-compact-large-session-repro.db opencode
```

3. Open session `ses_2fa010245ffew9MZDGHCeeCEsP`.

4. Run `/compact`.

## Expected Result

OpenCode should summarize and compact the session, or reduce the compaction request to a size safely under the selected model's usable input budget.

## Actual Result

Before the fix, `/compact` sends an oversized summarization request and fails with a model context-length error similar to:

```text
This model's maximum context length is 400000 tokens. However, your messages resulted in more tokens than this model supports.
```

## Cause Observed Locally

The failing request was dominated by historical message content, especially tool outputs and reasoning metadata. A prior diagnostic run on a similar session showed an estimated payload over the model budget before provider/system overhead was included.

## Privacy Notes

The included DB is anonymized:

- Session/project names and paths are synthetic.
- Text, tool output, file content, reasoning text, encrypted reasoning content, tool inputs, dynamic diagnostic keys, and events are replaced with placeholders/tokens.
- IDs and timestamps are retained because they are needed for session ordering and relationships.
- A keyword scan found no matches for project/customer/path terms used by the source session. Remaining matches for words like `time`/`tokens` are schema-field false positives.

## Verification

The artifact was verified with a local harness that runs the compaction path with a fake processor, so no provider API call is made.

Legacy payload measurement, matching the pre-fix behavior of passing full tool output/reasoning/media through to compaction:

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

Fixed branch behavior, with adaptive tool-output truncation and stripped reasoning/media:

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

## Candidate Fix Direction

- Strip reasoning metadata from compaction input.
- Strip media/data URLs from compaction input.
- Truncate or omit historical tool output according to the selected model's usable input budget.
- Treat `0` as a valid tool-output truncation limit rather than disabling truncation.
