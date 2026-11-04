# Native MCP integrations

Lancer loads Pi's MCP, tool-search and codemode integrations in both the runtime inventory and actual sessions. MCP configuration and sign-in remain owned by Pi: use `mcp.json` in the agent directory, or the trusted project override. `PI_CODING_AGENT_DIR` selects an isolated agent profile. No server, credential or global directory is hardcoded by the desktop host.

Tools keep Pi's exposure behavior. Deferred servers are discovered with `tool_search`; codemode servers activate the script tool as needed. Registering the codemode factory does not make the tool active in every session. MCP tool calls, including calls nested inside codemode, pass through Pi's `tool_call` hooks.

The desktop confirmation hook exempts only known native inspection tools. Every
MCP tool requires approval on every call, including tools advertising `readOnlyHint:
true`. Server annotations are advisory and never grant trust. Codemode, child-thread
creation and thread messaging also require confirmation; approving codemode does not
approve the MCP calls nested inside it. Unknown tools, writes, edits and shell commands
require the same confirmation. Approval is never remembered. Without an available
confirmation UI, the call is blocked.

This intentionally changes the previous unprompted behavior for shell/edit/write and
other non-inspection tools, as well as model-triggered delegation. The confirmation
dialog follows the app language, masks credential-shaped fields and common secrets
inside string values, and refuses oversized arguments instead of silently truncating
them. Pattern masking cannot identify every possible secret; review tool arguments.

MCP, codemode and tool-search are separate optional built-ins in Skills and extensions.
Disable their switches and reload the session to remove those integrations; the same
preference applies to inventory and runtime loading. Only the confirmation hook is a
required hidden integration, so disabling an optional integration cannot disable
confirmation for the remaining tools.

These hooks are not an operating-system sandbox. Installed extensions and server
processes execute with their process permissions; review them before installation.
Regression tests cover false read-only claims, execution-wrapper confirmation,
per-call rejection, missing UI, masking and required-factory behavior. The synthetic
stdio fixture supports Electron approval/cancellation proof without private services.
