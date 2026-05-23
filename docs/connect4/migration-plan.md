# Connect4 Phase 1 Migration + Rollback Plan

## Forward migration (v2 -> v3 challenge shape)

- Source store: `p4s_challenges_v2` localStorage map.
- Transformation:
  - Add `mode: 'ASYNC'` to legacy rows that do not define mode.
  - Add `phase: 'COMPLETE'` when `status` is `COMPLETE` and phase is absent.
- Trigger:
  - Performed lazily in `loadChallenges()` with write-back when migrated payload differs.

## Connect4 match-state persistence

- New store key: `p4s_connect4_match_states_v1`.
- Schema:
  - keyed by challenge code/id
  - `boardState`, append-only `moves`, `phase`, `startedAt`, `endedAt`.

## Rollback plan (v3 -> v2)

- Use `rollbackChallengesToV2()` to strip v3 fields:
  - `mode`, `phase`, outcome/ready/turn metadata, settlement metadata.
- Preserve v2-compatible fields unchanged.

## Migration validation on seeded local data

- Seeded challenge rows without `mode` and `phase` are normalized on first `loadChallenges()`.
- Completed seeded challenges receive `phase: COMPLETE`.
- Non-completed seeded challenges retain backward-compatible `status` behavior.
