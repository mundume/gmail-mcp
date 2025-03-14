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

const EmailIndexSchema = z.object({
  emailIndex: z.number().describe("The index of the email to retrieve."),
});

const SendEmailSchema = z.object({
  to: z.string().email().describe("Recipient email address."),
  subject: z.string().describe("Email subject."),
  body: z.string().describe("Email body."),
});

const ListEmailsSchema = z.object({
  query: z
    .string()
    .describe(
      "The search query to filter emails. Use 'in:inbox','in:spam' 'in:unread', 'in:starred', 'in:sent', 'in:all', 'in:category_social', 'in:category_promotions', 'in:category_updates', 'in:category_forums', 'in:primary' or 'in:draft' to filter by label."
    )
    .optional()
    .default("in:inbox"),

  maxResults: z
    .number()
    .optional()
    .describe("The maximum number of emails to retrieve.")
    .default(3),
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
          "List emails from Gmail with subject, sender, and body in Markdown format. Optionally filter and summarize results.",
        inputSchema: zodToJsonSchema(ListEmailsSchema),
      },
      {
        name: "getEmailContent",
        description: "Retrieve the full content of an email from Gmail.",
        inputSchema: zodToJsonSchema(EmailIndexSchema),
      },
      {
        name: "sendEmail",
        description: "Send an email from Gmail.",
        inputSchema: zodToJsonSchema(SendEmailSchema),
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.log(request.params);
  switch (request.params.name) {
    case "listEmails": {
      if (!GMAIL_API_KEY) {
        return { content: [{ type: "text", text: "API Key not set." }] };
      }

      try {
        const { query, maxResults } = request.params.arguments || {};

        const queryParam = query
          ? `?q=${encodeURIComponent(query as string)}&maxResults=${maxResults}`
          : `?maxResults=${maxResults}`;

        const messageListResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/${GMAIL_USER_ID}/messages${queryParam}`,
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

      try {
        const { emailIndex } = EmailIndexSchema.parse(request.params.arguments);

        // 1. Get List of Message IDs (up to the requested index)
        const messageListResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/${GMAIL_USER_ID}/messages?maxResults=${emailIndex}`,
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

        if (!messageList.messages || messageList.messages.length < emailIndex) {
          return {
            content: [
              { type: "text", text: "Email not found at the specified index." },
            ],
          };
        }

        const messageId = messageList.messages[emailIndex - 1].id; // Get the ID at the requested index

        // 2. Get Full Message Content
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

    case "sendEmail": {
      if (!GMAIL_API_KEY) {
        return { content: [{ type: "text", text: "API Key not set." }] };
      }

      try {
        const { to, subject, body } = SendEmailSchema.parse(
          request.params.arguments
        );

        let emailHeaders = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n`;

        const raw = Buffer.from(emailHeaders + body)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        console.log("Raw message:", raw);

        const response = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/${GMAIL_USER_ID}/messages/send`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${GMAIL_API_KEY}`,
            },
            body: JSON.stringify({ raw: raw }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          console.error("Gmail API Error:", errorData); // Debugging: Log the full error
          const errorMessage = errorData.error?.message || response.statusText;
          return {
            content: [{ type: "text", text: `Error: ${errorMessage}` }],
          };
        }

        return {
          content: [{ type: "text", text: "Email sent successfully." }],
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
