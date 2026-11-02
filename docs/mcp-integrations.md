# Native MCP integrations

Lancer loads Pi's MCP, tool-search and codemode integrations in both the runtime inventory and actual sessions. MCP configuration and sign-in remain owned by Pi: use `mcp.json` in the agent directory, or the trusted project override. `PI_CODING_AGENT_DIR` selects an isolated agent profile. No server, credential or global directory is hardcoded by the desktop host.

Tools keep Pi's exposure behavior. Deferred servers are discovered with `tool_search`; codemode servers activate the script tool as needed. Registering the codemode factory does not make the tool active in every session. MCP tool calls, including calls nested inside codemode, pass through Pi's `tool_call` hooks.

The desktop confirmation hook lets known native read/orchestration tools and MCP tools marked read-only run normally. Writes, shell commands, destructive tools and tools without a read-only annotation require a native per-call confirmation. Approval is not remembered. Without an available confirmation UI, the call is blocked. The dialog masks credential-shaped parameter fields and refuses oversized arguments instead of silently truncating what the user reviews.

This changes the previous unprompted behavior for mutating tools. The host integrations and confirmation hook are required factories, independent of optional built-in resource toggles. These hooks are not an operating-system sandbox: tool implementations run with the process's permissions, and a server's read-only annotations are trusted metadata. Review servers and extensions before enabling them.

Regression coverage checks that required factories survive optional built-in toggles, unknown/mutating calls need confirmation each time, cancellation blocks execution and credentials are masked. A synthetic stdio MCP fixture supports native read/approve/cancel proof without private services or real business writes.
