// SPDX-License-Identifier: Apache-2.0
import catalogData from "./x-graphql-catalog.json";
import gryphonCatalog from "./gryphon-graphql-catalog.json";

export interface Operation {
  name: string;
  queryId: string;
  operationType: "query" | "mutation" | "subscription";
  featureSwitches: string[];
}

const operationsMap = new Map<string, Operation>();

// Initialize map from JSON catalog
function ingestCatalog(
  ops: Record<
    string,
    { queryId: string; operationType: string; featureSwitches?: string[] }
  >,
): void {
  for (const [name, op] of Object.entries(ops)) {
    operationsMap.set(name, {
      name,
      queryId: op.queryId,
      operationType: op.operationType as Operation["operationType"],
      featureSwitches: op.featureSwitches || [],
    });
  }
}

ingestCatalog(catalogData.operations);
ingestCatalog(gryphonCatalog.operations);

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
