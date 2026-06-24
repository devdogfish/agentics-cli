# ADR 001: Supported Tools Are Internal Capability

## Status

Accepted

## Context

Jawfish supports a fixed set of tool adapters. Earlier config exposed
`allowedTools`, but users cannot make an unsupported tool work by editing config.
The option created false control and extra failure modes.

## Decision

Remove user-facing `allowedTools`. Keep `supportedTools` as internal business
logic. Validate `defaultTool`, `JAWFISH_DEFAULT_TOOL`, and manifest tool values
against `supportedTools`.

## Consequences

Users configure `defaultTool`, not tool capability. Unsupported injected values
fail with an error listing supported tools.

