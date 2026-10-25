# brain-dump-to-tickets

Turn a messy brain-dump of notes - meeting scribbles, a Slack thread, a voice-to-text ramble - into structured tickets with a title, type, priority, estimate, and acceptance criteria. No more manually pasting your notes into ChatGPT and asking it to "turn this into tickets" one paragraph at a time.

## Why

Every planning session produces a wall of unstructured text: bug reports, feature ideas, and chores all mixed together in one note. Someone then has to manually split that into individual tickets, guess the type and priority, and write acceptance criteria - usually by pasting the whole thing into an AI chat and copying the answer back out by hand. This tool automates that conversion into a file you can act on directly.

## Quick start

```bash
node index.js example/sample-braindump.txt
```

This reads the brain-dump, splits it into one ticket per paragraph/bullet, and writes `tickets.md` and `tickets.csv` next to the input file.

## Usage

```
node index.js <input-file> [options]

Options:
  --out <dir>   Output directory (default: same directory as the input file)
  --ai          Polish tickets with Claude (requires ANTHROPIC_API_KEY env var)
  --help        Show help
```

### How it splits and classifies

- **Chunking:** blank lines and bullet markers (`-`, `*`, `1.`) separate one ticket from the next.
- **Type:** `bug` if it mentions crashes/errors/broken behavior, `chore` if it mentions refactors/cleanup/docs/deps, otherwise `feature`.
- **Priority:** `high` for urgent/asap/critical/blocker language, `low` for "nice to have"/"someday"/"low priority", otherwise `medium`.
- **Estimate:** a rough T-shirt size (`XS`/`S`/`M`/`L`) based on how much text describes the item.
- **Acceptance criteria:** sentences containing "should", "must", "needs to", "when...then", etc. are pulled out as checklist items; if none are found, a generic fallback criterion is used.

This is all done with plain heuristics - no API calls, no dependencies, works completely offline.

### Optional AI polish

Pass `--ai` with `ANTHROPIC_API_KEY` set in your environment to have Claude rewrite titles, tighten descriptions, and sharpen acceptance criteria into something closer to what a PM would write by hand:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node index.js notes.txt --ai
```

If the key is missing or the API call fails for any reason, the tool automatically falls back to the heuristic output above - `--ai` is never required for normal use.

## Output

- `tickets.md` - human-readable Markdown with a checklist of acceptance criteria per ticket.
- `tickets.csv` - columns `Title, Description, Type, Priority, Estimate, Labels, Acceptance Criteria`, ready to import into Jira, Linear, or GitHub Projects' CSV importer.

## Example

Input (`example/sample-braindump.txt`):

```
Export button on the reports page crashes when the date range is more than 90 days. Users should be able to export up to a full year without errors. This is urgent since finance needs it for month-end close.
```

Output ticket:

- **Title:** Export button on the reports page crashes when the date range is more than 90 days
- **Type:** bug | **Priority:** high | **Estimate:** S
- **Acceptance Criteria:**
  - Export button on the reports page crashes when the date range is more than 90 days.
  - Users should be able to export up to a full year without errors.

## License

MIT
