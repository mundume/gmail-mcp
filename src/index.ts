#!/usr/bin/env node

/**
 * This MCP server provides a tool for listing emails from Gmail.
 * It demonstrates the use of tools and Zod schema validation.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";
import { z } from "zod";
dotenv.config();

/**
 * Load environment variables from a .env file.
 */
const GMAIL_API_KEY = process.env.GMAIL_API_KEY;

/**
 * Create an MCP server instance with tool capabilities.
 */
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

/**
 * Handler for listing available tools.
 * Exposes the "listEmails" tool.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "listEmails",
        description: "List emails from Gmail",
        inputSchema: z
          .object({
            query: z.string().optional(),
          })
          .describe("Email Listing Parameters"),
      },
    ],
  };
});

/**
 * Handler for calling tools.
 * Implements the "listEmails" tool functionality.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "listEmails": {
      /**
       * Check if the Gmail API key is set.
       */
      if (!GMAIL_API_KEY) {
        return { content: [{ type: "text", text: "API Key not set." }] };
      }

      /**
       * Define the Zod schema for input validation.
       */
      const schema = z.object({
        query: z.string().optional(),
      });

      /**
       * Validate the input arguments using Zod.
       */
      try {
        schema.parse(request.params.arguments);
      } catch (error: any) {
        return {
          content: [
            { type: "text", text: `Validation Error: ${error.message}` },
          ],
        };
      }

      /**
       * Extract the query parameter from the validated arguments.
       */
      const { query } = request.params.arguments as { query?: string };

      /**
       * Make the Gmail API call to list emails.
       */
      try {
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages${
          query ? `?q=${encodeURIComponent(query)}` : ""
        }`;

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${GMAIL_API_KEY}` },
        });

        /**
         * Check if the API response is successful.
         */
        if (!response.ok) {
          return {
            content: [{ type: "text", text: `Error: ${response.statusText}` }],
          };
        }

        /**
         * Parse the JSON response and return it as the tool's output.
         */
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

/**
 * Start the MCP server using stdio transport.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Handle any unhandled promise rejections or exceptions.
 */
main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
