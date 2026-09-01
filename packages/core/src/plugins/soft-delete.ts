import {
  OperationNodeTransformer,
  WhereNode,
  expressionBuilder,
  type KyselyPlugin,
  type OperationNode,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type RootOperationNode,
  type SelectQueryNode,
  type UnknownRow,
  type UpdateQueryNode,
} from "kysely";
import { extractTableRef, refsFromFromAndJoins, type TableRef } from "./table-name.js";

/**
 * Rewrites SELECT and UPDATE queries against configured tables to add
 * `WHERE <deletedAtColumn> IS NULL`, ANDed onto any existing WHERE clause.
 *
 * Built on Kysely's `OperationNodeTransformer` and its operation-node
 * factories (`WhereNode`, `TableNode`, `AliasNode`, `IdentifierNode`).
 * Those are marked `@internal` in Kysely's source — there's no publicly
 * documented plugin API for AST rewriting. This is the same mechanism
 * Kysely's own bundled plugins (CamelCasePlugin, DeduplicateJoinsPlugin)
 * use internally, so a breaking change here would break those too, which
 * lowers the practical risk — but it's not a stable contract Kysely has
 * committed to for third-party plugin authors. Revisit this note if a
 * Kysely upgrade breaks it.
 *
 * UPDATE is scoped the same way SELECT is: an UPDATE against a row that's
 * already soft-deleted affects 0 rows by default, unless the query goes
 * through `withDeleted()`. This is a deliberate behavior change from an
 * earlier version of this plugin, which only scoped SELECT.
 *
 * This still deliberately does NOT intercept `.deleteFrom()` and rewrite
 * it into an UPDATE — Kysely's plugin API cannot change a query's root
 * operation kind (confirmed via
 * https://github.com/kysely-org/kysely/issues/803, where the only working
 * approach required replacing the QueryExecutor, not the plugin API).
 * The write side of soft delete is a separate, explicit API
 * (`softDeleteUpdate()` in db.ts) that issues a real UPDATE.
 */
export function createSoftDeletePlugin(options: {
  readonly tables: readonly string[];
  readonly deletedAtColumn?: string;
}): KyselyPlugin {
  const transformer = new SoftDeleteTransformer(
    new Set(options.tables),
    options.deletedAtColumn ?? "deleted_at",
  );

  return {
    transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
      return transformer.transformNode(args.node);
    },
    transformResult(
      args: PluginTransformResultArgs,
    ): Promise<QueryResult<UnknownRow>> {
      return Promise.resolve(args.result);
    },
  };
}

class SoftDeleteTransformer extends OperationNodeTransformer {
  constructor(
    private readonly softDeleteTables: ReadonlySet<string>,
    private readonly deletedAtColumn: string,
  ) {
    super();
  }

  protected override transformSelectQuery(
    node: SelectQueryNode,
    queryId?: Parameters<OperationNodeTransformer["transformSelectQuery"]>[1],
  ): SelectQueryNode {
    const transformed = super.transformSelectQuery(node, queryId);
    return this.applyFilter(transformed, refsFromFromAndJoins(transformed));
  }

  protected override transformUpdateQuery(
    node: UpdateQueryNode,
    queryId?: Parameters<OperationNodeTransformer["transformUpdateQuery"]>[1],
  ): UpdateQueryNode {
    const transformed = super.transformUpdateQuery(node, queryId);
    const refs = [
      ...(transformed.table ? [transformed.table] : []),
      ...refsFromFromAndJoins(transformed),
    ];
    return this.applyFilter(transformed, refs);
  }

  private applyFilter<T extends { readonly where?: WhereNode }>(
    node: T,
    refNodes: readonly OperationNode[],
  ): T {
    const targets = this.resolveTargets(refNodes);
    if (targets.length === 0) {
      return node;
    }

    const eb = expressionBuilder<any, any>();
    const checks = targets.map((target) =>
      eb(eb.ref(`${target.refName}.${this.deletedAtColumn}`), "is", null),
    );
    const filterNode = (checks.length === 1 ? checks[0]! : eb.and(checks)).toOperationNode();

    const where = node.where
      ? WhereNode.cloneWithOperation(node.where, "And", filterNode)
      : WhereNode.create(filterNode);

    return { ...node, where };
  }

  private resolveTargets(refNodes: readonly OperationNode[]): TableRef[] {
    const seenRefNames = new Set<string>();
    const targets: TableRef[] = [];

    for (const node of refNodes) {
      const ref = extractTableRef(node);
      if (!ref || !this.softDeleteTables.has(ref.realName) || seenRefNames.has(ref.refName)) {
        continue;
      }
      seenRefNames.add(ref.refName);
      targets.push(ref);
    }

    return targets;
  }
}
