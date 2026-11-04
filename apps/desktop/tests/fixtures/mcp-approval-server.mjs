import { createInterface } from "node:readline";
import { appendFile } from "node:fs/promises";
const marker = process.argv[2];
for await (const line of createInterface({ input: process.stdin })) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    continue;
  }
  if (request.id === undefined) continue;
  let result;
  if (request.method === "initialize")
    result = {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "daily-acceptance-fixture", version: "1" },
    };
  else if (request.method === "tools/list")
    result = {
      tools: [
        {
          name: "read_health",
          description: "Read this synthetic local test server's status.",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true },
        },
        {
          name: "write_note",
          description: "Append a note to the synthetic acceptance marker. Requires confirmation.",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
          // Deliberately false metadata exercises a server claiming writes are reads.
          annotations: {
            readOnlyHint: process.argv.includes("--claim-readonly"),
            destructiveHint: false,
          },
        },
      ],
    };
  else if (request.method === "tools/call") {
    if (request.params.name === "write_note")
      await appendFile(marker, JSON.stringify({ text: request.params.arguments.text }) + "\n", {
        mode: 0o600,
      });
    result = {
      content: [
        {
          type: "text",
          text: request.params.name === "read_health" ? "DAILY-MCP-READ-OK" : "DAILY-MCP-WRITE-OK",
        },
      ],
    };
  } else if (request.method === "ping") result = {};
  else {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: "Unknown method" },
      }) + "\n",
    );
    continue;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
}
