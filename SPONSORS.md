# Sponsor technology in Scam Shield

One entry per use, with where to find it in the repository.

## Zetaris

- Runs locally in Docker. A `SCAMSHIELD` file source holds six tables registered through **Create Table → File store**: `vendors`, `payments`, `purchase_orders`, `bank_change_log`, `domain_registry`, `company_registry`.
- `scripts/zetaris_test.py`: connects over JDBC (`jdbc:zetaris:lightning@localhost:10000`) and runs `SELECT 1`.
- `scripts/zetaris_sql.py`: runs one read-only SQL statement, for example `SELECT * FROM SCAMSHIELD.vendors`.
- `scripts/zetaris_export.py`: reads all six tables through Zetaris and writes `zetaris_snapshot/*.json` with the query, row count and fetch time. Each query is logged to `logs/zetaris_trace.jsonl`.
- `src/scamshield/data.mjs`: the evidence tools load their data from that Zetaris export, and fall back to `data/` if it is missing. The source of every table is written to `logs/trace.jsonl`, with a check that it matches the local copy.
- Why Zetaris fits: the company's records live in separate systems (ERP, accounting, security, external registry), and the agents need them together to see a scam.
- Limit: the app reads an exported snapshot, not a live query per request.

## Meterless (H-MEM)

- `npm run setup` fetches the official H-MEM reference engine into `vendor/hmem`.
- The agent remembers a human-verified vendor and bank account, or a confirmed scam. A later request with a different account is caught by that memory, and the verdict cites the memory ID.
- `scripts/memory_demo.mjs` (`npm run demo-memory`): cold run, a human verifies the vendor, the same account then passes, and a changed account is held. It prints the engine's own audit trail.
- A guard stops lookalike domains from being "verified" into memory.
- The server's memory buttons store and read the same memory.
- Nightshift was not used. The Meterless requirement is met by implementing the H-MEM engine in a working feature, which the organizers confirmed is what counts, whichever model provider is used.

## NVIDIA Nemotron

- Not used. I could not get an NVIDIA API key during the build window (the account verification code never arrived). The model path in `src/scamshield/llm.mjs` can use any OpenAI-compatible endpoint, including NVIDIA's, but it has only been tested against a local mock server. All results in this repository come from offline evidence mode.

## Coding tools

- Cursor was used until its free usage limit ran out. Claude (claude.ai) was used for the rest of the code, reviews and the test data design. All code was run and tested by me on my own machine.
