#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
dotenv.config();

const GMAIL_API_KEY = process.env.GMAIL_API_KEY;
const GMAIL_USER_ID = process.env.GMAIL_USER_ID || "me";

const server = new Server(
  {
    name: "gmail-email-lister",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const emailListSchema = z
    .object({
      query: z.string().optional(),
    })
    .describe("Email Listing Parameters");

  return {
    tools: [
      {
        name: "listEmails",
        description: "List emails from Gmail",
        inputSchema: zodToJsonSchema(emailListSchema), // Convert Zod to JSON Schema
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "listEmails": {
      if (!GMAIL_API_KEY) {
        return { content: [{ type: "text", text: "API Key not set." }] };
      }

      const schema = z.object({
        query: z.string().optional(),
      });

      try {
        schema.parse(request.params.arguments);
      } catch (error: any) {
        return {
          content: [
            { type: "text", text: `Validation Error: ${error.message}` },
          ],
        };
      }

      const { query } = request.params.arguments as { query?: string };

      try {
        const url = `https://gmail.googleapis.com/gmail/v1/users/${GMAIL_USER_ID}/messages${
          query ? `?q=${encodeURIComponent(query)}` : ""
        }`;

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${GMAIL_API_KEY}` },
        });

        if (!response.ok) {
          return {
            content: [{ type: "text", text: `Error: ${response.statusText}` }],
          };
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
    default:
      return { content: [{ type: "text", text: "Unknown tool." }] };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
