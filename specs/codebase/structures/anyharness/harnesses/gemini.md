# Gemini Harness

Status: authoritative for Gemini-specific AnyHarness adapter behavior.

## Live Model Control

Gemini exposes session model state through ACP `models`, not necessarily through
raw `configOptions`. AnyHarness must preserve both:

- `models.currentModelId` as the current session model id
- `models.availableModels[]` as switchable model options, including each
  option's label and description

When Gemini does not expose a raw model config option, AnyHarness synthesizes a
normalized live `model` control with `rawConfigId = "model"`. The frontend uses
that same config id for in-place model switching, and the session actor routes it
to ACP `unstable_setSessionModel`.

Do not fall back to creating a new session just because Gemini lacks a raw model
`configOptions` entry. If ACP `models` are present, in-place switching is the
canonical path.

## Preview Model Ids

Gemini preview names such as `gemini-3-pro-preview` are valid runtime model ids.
The product should display the model label supplied by ACP or the launch catalog
when possible, while still sending the exact runtime id back to Gemini for
session creation and in-place switching.
