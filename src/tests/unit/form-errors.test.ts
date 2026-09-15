import { describe, expect, it, vi, afterEach } from "vitest";
import { validationDetails, validationMessage, fieldLabel, validateFields } from "@/lib/validation/form-errors";
import { ApiError, post } from "@/lib/api/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input, Label, FieldError } from "@/components/ui";

afterEach(() => vi.unstubAllGlobals());

describe("user-friendly API errors", () => {
  it("names every invalid field in existing custom screen summaries", () => {
    const error = new ApiError("VALIDATION_ERROR", "Validation failed", 422, {
      fieldErrors: { email: ["Invalid email"], studentId: ["Required"] }, formErrors: ["Check placement"],
    });
    expect(error.message).toContain("Email: Invalid email");
    expect(error.message).toContain("Student ID: Required");
    expect(error.message).toContain("Check placement");
  });
  it("retains multiple errors per field", () => {
    expect(validationDetails({ fieldErrors: { password: ["Too short", "Needs a number"] } }).fieldErrors.password).toHaveLength(2);
  });
  it.each([null, undefined, "bad", [], { fieldErrors: { email: [null, 12] }, formErrors: {} }])("tolerates malformed details: %j", (details) => {
    expect(validationMessage(details)).toBe("Please check your inputs and try again.");
  });
  it("formats nested fields and array indices", () => {
    expect(fieldLabel("records.0.studentId")).toBe("Records → item 1 → Student ID");
  });
  it("does not replace useful business-rule messages", () => {
    expect(new ApiError("CONFLICT", "Course code already exists", 409).message).toBe("Course code already exists");
  });
  it("preserves specific validation instructions without structured details", () => {
    expect(new ApiError("VALIDATION_ERROR", "Please upload a PDF file", 422).message).toBe("Please upload a PDF file");
  });
  it("hides internal server messages", () => {
    expect(new ApiError("INTERNAL_ERROR", "SQL secret", 500).message).not.toContain("SQL");
  });
  it("explains connection failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(post("/courses", {})).rejects.toThrow("Check your connection");
  });
  it("preserves validation details through HTTP handling", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: "VALIDATION_ERROR", message: "Validation failed", details: { fieldErrors: { name: ["Required"] } },
    } }), { status: 422 })));
    await expect(post("/courses", {})).rejects.toMatchObject({ status: 422, message: expect.stringContaining("Name: Required") });
  });
});

describe("shared form UX", () => {
  const fields = [{ name: "name", label: "Course name", required: true }, { name: "email", label: "Email", type: "email" }, { name: "credits", label: "Credits", type: "number" }];
  it("rejects blank required values with the input label", () => {
    expect(validateFields(fields, { name: "   " }).name).toEqual(["Course name is required."]);
  });
  it("reports all invalid fields together", () => {
    expect(Object.keys(validateFields(fields, { email: "invalid", credits: "NaN" }))).toEqual(["name", "email", "credits"]);
  });
  it("allows empty optionals and zero numbers", () => {
    expect(validateFields(fields, { name: "Math", email: "", credits: 0 })).toEqual({});
  });
  it("does not validate fields omitted from an edit form", () => {
    expect(validateFields([], {})).toEqual({});
  });
  it("renders accessible labels, invalid inputs, and error announcements", () => {
    expect(renderToStaticMarkup(createElement(Label, { htmlFor: "email" }, "Email"))).toContain('for="email"');
    expect(renderToStaticMarkup(createElement(Input, { id: "email", "aria-invalid": true, "aria-describedby": "email-error" }))).toContain('aria-describedby="email-error"');
    const error = renderToStaticMarkup(createElement(FieldError, { id: "email-error", error: "Enter a valid email." }));
    expect(error).toContain('id="email-error"');
    expect(error).toContain('role="alert"');
  });
});
