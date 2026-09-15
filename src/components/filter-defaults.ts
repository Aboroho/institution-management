"use client";
import React, { useCallback, useMemo, useState } from "react";
import {
  isFilterEmpty,
  getFilterDefaults,
  applyDependentChange,
  applyFilterChange,
  getDependentFields,
  ACADEMIC_DEPENDENCIES,
  type FilterDefaultsConfig,
} from "@/lib/filters/filter-defaults";

export {
  isFilterEmpty,
  getFilterDefaults,
  applyDependentChange,
  applyFilterChange,
  getDependentFields,
  ACADEMIC_DEPENDENCIES,
  type FilterDefaultsConfig,
};

/**
 * Hook for managing Create form defaults based on list filters.
 */
export function useFilterDefaults<T extends Record<string, any> = Record<string, string>>(
  filters: Record<string, unknown>,
  config: FilterDefaultsConfig<T> = {}
) {
  const getDefaults = useCallback(() => {
    return getFilterDefaults<T>(filters, config);
  }, [filters, config]);

  const updateDependentField = useCallback(
    (currentForm: T, fieldName: string, newValue: any): T => {
      return applyDependentChange(
        currentForm,
        fieldName,
        newValue,
        config.dependencies ?? ACADEMIC_DEPENDENCIES
      );
    },
    [config.dependencies]
  );

  return {
    getDefaults,
    updateDependentField,
    isFilterEmpty,
  };
}
