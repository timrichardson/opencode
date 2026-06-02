### Issue for this PR

Closes #29857

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

Prevents `/compact` from creating a summarization request that is larger than the selected model's usable context budget.

The compaction path now:

- strips reasoning parts from compaction input
- strips media from compaction input as before
- adapts retained tool output size to the model budget
- treats `toolOutputMaxChars: 0` as a real truncation limit

This fixes large restored sessions where the compaction request itself could overflow before a summary was produced.

### How did you verify your code works?

- `bun test test/session/message-v2.test.ts`
- `bun test test/session/compaction.test.ts`
- `bun run typecheck`
- push hook also ran repo typecheck successfully

I also verified the anonymized fixture from #29857 locally:

- legacy payload shape: `788327` estimated tokens, overflows
- fixed payload shape: `308291` estimated tokens, compacts successfully

### Screenshots / recordings

N/A

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR
