# ADRs

These documents are used for alignment within the team as well as with our
agents for big changes or features. They are reviewed adversarially by team
members and then implemented.

The ADR itself is used during implementation — it is the living working
document while the ladder ships, amended as slices land — and is committed
into `adrs/` in the **final PR** of the ladder. So `adrs/` only ever contains
shipped decisions: one file per decision, named `adrs/YYYY-MM-DD-<slug>.md`
(the decision date), opening with one-line `Description:` and `Date:` headers
(`grep 'Description:' adrs/` is the index; the date sorts it). ADRs are
EXPLICITLY NOT sources of truth (the code is), but rather sources of
decisions: approved, built against, then kept forever as the permanent why,
including the rejected options.

## High level meta process

1. Human (basically goes through the ADR one section at a time):
   1. Decides on high level feature requirements / business need
   2. Gathers context on relevant current parts of codebase
   3. Gathers context on external systems
   4. Architects new system / modification to systems as needed
   5. Architects / elucidates on explicit UX / end to end flows
   6. How to verify the feature will work long term? (tests + observability)
   7. Encodes all the above in the ADR
2. Team:
   1. Reads in depth
   2. Challenges assumptions / design
   3. Iterates as needed
3. Agent:
   1. Implements
4. Team:
   1. Reviews vertical slices + QAs

## Structure

1. **Orientation**
   1. What is this? What is it for?
   2. Goals and non-goals
   3. Requirements
      - Numbered, end to end, explicit.
      - Everything else in the document traces back to one of these.
        Extremely integral part of the doc.

2. **Current context**
   - For each of our grid cells the feature touches:
   1. What cell is it?
   2. Walk-through of the primitives involved: which we reuse, which we
      extend, which the feature contradicts (ie interfaces, endpoints, which
      distinct domains can access what).

3. **External systems / Spikes**
   - Description of external systems (harnesses, vendor APIs, protocols). We
     don't own these, so this section is looser than the rest.
   1. How the system actually behaves, at whatever depth the design depends
      on it.
   2. Where its behavior enters our system, over what channel, and what shape
      the data has when it arrives.
   3. How we verified.
   4. (Perhaps) Open questions.

4. **Design**
   1. Preferred design
      1. Description, end to end.
      2. Architecture diagram (mermaid), low level enough to show processes,
         communication surfaces, protocols, and trust boundaries.
      3. Assumptions the design depends on.
      4. Pros and cons.
   2. Alternatives, with why rejected. If nothing serious was on the table,
      one line saying why is enough.
   3. Open decisions, each with an owner and the rollout step by which it
      must close.

5. **New and modified primitives, by grid cell**
   - Per grid cell, explicitly describe new / modified:
   1. State
   2. Endpoints
   3. Classes / functions
   4. Schemas
   5. Access to other grid cells

6. **Flows**
   - For each core flow (happy path, failure and cancellation, retry and
     recovery, permission and approval, migration and compatibility, as they
     apply):
   1. Numbered hops / flow end to end
   2. Mermaid sequence diagram when helpful
   3. Link to Claude Design where helpful / relevant

7. **Failure modes, tests, observability**
   1. For each failure mode:
      1. Detection. Cloud: a named alert on existing monitoring, with
         failure-rate and latency thresholds where latency matters. Runtime:
         a loud structured error with a named code, a counter, or an
         invariant sweep.
      2. Test. Which tier 1–4 test covers it (per
         [`specs/engineering/testing/standard.md`](../../specs/engineering/testing/standard.md)), naming any contract
         fixture.
   2. Regression coverage for existing behavior the feature could break.
   3. New dashboards (cloud only): what they plot and the threshold that
      alerts.

8. **High level sequencing**
   1. The PR ladder, in order. Each entry: scope, gate (flag or policy
      default), and how it reverts. Each entry becomes one frozen delivery
      spec.
   2. Which canonical docs get updated, and in which PR.

9. **Appendix**
   - Links: investigation write-ups, prior ADRs, canonical docs, Claude
     Design.
