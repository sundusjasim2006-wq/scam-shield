# Scam Shield tests

`ground_truth.json` is a **human-written** answer key for `input_examples/case01.json`–`case12.json`. It is not agent output.

## Hold-out

`holdout/h1.json`, `h2.json`, and `h3.json` are reserved.

**Hold-out cases must never be used while tuning prompts.** Do not read them to tweak wording, few-shot examples, or scoring rules. Score them only after the agent is frozen.

Their human labels live in `holdout_truth.json`, separate from the tuning set.
