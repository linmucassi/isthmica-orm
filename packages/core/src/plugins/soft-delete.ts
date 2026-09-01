import {
  AliasNode,
  OperationNodeTransformer,
  TableNode,
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
} from "kysely";

/**
 * Rewrites SELECT queries against configured tables to add
 * `WHERE <deletedAtColumn> IS NULL`, ANDed onto any existing WHERE clause.
 *
 * Built on Kysely's `OperationNodeTransformer` and its operation-node
 * factories (`WhereNode`, `TableNode`, `AliasNode`). Those are marked
 * `@internal` in Kysely's source — there's no publicly documented plugin
 * API for AST rewriting. This is the same mechanism Kysely's own bundled
 * plugins (CamelCasePlugin, DeduplicateJoinsPlugin) use internally, so a
 * breaking change here would break those too, which lowers the practical
 * risk — but it's not a stable contract Kysely has committed to for
 * third-party plugin authors. Revisit this note if a Kysely upgrade breaks it.
 *
 * This only covers the read side. It deliberately does NOT intercept
 * `.deleteFrom()` and rewrite it into an UPDATE — Kysely's plugin API
 * cannot change a query's root operation kind (confirmed via
 * https://github.com/kysely-org/kysely/issues/803, where the only working
 * approach required replacing the QueryExecutor, not the plugin API).
 * The write side of soft delete is a separate, explicit API
 * (`softDelete()` in db.ts) that issues a real UPDATE.
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
    return this.applyFilter(transformed);
  }

  private applyFilter(node: SelectQueryNode): SelectQueryNode {
    const tableNames = this.tableNamesIn(node);
    const targets = tableNames.filter((name) => this.softDeleteTables.has(name));
    if (targets.length === 0) {
      return node;
    }

    // Untyped on purpose: this plugin operates on the raw AST across
    // whatever tables are configured, independent of any single `DB` shape.
    const eb = expressionBuilder<any, any>();
    const checks = targets.map((tableName) =>
      eb(eb.ref(`${tableName}.${this.deletedAtColumn}`), "is", null),
    );
    const filterNode = (checks.length === 1 ? checks[0]! : eb.and(checks)).toOperationNode();

    const where = node.where
      ? WhereNode.cloneWithOperation(node.where, "And", filterNode)
      : WhereNode.create(filterNode);

    return { ...node, where };
  }

  private tableNamesIn(node: SelectQueryNode): string[] {
    const names = new Set<string>();

    for (const from of node.from?.froms ?? []) {
      const name = this.extractTableName(from);
      if (name) names.add(name);
    }
    for (const join of node.joins ?? []) {
      const name = this.extractTableName(join.table);
      if (name) names.add(name);
    }

    return [...names];
  }

  private extractTableName(node: OperationNode): string | undefined {
    if (TableNode.is(node)) {
      return node.table.identifier.name;
    }
    if (AliasNode.is(node) && TableNode.is(node.node)) {
      return node.node.table.identifier.name;
    }
    return undefined;
  }
}
