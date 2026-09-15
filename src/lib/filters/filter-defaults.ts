/**
 * Reusable filter defaults logic for create forms across the application.
 *
 * Implements:
 * 1. Filter values used as Create form defaults whenever fields are relevant to the new entity.
 * 2. Partial filter behavior: only prefill filters that currently have a selected value.
 * 3. "All", "Any", "None", empty strings, null, undefined are treated as no selected value.
 * 4. Respects dependency rules: clears invalid dependent values.
 * 5. Supports field mapping, relevant field restrictions, and dependent field clearing on change.
 */

export const UNSET_FILTER_VALUES = new Set(["all", "any", "none"]);

/**
 * Checks whether a filter value represents "no selected value" / "All".
 */
export function isFilterEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return true;
    const lower = trimmed.toLowerCase();
    if (UNSET_FILTER_VALUES.has(lower)) return true;
    if (lower.startsWith("all ") || lower.startsWith("any ")) return true;
    return false;
  }
  return false;
}

/**
 * Standard entity dependency rules.
 * Maps childField -> array of parent fields it depends on.
 */
export const ACADEMIC_DEPENDENCIES: Record<string, string[]> = {
  // Semester belongs to a Trade
  semesterId: ["tradeId"],
  // Section belongs to Academic Year, Trade, Semester, Shift
  sectionId: ["academicYearId", "tradeId", "semesterId", "shiftId"],
  // Course in offering belongs to Trade + Semester (via active curriculum)
  courseId: ["tradeId", "semesterId"],
  // Roll number belongs to a Section
  rollNumber: ["sectionId", "academicYearId", "tradeId", "semesterId", "shiftId"],
};

/**
 * Given a parent field, returns all fields that directly or transitively
 * depend on that parent field.
 */
export function getDependentFields(
  parentField: string,
  dependencies: Record<string, string[]> = ACADEMIC_DEPENDENCIES
): string[] {
  const result = new Set<string>();
  const queue = [parentField];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [child, parents] of Object.entries(dependencies)) {
      if (parents.includes(current) && !result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }

  return Array.from(result);
}

export interface FilterDefaultsConfig<T = Record<string, string>> {
  /**
   * Only prefill fields that are relevant to the Create form.
   * If omitted, any filter with a non-empty value that isn't mapped out is used.
   */
  relevantFields?: string[];

  /**
   * Map filter names to form field names.
   * e.g. { offeringId: "courseOfferingId" }
   */
  fieldMap?: Record<string, string>;

  /**
   * Dependency rules: childField -> [parentField1, parentField2, ...]
   * Defaults to ACADEMIC_DEPENDENCIES.
   */
  dependencies?: Record<string, string[]>;

  /**
   * Optional map of field name to valid option lists.
   * If a field value is not found in validOptions[field] or does not match
   * parent value, it is cleared.
   */
  validOptions?: Record<string, Array<string | { value: string; [key: string]: unknown }>>;

  /**
   * Custom validator for combinations.
   */
  validate?: (form: Record<string, string>) => Record<string, string>;

  /**
   * Initial form defaults if any (e.g. { isActive: "true" }).
   */
  initialValues?: Record<string, any>;
}

/**
 * Extracts default values for a Create form from list filter values.
 */
export function getFilterDefaults<T extends Record<string, any> = Record<string, string>>(
  filters: Record<string, unknown>,
  config: FilterDefaultsConfig<T> = {}
): T {
  const result: Record<string, string> = {};
  if (config.initialValues) {
    for (const [k, v] of Object.entries(config.initialValues)) {
      if (v !== undefined && v !== null) {
        result[k] = String(v);
      }
    }
  }

  const relevantSet = config.relevantFields ? new Set(config.relevantFields) : null;
  const dependencies = config.dependencies ?? ACADEMIC_DEPENDENCIES;

  // 1. Extract non-empty filter values for relevant fields
  for (const [filterKey, filterValue] of Object.entries(filters)) {
    if (isFilterEmpty(filterValue)) continue;

    const formKey = config.fieldMap?.[filterKey] ?? filterKey;
    if (relevantSet && !relevantSet.has(formKey)) continue;

    result[formKey] = String(filterValue);
  }

  // 2. Validate options against validOptions if provided
  if (config.validOptions) {
    for (const [field, options] of Object.entries(config.validOptions)) {
      if (!result[field]) continue;
      if (Array.isArray(options) && options.length > 0) {
        const match = options.find((opt) =>
          typeof opt === "string" ? opt === result[field] : String(opt.value) === result[field]
        );

        if (!match) {
          // The selected value does not exist among the options
          delete result[field];
          const dependents = getDependentFields(field, dependencies);
          for (const dep of dependents) delete result[dep];
        } else if (typeof match === "object" && match !== null) {
          // Check parent fields
          const parents = dependencies[field] ?? [];
          let hasMismatch = false;
          for (const parent of parents) {
            if (parent in match && result[parent]) {
              const expectedParent = String((match as Record<string, unknown>)[parent]);
              if (expectedParent && expectedParent !== result[parent]) {
                hasMismatch = true;
                break;
              }
            }
          }
          if (hasMismatch) {
            delete result[field];
            const dependents = getDependentFields(field, dependencies);
            for (const dep of dependents) delete result[dep];
          }
        }
      }
    }
  }

  // 3. Custom validator if provided
  if (config.validate) {
    return config.validate(result) as T;
  }

  return result as T;
}

/**
 * When a field in the form changes, update the field and reset any dependent fields to "".
 */
export function applyDependentChange<T extends Record<string, any>>(
  currentForm: T,
  fieldName: string,
  newValue: any,
  dependencies: Record<string, string[]> = ACADEMIC_DEPENDENCIES
): T {
  // If the value hasn't changed, don't clear dependent fields.
  if (currentForm[fieldName] === newValue) {
    return currentForm;
  }

  const nextForm = { ...currentForm, [fieldName]: newValue };
  const dependentsToClear = getDependentFields(fieldName, dependencies);
  for (const dep of dependentsToClear) {
    if (dep in nextForm) {
      nextForm[dep as keyof T] = "" as any;
    }
  }
  return nextForm;
}

/**
 * Helper to update a filter while clearing dependent filters.
 */
export function applyFilterChange(
  currentFilters: Record<string, string>,
  key: string,
  value: string,
  dependencies: Record<string, string[]> = ACADEMIC_DEPENDENCIES
): Record<string, string> {
  const next = { ...currentFilters };
  if (isFilterEmpty(value)) {
    delete next[key];
  } else {
    next[key] = value;
  }
  const dependents = getDependentFields(key, dependencies);
  for (const dep of dependents) {
    delete next[dep];
  }
  return next;
}
