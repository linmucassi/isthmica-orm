import {
  OperationNodeTransformer,
  ReturningNode,
  SelectionNode,
  type DeleteQueryNode,
  type InsertQueryNode,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryId,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow,
  type UpdateQueryNode,
} from "kysely";
import { extractTableRef, refsFromFromAndJoins, type TableRef } from "./table-name.js";

export type AuditOperation = "insert" | "update" | "delete";

export interface AuditEvent {
  readonly table: string;
  readonly operation: AuditOperation;
  /** Plugin-side timestamp, not DB-bound — the Date/SQLite binding issue
   * that affects `softDeleteUpdate` doesn't apply here (this never gets
   * sent to a driver as a query parameter). */
  readonly occurredAt: Date;
  readonly newValues: readonly Record<string, unknown>[];
}

export interface AuditPluginOptions {
  readonly tables: readonly string[];
  readonly sink: (event: AuditEvent) => void | Promise<void>;
}

/**
 * Captures post-image (new-row-state) audit events for INSERT/UPDATE/DELETE
 * against configured tables and hands them to a caller-supplied `sink` —
 * unopinionated about where audit rows go (your own audit table, Kafka, a
 * webhook, console.log for a demo — your choice).
 *
 * **Post-image only.** Pre-image (old values) is deliberately out of scope
 * for this first slice: a `KyselyPlugin` hook operates on one query at a
 * time with no cross-query orchestration, so capturing "what the row
 * looked like before" needs either a separate SELECT-then-mutate round
 * trip (a materially bigger API shape than a transparent plugin) or
 * DB-native triggers/logical replication (outside Kysely entirely). If
 * wanted later, that's an explicit opt-in helper analogous to
 * `softDeleteUpdate`, not a transparent extension of this plugin.
 *
 * Mechanism: `transformQuery` injects `returning *` into INSERT/UPDATE/DELETE
 * against an audited table — but only if the caller hasn't already
 * specified a narrower `.returning(...)`, in which case their choice is
 * respected (and does narrow what gets audited — a documented, tested
 * limitation, not a silent gap). `transformResult` reads the resulting
 * rows and calls `sink`, matched back to its originating query via a
 * `WeakMap<QueryId, ...>` — this exact pattern (not the AST node
 * factories soft-delete.ts relies on) is explicitly documented in
 * `KyselyPlugin`'s own JSDoc, firmer ground than soft-delete's AST
 * rewriting.
 *
 * **Dialect boundary:** `RETURNING` works on Postgres and SQLite but not
 * MySQL — this plugin's capture mechanism is Postgres/SQLite-only for now.
 * Audit + MySQL is a separate future design, not silently assumed to work.
 */
export function createAuditPlugin(options: AuditPluginOptions): KyselyPlugin {
  const auditedTables = new Set(options.tables);
  const pending = new WeakMap<QueryId, { table: string; operation: AuditOperation }>();
  const transformer = new AuditQueryTransformer(auditedTables, pending);

  return {
    transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
      return transformer.transformNode(args.node, args.queryId);
    },
    async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
      const info = pending.get(args.queryId);
      if (info) {
        await options.sink({
          table: info.table,
          operation: info.operation,
          occurredAt: new Date(),
          newValues: args.result.rows as readonly Record<string, unknown>[],
        });
      }
      return args.result;
    },
  };
}

class AuditQueryTransformer extends OperationNodeTransformer {
  constructor(
    private readonly auditedTables: ReadonlySet<string>,
    private readonly pending: WeakMap<QueryId, { table: string; operation: AuditOperation }>,
  ) {
    super();
  }

  protected override transformInsertQuery(
    node: InsertQueryNode,
    queryId?: QueryId,
  ): InsertQueryNode {
    const transformed = super.transformInsertQuery(node, queryId);
    const ref = transformed.into ? extractTableRef(transformed.into) : undefined;
    return this.maybeAudit(transformed, ref, "insert", queryId);
  }

  protected override transformUpdateQuery(
    node: UpdateQueryNode,
    queryId?: QueryId,
  ): UpdateQueryNode {
    const transformed = super.transformUpdateQuery(node, queryId);
    const ref = transformed.table ? extractTableRef(transformed.table) : undefined;
    return this.maybeAudit(transformed, ref, "update", queryId);
  }

  protected override transformDeleteQuery(
    node: DeleteQueryNode,
    queryId?: QueryId,
  ): DeleteQueryNode {
    const transformed = super.transformDeleteQuery(node, queryId);
    const refs = refsFromFromAndJoins(transformed);
    const ref = refs.length > 0 ? extractTableRef(refs[0]!) : undefined;
    return this.maybeAudit(transformed, ref, "delete", queryId);
  }

  private maybeAudit<T extends { readonly returning?: ReturningNode }>(
    node: T,
    ref: TableRef | undefined,
    operation: AuditOperation,
    queryId: QueryId | undefined,
  ): T {
    if (!ref || !this.auditedTables.has(ref.realName) || !queryId) {
      return node;
    }
    this.pending.set(queryId, { table: ref.realName, operation });

    if (node.returning) {
      // A caller-specified RETURNING is respected as-is — it narrows what
      // gets captured, which is the documented, tested limitation, not a
      // silently ignored override.
      return node;
    }
    return { ...node, returning: ReturningNode.create([SelectionNode.createSelectAll()]) };
  }
}
