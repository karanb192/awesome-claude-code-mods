# Examples

Minimal mods kept here so the list has something runnable to point at. The scanner skips this folder on purpose (paths under `examples/` are classified as fixtures), so nothing here appears in the tables.

## hello-mod

Three files. Validate it, then load it for one session:

```sh
cd examples/hello-mod
claude plugin validate .claude-plugin/plugin.json
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .
```

The validator prints the footprint before anything runs:

```
❯ ./register.ts hooks: session.start, tool.call{tool=Bash}
❯ ./register.ts calls: $.ui.log
```

Then the transcript shows `hello-mod loaded in <cwd>` on start, and `rm -rf /` in a Bash call is refused with the message from the hook. Everything else passes through `next(e)` untouched.
