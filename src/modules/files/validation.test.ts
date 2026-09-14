import { describe, expect, it } from "vitest";
import {
  attachmentDisposition,
  checkUpload,
  extensionOf,
  MAX_FILE_BYTES,
  sanitizeFileName,
  storageKeyFor,
} from "@/modules/files/validation";

const ok = { fileName: "report.pdf", mimeType: "application/pdf", sizeBytes: 1000 };

describe("checkUpload", () => {
  it("accepts a normal document", () => {
    const r = checkUpload(ok);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.extension).toBe("pdf");
  });

  it("refuses an empty file", () => {
    const r = checkUpload({ ...ok, sizeBytes: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.kind).toBe("empty");
  });

  it("refuses a file over the cap", () => {
    const r = checkUpload({ ...ok, sizeBytes: MAX_FILE_BYTES + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.kind).toBe("too_large");
  });

  it("REFUSES html and svg — both execute when served from our origin", () => {
    for (const [fileName, mimeType] of [
      ["evil.html", "text/html"],
      ["logo.svg", "image/svg+xml"],
      ["x.js", "text/javascript"],
      ["page.htm", "text/html"],
      ["x.xhtml", "application/xhtml+xml"],
    ] as const) {
      const r = checkUpload({ fileName, mimeType, sizeBytes: 100 });
      expect(r.ok, `${fileName} must be refused`).toBe(false);
    }
  });

  it("refuses executables and archives", () => {
    for (const name of ["setup.exe", "x.sh", "x.bat", "lib.dll", "bundle.zip"]) {
      expect(checkUpload({ fileName: name, mimeType: "application/octet-stream", sizeBytes: 100 }).ok).toBe(false);
    }
  });

  it("refuses a file with no extension rather than guessing", () => {
    const r = checkUpload({ fileName: "README", mimeType: "text/plain", sizeBytes: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.kind).toBe("no_extension");
  });

  it("refuses when the MIME type contradicts the extension", () => {
    const r = checkUpload({ fileName: "notes.pdf", mimeType: "text/html", sizeBytes: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.kind).toBe("mime_mismatch");
  });

  it("tolerates a generic or missing MIME from an older browser", () => {
    expect(checkUpload({ fileName: "notes.pdf", mimeType: "application/octet-stream", sizeBytes: 100 }).ok).toBe(true);
    expect(checkUpload({ fileName: "notes.pdf", mimeType: "", sizeBytes: 100 }).ok).toBe(true);
  });

  it("ignores charset parameters and case on the MIME type", () => {
    expect(checkUpload({ fileName: "data.csv", mimeType: "text/CSV; charset=utf-8", sizeBytes: 10 }).ok).toBe(true);
  });

  it("refuses a double extension that ends in something executable", () => {
    expect(checkUpload({ fileName: "invoice.pdf.exe", mimeType: "application/pdf", sizeBytes: 100 }).ok).toBe(false);
  });
});

describe("sanitizeFileName", () => {
  it("strips directory components", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Windows\\system32\\config.txt")).toBe("config.txt");
  });

  it("removes traversal dots and leading dots", () => {
    expect(sanitizeFileName("..hidden.pdf")).toBe("hidden.pdf");
    expect(sanitizeFileName(".env")).toBe("env");
  });

  it("strips characters that would break a header", () => {
    expect(sanitizeFileName('bad"name\r\n.pdf')).not.toMatch(/["\r\n]/);
  });

  it("never returns an empty string", () => {
    expect(sanitizeFileName("")).toBe("file");
    expect(sanitizeFileName("///")).toBe("file");
    expect(sanitizeFileName("...")).toBe("file");
  });

  it("caps the length", () => {
    expect(sanitizeFileName("a".repeat(500)).length).toBeLessThanOrEqual(120);
  });

  it("keeps ordinary names intact", () => {
    expect(sanitizeFileName("Term 1 report (final).pdf")).toBe("Term 1 report (final).pdf");
  });
});

describe("extensionOf", () => {
  it("returns the last extension, lowercased", () => {
    expect(extensionOf("a.PDF")).toBe("pdf");
    expect(extensionOf("a.tar.gz")).toBe("gz");
  });

  it("is null when there isn't one", () => {
    expect(extensionOf("README")).toBeNull();
    expect(extensionOf(".hidden")).toBeNull();
    expect(extensionOf("trailing.")).toBeNull();
  });
});

describe("storageKeyFor", () => {
  it("is built from ids, never from the user's filename", () => {
    const key = storageKeyFor("org1", "abc-123", "pdf");
    expect(key).toBe("org1/abc-123.pdf");
    expect(key).not.toContain("..");
  });
});

describe("attachmentDisposition", () => {
  it("always says attachment, never inline", () => {
    expect(attachmentDisposition("report.pdf")).toMatch(/^attachment;/);
  });

  it("cannot be broken out of with quotes or newlines", () => {
    const d = attachmentDisposition('a";\r\nX-Evil: 1.pdf');
    expect(d).not.toMatch(/[\r\n]/);
    expect(d.match(/"/g)).toHaveLength(2);
  });

  it("carries a UTF-8 form for non-ASCII names", () => {
    expect(attachmentDisposition("रिपोर्ट.pdf")).toContain("filename*=UTF-8''");
  });
});
