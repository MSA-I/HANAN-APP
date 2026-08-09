---
name: round
description: Open a new work round for HANAN-APP — a PLAN document, a failing test, the change, then verification. Invoke with the round's subject.
disable-model-invocation: true
---

# Opening a round

The repeated shape of work in this repo: a plan document that has to earn every claim, a test that
fails first, the change, then proof at the real UI. Follow it in order; each step's output is the
next step's input.

## 1. The plan document

Write `docs/design/PLAN-NN-<slug>.md`, Hebrew, wrapped in `<div dir="rtl">`. Take `NN` as one past
the highest existing plan in `docs/design/`.

Its governing rule, stated at the top and enforced on yourself throughout:

> **כל סעיף נשען ראיה — file:line או מדידה, לא תחושה. סעיף בלי ראיה לא נכנס.**

Sections that have earned their place:

- **מקור** — where the round came from (a user complaint, a usability run, a defect), dated.
- **מה התברר כלא נכון** — claims from the source that the code disproves, each with its
  `file:line`. Write this section *first*; it routinely removes a third of the intended work.
- The numbered items themselves, each with its evidence and its acceptance condition.

## 2. A test that fails

Before the fix, land a test that fails for the reason the round exists. Unit tests live beside
their subject as `src/**/*.test.ts` and run under `npm test` (`environment: 'node'`).

Prefer a test that pins a *measurement* — a scatter distance, an inset, a count of colliding
covers — over one that pins a call. The precedents worth copying: `presets.test.ts` records which
built-in designs collide with their own covers, and a layout that scatters by 1.4 m fails a test
rather than shipping.

Commit it on its own, so the failure is in the history.

## 3. The change

`npm test`, `npm run typecheck`, `npm run lint` — all three, in the tree you are actually in.

Before staging: `git status`. Stage **by name**, never `git add -A`. Zero-byte junk appears
continuously here, and it has emptied a tracked file.

## 4. Verification

Unit tests do not close a round that changed anything visible. Hand it to the **verify-runner**
subagent (or follow `.claude/skills/verify/SKILL.md` yourself) and record what was *seen*, with a
screenshot. A geometry, layout or sizing change also goes past **geometry-reviewer** first.

## 5. Handoff

If the round hands work on, `handoff/FOUND-NN.md` in the existing style: what was found, what was
proven, what is still open — and what the next person will get wrong if nobody tells them.

Finally, update the header of `docs/design/PROGRESS.md`: what phase this leaves the project in and
what is next in the queue.
