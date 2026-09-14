import { describe, expect, it } from "vitest";
import { csvToRecords, parseCsv, toCsv } from "@/modules/sis/csv";

describe("parseCsv", () => {
  it("splits simple rows and fields", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF line endings and a trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas and newlines inside quoted fields", () => {
    expect(parseCsv('name,address\n"Rao, Priya","12 Main St\nHyderabad"')).toEqual([
      ["name", "address"],
      ["Rao, Priya", "12 Main St\nHyderabad"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('q\n"She said ""hi"""')).toEqual([["q"], ['She said "hi"']]);
  });

  it("strips a UTF-8 BOM (Excel exports have one)", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("drops fully blank rows", () => {
    expect(parseCsv("a,b\n\n1,2\n,\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("csvToRecords", () => {
  it("maps header to trimmed values and fills missing trailing cells", () => {
    expect(csvToRecords(" a , b \n 1 \n")).toEqual({
      headers: ["a", "b"],
      rows: [{ a: "1", b: "" }],
    });
  });

  it("returns empty for empty input", () => {
    expect(csvToRecords("")).toEqual({ headers: [], rows: [] });
  });
});

describe("toCsv", () => {
  it("round-trips through parseCsv, quoting only when needed", () => {
    const rows = [
      ["name", "note"],
      ["Rao, Priya", 'said "hi"\nthen left'],
      ["plain", "value"],
    ];
    const text = toCsv(rows);
    expect(text).toBe('name,note\r\n"Rao, Priya","said ""hi""\nthen left"\r\nplain,value\r\n');
    expect(parseCsv(text)).toEqual(rows);
  });
});
