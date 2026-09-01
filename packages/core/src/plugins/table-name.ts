import { AliasNode, IdentifierNode, TableNode, type OperationNode } from "kysely";

/**
 * A resolved reference to a table in FROM/JOIN/UPDATE-target/INSERT-target/
 * DELETE-target position. `realName` (the table's declared name) is what
 * gets checked against a configured table set (soft-delete, audit, ...);
 * `refName` (the alias if the query aliased this table, otherwise the real
 * name) is what any injected SQL must actually reference — using
 * `realName` there would compile a reference to an identifier that's out
 * of scope after aliasing. Shared between soft-delete.ts and audit.ts —
 * this used to be private to the soft-delete plugin, extracted here
 * unchanged when audit.ts needed the identical logic.
 */
export interface TableRef {
  readonly realName: string;
  readonly refName: string;
}

export function extractTableRef(node: OperationNode): TableRef | undefined {
  if (TableNode.is(node)) {
    const name = node.table.identifier.name;
    return { realName: name, refName: name };
  }
  if (AliasNode.is(node) && TableNode.is(node.node) && IdentifierNode.is(node.alias)) {
    return { realName: node.node.table.identifier.name, refName: node.alias.name };
  }
  return undefined;
}

/** Every table reference in a query's FROM clause and JOIN clauses. */
export function refsFromFromAndJoins(node: {
  readonly from?: { readonly froms: ReadonlyArray<OperationNode> };
  readonly joins?: ReadonlyArray<{ readonly table: OperationNode }>;
}): OperationNode[] {
  return [...(node.from?.froms ?? []), ...(node.joins?.map((join) => join.table) ?? [])];
}
