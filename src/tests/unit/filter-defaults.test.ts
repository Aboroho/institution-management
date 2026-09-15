import { describe, expect, it } from "vitest";
import {
  isFilterEmpty,
  getFilterDefaults,
  applyDependentChange,
  applyFilterChange,
  getDependentFields,
  ACADEMIC_DEPENDENCIES,
} from "@/lib/filters/filter-defaults";

describe("Filter values as defaults for create forms", () => {
  describe("isFilterEmpty", () => {
    it.each([
      undefined,
      null,
      "",
      "   ",
      "All",
      "all",
      "ALL",
      "Any",
      "any",
      "None",
      "none",
      "All Years",
      "all trades",
      "Any section",
    ])("treats %j as empty filter value", (val) => {
      expect(isFilterEmpty(val)).toBe(true);
    });

    it.each(["2026-27", "Electronics", "2", "Morning", "c-123", 0, false])(
      "treats valid selection %j as non-empty",
      (val) => {
        expect(isFilterEmpty(val)).toBe(false);
      }
    );
  });

  describe("getFilterDefaults", () => {
    it("handles Example 1 from specification: Sections with partial filters", () => {
      // Academic Year: 2026–27
      // Trade: Electronics
      // Semester: All
      // Shift: Morning
      //
      // Expected Create Section form:
      // Academic Year: 2026–27   ← prefilled
      // Trade: Electronics       ← prefilled
      // Semester: [Select]       ← empty
      // Shift: Morning           ← prefilled
      const filters = {
        academicYearId: "2026-27",
        tradeId: "Electronics",
        semesterId: "All",
        shiftId: "Morning",
      };

      const defaults = getFilterDefaults(filters, {
        relevantFields: ["academicYearId", "tradeId", "semesterId", "shiftId", "name", "capacity"],
      });

      expect(defaults).toEqual({
        academicYearId: "2026-27",
        tradeId: "Electronics",
        shiftId: "Morning",
      });
      expect(defaults.semesterId).toBeUndefined();
    });

    it("handles Example 2 from specification: Trade is All, Semester is selected", () => {
      // Academic Year: 2026–27
      // Trade: All
      // Semester: 2
      // Shift: All
      //
      // Expected Create Section form:
      // Academic Year: 2026–27   ← prefilled
      // Trade: [Select]          ← empty
      // Semester: 2              ← prefilled
      // Shift: [Select]          ← empty
      const filters = {
        academicYearId: "2026-27",
        tradeId: "All",
        semesterId: "2",
        shiftId: "All",
      };

      const defaults = getFilterDefaults(filters, {
        relevantFields: ["academicYearId", "tradeId", "semesterId", "shiftId"],
      });

      expect(defaults).toEqual({
        academicYearId: "2026-27",
        semesterId: "2",
      });
      expect(defaults.tradeId).toBeUndefined();
      expect(defaults.shiftId).toBeUndefined();
    });

    it("handles Example 3: No filter selected (all are All/empty)", () => {
      // Academic Year: All
      // Trade: All
      // Semester: All
      // Shift: All
      //
      // Expected: empty / normal defaults
      const filters = {
        academicYearId: "All",
        tradeId: "All",
        semesterId: "All",
        shiftId: "All",
      };

      const defaults = getFilterDefaults(filters, {
        relevantFields: ["academicYearId", "tradeId", "semesterId", "shiftId"],
      });

      expect(defaults).toEqual({});
    });

    it("does not require all filters to be selected before opening create form", () => {
      const filters = {
        tradeId: "Electronics",
      };

      const defaults = getFilterDefaults(filters, {
        relevantFields: ["academicYearId", "tradeId", "semesterId", "shiftId"],
      });

      expect(defaults).toEqual({
        tradeId: "Electronics",
      });
    });

    it("ignores fields in filters that are not relevant to the new entity", () => {
      const filters = {
        academicYearId: "2026-27",
        tradeId: "Electronics",
        status: "ACTIVE", // List filter only, not relevant for Create Section
        search: "section A",
        page: "2",
      };

      const defaults = getFilterDefaults(filters, {
        relevantFields: ["academicYearId", "tradeId", "semesterId", "shiftId"],
      });

      expect(defaults).toEqual({
        academicYearId: "2026-27",
        tradeId: "Electronics",
      });
      expect(defaults.status).toBeUndefined();
      expect(defaults.search).toBeUndefined();
    });

    it("supports field mapping (e.g. offeringId -> courseOfferingId)", () => {
      const filters = {
        offeringId: "off-123",
      };

      const defaults = getFilterDefaults(filters, {
        fieldMap: { offeringId: "courseOfferingId" },
        relevantFields: ["courseOfferingId", "title", "content"],
      });

      expect(defaults).toEqual({
        courseOfferingId: "off-123",
      });
    });

    it("clears dependent field if invalid given validOptions", () => {
      // Trade is tr-1, but semesterId is sem-2 which belongs to tr-2
      const filters = {
        tradeId: "tr-1",
        semesterId: "sem-2",
      };

      const validSemestersForTrade = [
        { value: "sem-1", tradeId: "tr-1" },
      ];

      const defaults = getFilterDefaults(filters, {
        relevantFields: ["tradeId", "semesterId"],
        validOptions: {
          semesterId: validSemestersForTrade,
        },
      });

      expect(defaults).toEqual({
        tradeId: "tr-1",
      });
      expect(defaults.semesterId).toBeUndefined();
    });

    it("clears dependent field if option metadata mismatches parent", () => {
      const filters = {
        tradeId: "tr-1",
        semesterId: "sem-2",
      };

      const allSemesters = [
        { value: "sem-1", tradeId: "tr-1" },
        { value: "sem-2", tradeId: "tr-2" },
      ];

      const defaults = getFilterDefaults(filters, {
        relevantFields: ["tradeId", "semesterId"],
        validOptions: {
          semesterId: allSemesters,
        },
      });

      expect(defaults).toEqual({
        tradeId: "tr-1",
      });
    });

    it("keeps dependent field when valid together with parent", () => {
      const filters = {
        tradeId: "tr-1",
        semesterId: "sem-1",
      };

      const allSemesters = [
        { value: "sem-1", tradeId: "tr-1" },
        { value: "sem-2", tradeId: "tr-2" },
      ];

      const defaults = getFilterDefaults(filters, {
        relevantFields: ["tradeId", "semesterId"],
        validOptions: {
          semesterId: allSemesters,
        },
      });

      expect(defaults).toEqual({
        tradeId: "tr-1",
        semesterId: "sem-1",
      });
    });
  });

  describe("applyDependentChange (user edits prefilled value in form)", () => {
    it("clears dependent semesterId when tradeId is changed", () => {
      const form = {
        academicYearId: "ay-1",
        tradeId: "Electronics",
        semesterId: "sem-1",
        shiftId: "Morning",
      };

      const updated = applyDependentChange(form, "tradeId", "Computer Science");

      expect(updated).toEqual({
        academicYearId: "ay-1",
        tradeId: "Computer Science",
        semesterId: "",
        shiftId: "Morning",
      });
    });

    it("clears sectionId and courseId when tradeId is changed in course offerings form", () => {
      const form = {
        academicYearId: "ay-1",
        tradeId: "tr-1",
        semesterId: "sem-1",
        shiftId: "sh-1",
        sectionId: "sec-1",
        courseId: "c-1",
      };

      const updated = applyDependentChange(form, "tradeId", "tr-2");

      expect(updated).toEqual({
        academicYearId: "ay-1",
        tradeId: "tr-2",
        semesterId: "",
        shiftId: "sh-1",
        sectionId: "",
        courseId: "",
      });
    });

    it("clears sectionId and courseId when semesterId is changed", () => {
      const form = {
        academicYearId: "ay-1",
        tradeId: "tr-1",
        semesterId: "sem-1",
        shiftId: "sh-1",
        sectionId: "sec-1",
        courseId: "c-1",
      };

      const updated = applyDependentChange(form, "semesterId", "sem-2");

      expect(updated).toEqual({
        academicYearId: "ay-1",
        tradeId: "tr-1",
        semesterId: "sem-2",
        shiftId: "sh-1",
        sectionId: "",
        courseId: "",
      });
    });

    it("clears rollNumber when sectionId is changed", () => {
      const form = {
        studentId: "s-1",
        academicYearId: "ay-1",
        tradeId: "tr-1",
        semesterId: "sem-1",
        shiftId: "sh-1",
        sectionId: "sec-1",
        rollNumber: "15",
      };

      const updated = applyDependentChange(form, "sectionId", "sec-2");

      expect(updated).toEqual({
        studentId: "s-1",
        academicYearId: "ay-1",
        tradeId: "tr-1",
        semesterId: "sem-1",
        shiftId: "sh-1",
        sectionId: "sec-2",
        rollNumber: "",
      });
    });

    it("does not clear dependent fields if value has not changed", () => {
      const form = {
        tradeId: "tr-1",
        semesterId: "sem-1",
      };

      const updated = applyDependentChange(form, "tradeId", "tr-1");

      expect(updated).toBe(form);
      expect(updated.semesterId).toBe("sem-1");
    });
  });

  describe("applyFilterChange (list filter updates)", () => {
    it("deletes key and resets dependent filters when parent filter changes", () => {
      const filters = {
        academicYearId: "ay-1",
        tradeId: "tr-1",
        semesterId: "sem-1",
        sectionId: "sec-1",
      };

      const updated = applyFilterChange(filters, "tradeId", "tr-2");

      expect(updated).toEqual({
        academicYearId: "ay-1",
        tradeId: "tr-2",
      });
      expect(updated.semesterId).toBeUndefined();
      expect(updated.sectionId).toBeUndefined();
    });

    it("removes key when set to 'All'", () => {
      const filters = {
        academicYearId: "ay-1",
        tradeId: "tr-1",
      };

      const updated = applyFilterChange(filters, "tradeId", "All");

      expect(updated).toEqual({
        academicYearId: "ay-1",
      });
      expect(updated.tradeId).toBeUndefined();
    });
  });

  describe("getDependentFields", () => {
    it("correctly identifies all dependents of tradeId", () => {
      const deps = getDependentFields("tradeId");
      expect(deps).toContain("semesterId");
      expect(deps).toContain("sectionId");
      expect(deps).toContain("courseId");
      expect(deps).toContain("rollNumber");
    });

    it("correctly identifies dependents of semesterId", () => {
      const deps = getDependentFields("semesterId");
      expect(deps).toContain("sectionId");
      expect(deps).toContain("courseId");
      expect(deps).toContain("rollNumber");
      expect(deps).not.toContain("tradeId");
    });
  });
});
