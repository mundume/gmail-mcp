#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WithImplicitCoercion } from "buffer";
import * as dotenv from "dotenv";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
dotenv.config();

const GMAIL_API_KEY = process.env.GMAIL_API_KEY;
const GMAIL_USER_ID = process.env.GMAIL_USER_ID || "me";

const getEmailContentSchema = z.object({
  messageId: z.string().describe("The ID of the email to retrieve."),
});

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
  return {
    tools: [
      {
        name: "listEmails",
        description:
          "List emails from Gmail with subject, sender, and body in Markdown format.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "getEmailContent",
        description: "Retrieve the full content of an email from Gmail.",
        inputSchema: zodToJsonSchema(getEmailContentSchema),
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

      try {
        const messageListResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/${GMAIL_USER_ID}/messages?maxResults=3`,
          { headers: { Authorization: `Bearer ${GMAIL_API_KEY}` } }
        );

        if (!messageListResponse.ok) {
          const errorData = await messageListResponse.json();
          const errorMessage =
            errorData.error?.message || messageListResponse.statusText;
          return {
            content: [{ type: "text", text: `Error: ${errorMessage}` }],
          };
        }

        const messageList = await messageListResponse.json();

        if (!messageList.messages) {
          return { content: [{ type: "text", text: "No messages found." }] };
        }

        const emailMessages = [];

        for (const message of messageList.messages) {
          const messageId = message.id;
          const messageResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/${GMAIL_USER_ID}/messages/${messageId}?format=full`,
            { headers: { Authorization: `Bearer ${GMAIL_API_KEY}` } }
          );

          if (!messageResponse.ok) {
            const errorData = await messageResponse.json();
            const errorMessage =
              errorData.error?.message || messageResponse.statusText;
            return {
              content: [{ type: "text", text: `Error: ${errorMessage}` }],
            };
          }

          const fullMessage = await messageResponse.json();
          emailMessages.push(await parseMessage(fullMessage));
        }

        return {
          content: [{ type: "text", text: JSON.stringify(emailMessages) }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
    case "getEmailContent": {
      if (!GMAIL_API_KEY) {
        return { content: [{ type: "text", text: "API Key not set." }] };
      }
      const getMessageId = getEmailContentSchema.parse(request.params.input);
      const { messageId } = getMessageId;

      try {
        const messageResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/${GMAIL_USER_ID}/messages/${messageId}?format=full`,
          { headers: { Authorization: `Bearer ${GMAIL_API_KEY}` } }
        );

        if (!messageResponse.ok) {
          const errorData = await messageResponse.json();
          const errorMessage =
            errorData.error?.message || messageResponse.statusText;
          return {
            content: [{ type: "text", text: `Error: ${errorMessage}` }],
          };
        }

        const fullMessage = await messageResponse.json();
        const emailContent = await parseMessage(fullMessage);

        return {
          content: [{ type: "text", text: JSON.stringify(emailContent) }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
    default:
      return { content: [{ type: "text", text: "Unknown tool." }] };
  }
});

async function parseMessage(message: {
  payload: {
    headers: { name: string; value: string }[];
    parts: { mimeType: string; body: { data: WithImplicitCoercion<string> } }[];
    body: { data: WithImplicitCoercion<string> };
  };
  id: string;
}) {
  const headers = message.payload.headers;
  const subject = headers.find(
    (header: { name: string }) => header.name === "Subject"
  )?.value;
  const from = headers.find(
    (header: { name: string }) => header.name === "From"
  )?.value;
  let body = "";

  if (message.payload.parts) {
    const textPart = message.payload.parts.find(
      (part) => part.mimeType === "text/plain"
    );
    if (textPart) {
      body = Buffer.from(textPart.body.data, "base64").toString("utf-8");
    } else {
      const htmlPart = message.payload.parts.find(
        (part) => part.mimeType === "text/html"
      );
      if (htmlPart) {
        body = Buffer.from(htmlPart.body.data, "base64").toString("utf-8");
      }
    }
  } else if (message.payload.body.data) {
    body = Buffer.from(message.payload.body.data, "base64").toString("utf-8");
  }

  return {
    id: message.id,
    subject: subject,
    from: from,
    body: body,
  };
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
