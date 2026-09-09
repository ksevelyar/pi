---
name: elixir
description: Rules for Elixir code. Use when reading, writing, or reviewing .ex or .exs files
---

* don't add comments, use semantic names instead
* don't add new @moduledoc
* don't use |> if you call just one function

## Tests
* write only functional tests (when data goes through app boundaries, like a POST endpoint creates a record and it appears in another GET endpoint), don't write unit tests
