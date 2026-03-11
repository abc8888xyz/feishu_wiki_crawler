/**
 * Unit tests for wikiDocExportRoute helper functions.
 *
 * Tests cover:
 * - sanitizeFilename: safe filename generation
 * - resolveAccessToken: token resolution logic
 * - DocExportFormat validation
 */

import { describe, expect, it } from "vitest";

// ─── Inline the helpers to test (they are not exported from the route file) ───
// We duplicate the logic here to test it in isolation without needing Express.

function sanitizeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

async function resolveAccessToken(
  userAccessToken?: string,
  _appId?: string,
  _appSecret?: string
): Promise<string> {
  if (userAccessToken?.trim()) return userAccessToken.trim();
  throw new Error(
    "Docx/PDF export requires a User Access Token (not App credentials)."
  );
}

type DocExportFormat = "docx" | "pdf";

function isValidFormat(format: string): format is DocExportFormat {
  return format === "docx" || format === "pdf";
}

// ─── sanitizeFilename ─────────────────────────────────────────────────────────
describe("sanitizeFilename", () => {
  it("replaces forbidden characters with underscores", () => {
    expect(sanitizeFilename('file<>:"/\\|?*name')).toBe("file_________name");
  });

  it("replaces whitespace with underscores", () => {
    expect(sanitizeFilename("my document title")).toBe("my_document_title");
  });

  it("replaces multiple spaces with single underscore", () => {
    expect(sanitizeFilename("my   doc")).toBe("my_doc");
  });

  it("truncates to 100 characters", () => {
    const longTitle = "a".repeat(150);
    expect(sanitizeFilename(longTitle)).toHaveLength(100);
  });

  it("handles empty string", () => {
    expect(sanitizeFilename("")).toBe("");
  });

  it("preserves normal characters", () => {
    expect(sanitizeFilename("MyDocument2024")).toBe("MyDocument2024");
  });

  it("handles unicode characters (Vietnamese)", () => {
    const result = sanitizeFilename("Tài liệu kỹ thuật");
    expect(result).toBe("Tài_liệu_kỹ_thuật");
  });

  it("replaces control characters", () => {
    // \x00 through \x1f are control chars
    const withControl = "file\x00name\x1fname";
    expect(sanitizeFilename(withControl)).toBe("file_name_name");
  });
});

// ─── resolveAccessToken ───────────────────────────────────────────────────────
describe("resolveAccessToken", () => {
  it("returns user access token when provided", async () => {
    const token = await resolveAccessToken("u-mytoken123");
    expect(token).toBe("u-mytoken123");
  });

  it("trims whitespace from user access token", async () => {
    const token = await resolveAccessToken("  u-mytoken123  ");
    expect(token).toBe("u-mytoken123");
  });

  it("throws when no token provided", async () => {
    await expect(resolveAccessToken()).rejects.toThrow(
      "Docx/PDF export requires a User Access Token"
    );
  });

  it("throws when empty string provided", async () => {
    await expect(resolveAccessToken("")).rejects.toThrow(
      "Docx/PDF export requires a User Access Token"
    );
  });

  it("throws when only whitespace provided", async () => {
    await expect(resolveAccessToken("   ")).rejects.toThrow(
      "Docx/PDF export requires a User Access Token"
    );
  });

  it("ignores appId/appSecret and throws without userAccessToken", async () => {
    await expect(resolveAccessToken(undefined, "cli_xxx", "secret_yyy")).rejects.toThrow(
      "Docx/PDF export requires a User Access Token"
    );
  });
});

// ─── isValidFormat ────────────────────────────────────────────────────────────
describe("isValidFormat", () => {
  it("accepts 'docx'", () => {
    expect(isValidFormat("docx")).toBe(true);
  });

  it("accepts 'pdf'", () => {
    expect(isValidFormat("pdf")).toBe(true);
  });

  it("rejects 'markdown'", () => {
    expect(isValidFormat("markdown")).toBe(false);
  });

  it("rejects 'xlsx'", () => {
    expect(isValidFormat("xlsx")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidFormat("")).toBe(false);
  });

  it("rejects 'DOCX' (case sensitive)", () => {
    expect(isValidFormat("DOCX")).toBe(false);
  });
});

// ─── Unique filename deduplication logic ──────────────────────────────────────
describe("Filename deduplication", () => {
  it("generates unique names for duplicate titles", () => {
    const titleCounts = new Map<string, number>();
    const files: string[] = [];

    const addFile = (title: string) => {
      const baseName = sanitizeFilename(title);
      const count = titleCounts.get(baseName) ?? 0;
      titleCounts.set(baseName, count + 1);
      const uniqueName = count === 0 ? baseName : `${baseName}_${count}`;
      files.push(uniqueName);
    };

    addFile("Introduction");
    addFile("Introduction");
    addFile("Introduction");
    addFile("Unique Title");

    expect(files[0]).toBe("Introduction");
    expect(files[1]).toBe("Introduction_1");
    expect(files[2]).toBe("Introduction_2");
    expect(files[3]).toBe("Unique_Title");
  });
});
