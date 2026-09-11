# Agent Workflow (Simplified)

Purpose: provide one consistent process for safe project updates.

## Standard update flow

1. Understand scope first.
   - Identify whether change is in API flow, auth/security, data/integration, or docs.
2. Read local context.
   - Check nearby code and docs before editing.
3. Trace the full flow.
   - For API work: route -> controller -> DTO -> service -> DB/integration.
4. Make minimal, high-confidence changes.
   - Keep existing patterns and naming unless there is a strong reason to change.
5. Validate.
   - `npm run lint`
   - `npm test`
   - `npm run build`
6. Update docs in the same change.
   - Especially `docs/**` and `.agents/**` when process/structure changes.
7. Final report.
   - Include: what you found, what changed, how to verify, remaining risks.

## Simplified explanation

Read first, change small, test the exact area, then update docs.

## Guardrails

- Do not break endpoint contracts without explicitly documenting it.
- Do not commit secrets or local auth tokens.
- Do not remove existing behavior unless the change request requires it.
