# schema-form fixtures

Real, representative MCP tool **input** schemas (and a handful of synthetic edge
cases). Both a regression suite for the compiler and a record of the JSON Schema
subset that shows up in the wild — add new cases here whenever a real server
needs a runtime fix.

## `real-world-schemas/`

| File | Source server / tool |
|---|---|
| `server-everything-echo.json` | `@modelcontextprotocol/server-everything` — `echo` |
| `server-everything-add-numbers.json` | `@modelcontextprotocol/server-everything` — `add` |
| `server-everything-long-running.json` | `@modelcontextprotocol/server-everything` — long-running operation (has `default`s) |
| `server-everything-annotated-message.json` | `@modelcontextprotocol/server-everything` — annotated message (`enum`, `default` boolean) |
| `filesystem-edit-file.json` | `@modelcontextprotocol/server-filesystem` — `edit_file` (nested object array) |
| `niagaramcp-read-bql.json` | `niagaramcp` — BQL query (integer with `minimum`/`maximum`/`default`, `title`) |

## `edge-cases/`

| File | What it exercises |
|---|---|
| `additional-properties.json` | `additionalProperties: true` → `z.object().passthrough()` |
| `discriminated-oneof.json` | `oneOf` of objects with a common `const` property → discriminated union |
| `defs-ref.json` | local `$ref` into `$defs` |
| `nullable.json` | `type: ["string", "null"]` → `.nullable()` |

(Recursive `$ref`, empty `{}`, `allOf` merge, invalid `pattern`, multi-typed
values, and the `true`/`false` schemas are covered by inline cases in
`compile.test.ts`.)
