# Recorded live RAG route-generation evaluation

- Model: openai/gpt-4o-mini.
- Successful route selections: 17/17.
- Deterministic contract passes: 17/17.
- Routes different from the deterministic top candidate: 15/17.
- Total tokens: 37750.
- Provider-reported cost: US$0.00602205.
- Average model-selection latency: 1738 ms.
- Latency range: 1025–3739 ms.

Every returned route was selected by the model from candidates that had already passed graph, distance and spacing constraints. The fixed template was reproduced from the selected structured result. The separate five-case human review averaged 4.60/5 for request fit and 4.40/5 for training-focus fit, with 4/5 supported selection reasons. See `ROUTE_HUMAN_REVIEW_RESULTS.md`; the one-reviewer sample does not establish model superiority.
