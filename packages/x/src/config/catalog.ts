// SPDX-License-Identifier: Apache-2.0
import catalogData from "./x-graphql-catalog.json";

export interface Operation {
  name: string;
  queryId: string;
  operationType: "query" | "mutation" | "subscription";
  featureSwitches: string[];
}

const operationsMap = new Map<string, Operation>();

// Initialize map from JSON catalog
for (const [name, op] of Object.entries(catalogData.operations)) {
  operationsMap.set(name, {
    name,
    queryId: op.queryId,
    operationType: op.operationType as any,
    featureSwitches: op.featureSwitches || [],
  });
}

/** Look up a single operation by its exact case-sensitive name. */
export function getOperation(name: string): Operation | undefined {
  return operationsMap.get(name);
}

/** Return all operations in the catalog. */
export function allOperations(): Operation[] {
  return Array.from(operationsMap.values());
}

/** Return only mutation operations. */
export function mutations(): Operation[] {
  return allOperations().filter((op) => op.operationType === "mutation");
}

/** Return only query operations. */
export function queries(): Operation[] {
  return allOperations().filter((op) => op.operationType === "query");
}
