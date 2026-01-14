import { describe, it } from "node:test";
import assert from "node:assert";

// Import the function - we'll need to export it from main file
import { adfToMarkdown } from "../jira-to-linear.mjs";

describe("adfToMarkdown", () => {
  it("should return empty string for null/undefined input", () => {
    assert.strictEqual(adfToMarkdown(null), "");
    assert.strictEqual(adfToMarkdown(undefined), "");
    assert.strictEqual(adfToMarkdown({}), "");
  });

  it("should convert simple paragraph", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
    };
    assert.strictEqual(adfToMarkdown(adf), "Hello world");
  });

  it("should convert bold text", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "bold text",
              marks: [{ type: "strong" }],
            },
          ],
        },
      ],
    };
    assert.strictEqual(adfToMarkdown(adf), "**bold text**");
  });

  it("should convert italic text", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "italic text",
              marks: [{ type: "em" }],
            },
          ],
        },
      ],
    };
    assert.strictEqual(adfToMarkdown(adf), "*italic text*");
  });

  it("should convert inline code", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "code",
              marks: [{ type: "code" }],
            },
          ],
        },
      ],
    };
    assert.strictEqual(adfToMarkdown(adf), "`code`");
  });

  it("should convert links", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click here",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    };
    assert.strictEqual(adfToMarkdown(adf), "[click here](https://example.com)");
  });

  it("should convert headings", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Subtitle" }],
        },
      ],
    };
    const result = adfToMarkdown(adf);
    assert.ok(result.includes("# Title"));
    assert.ok(result.includes("## Subtitle"));
  });

  it("should convert bullet lists", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item 1" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item 2" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = adfToMarkdown(adf);
    assert.ok(result.includes("- Item 1"));
    assert.ok(result.includes("- Item 2"));
  });

  it("should convert ordered lists", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "First" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Second" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = adfToMarkdown(adf);
    assert.ok(result.includes("1."));
    assert.ok(result.includes("2."));
  });

  it("should convert code blocks", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ],
    };
    const result = adfToMarkdown(adf);
    assert.ok(result.includes("```"));
    assert.ok(result.includes("const x = 1;"));
  });
});
