import { Connection } from '../db/connections';
import { queryDb } from '../db/db';

interface GetPostgresLogsParams {
  connection: Connection;
  periodInSeconds?: number;
  asUserId?: string;
  grep?: string;
}

interface PostgresRow {
  [key: string]: any;
}

interface PostgresResult {
  rows: PostgresRow[];
}

/**
 * 从已连接的 PostgreSQL 实例获取日志信息
 *
 * 支持以下日志类型：
 * - 错误日志 (pg_stat_activity)
 * - 慢查询日志 (pg_stat_statements)
 * - 连接日志 (pg_stat_activity)
 * - 事务日志 (pg_stat_database)
 */
export const getPostgresLogs = async (params: GetPostgresLogsParams): Promise<string> => {
  const { asUserId } = params;

  try {
    const errorLogs = await getErrorLogs({ asUserId });
    const slowQueryLogs = await getSlowQueryLogs({ asUserId });
    const connectionLogs = await getConnectionLogs({ asUserId });
    const transactionLogs = await getTransactionLogs({ asUserId });

    const allLogs = [
      '=== Error Logs ===',
      errorLogs,
      '\n=== Slow Query Logs ===',
      slowQueryLogs,
      '\n=== Connection Logs ===',
      connectionLogs,
      '\n=== Transaction Logs ===',
      transactionLogs
    ].join('\n');

    return allLogs;
  } catch (error) {
    console.error('Error getting PostgreSQL logs:', error);
    return `Error retrieving logs: ${error instanceof Error ? error.message : String(error)}`;
  }
};

/**
 * 获取错误日志
 */
const getErrorLogs = async (params: { asUserId?: string }): Promise<string> => {
  const { asUserId } = params;
  const result = await queryDb<PostgresResult>(
    async ({ db }) => {
      return await db.execute(`SELECT 
        pid,
        usename as user,
        application_name,
        client_addr,
        state,
        wait_event_type,
        wait_event,
        query_start,
        state_change,
        query
      FROM pg_stat_activity
      WHERE datname = current_database()
      AND state = 'active'
      AND query NOT LIKE '%pg_stat_activity%'
      AND query NOT LIKE '%pg_stat_database%'
      ORDER BY query_start DESC
      LIMIT 100`);
    },
    { asUserId }
  );

  if (!result.rows.length) {
    return 'No error logs found.';
  }

  return result.rows
    .map((row: PostgresRow) => {
      const waitInfo =
        row.wait_event_type && row.wait_event ? `\nWaiting: ${row.wait_event_type} - ${row.wait_event}` : '';
      return `[${row.pid}] ${row.user}@${row.application_name || 'unknown'} (${row.client_addr || 'local'})
State: ${row.state || 'idle'}
Started: ${row.query_start}
Last State Change: ${row.state_change || 'N/A'}${waitInfo}
Query: ${row.query || 'N/A'}`;
    })
    .join('\n\n');
};

/**
 * 获取慢查询日志
 */
const getSlowQueryLogs = async (params: { asUserId?: string }): Promise<string> => {
  const { asUserId } = params;

  // First check if pg_stat_statements extension is installed
  const extensionResult = await queryDb<PostgresResult>(
    async ({ db }) => {
      return await db.execute(`SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
      ) as exists`);
    },
    { asUserId }
  );

  const extensionExists = extensionResult.rows[0]?.exists === true;
  if (!extensionExists) {
    return 'pg_stat_statements extension is not installed. Slow query logging is not available.';
  }

  const result = await queryDb<PostgresResult>(
    async ({ db }) => {
      return await db.execute(`SELECT 
        query,
        calls,
        total_exec_time,
        mean_exec_time,
        rows
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY total_exec_time DESC
      LIMIT 20`);
    },
    { asUserId }
  );

  if (!result.rows.length) {
    return 'No slow query logs found.';
  }

  return result.rows
    .map(
      (row: PostgresRow) => `Query: ${row.query}
Calls: ${row.calls}
Total Time: ${row.total_exec_time.toFixed(2)}ms
Mean Time: ${row.mean_exec_time.toFixed(2)}ms
Rows: ${row.rows}`
    )
    .join('\n\n');
};

/**
 * 获取连接日志
 */
const getConnectionLogs = async (params: { asUserId?: string }): Promise<string> => {
  const { asUserId } = params;
  const result = await queryDb<PostgresResult>(
    async ({ db }) => {
      return await db.execute(`SELECT 
        pid,
        usename as user,
        application_name,
        client_addr,
        state,
        wait_event_type,
        wait_event,
        query_start,
        state_change,
        query
      FROM pg_stat_activity
      WHERE datname = current_database()
      ORDER BY query_start DESC
      LIMIT 100`);
    },
    { asUserId }
  );

  if (!result.rows.length) {
    return 'No active connections found.';
  }

  return result.rows
    .map((row: PostgresRow) => {
      const waitInfo =
        row.wait_event_type && row.wait_event ? `\nWaiting: ${row.wait_event_type} - ${row.wait_event}` : '';
      return `[${row.pid}] ${row.user}@${row.application_name || 'unknown'} (${row.client_addr || 'local'})
State: ${row.state || 'idle'}
Started: ${row.query_start}
Last State Change: ${row.state_change || 'N/A'}${waitInfo}
Query: ${row.query || 'N/A'}`;
    })
    .join('\n\n');
};

/**
 * 获取事务日志
 */
const getTransactionLogs = async (params: { asUserId?: string }): Promise<string> => {
  const { asUserId } = params;
  const result = await queryDb<PostgresResult>(
    async ({ db }) => {
      return await db.execute(`SELECT 
        datname,
        xact_commit,
        xact_rollback,
        blks_read,
        blks_hit,
        tup_returned,
        tup_fetched,
        tup_inserted,
        tup_updated,
        tup_deleted
      FROM pg_stat_database
      WHERE datname = current_database()`);
    },
    { asUserId }
  );

  if (!result.rows.length) {
    return 'No transaction statistics found.';
  }

  const stats = result.rows[0];
  if (!stats) {
    return 'No transaction statistics found.';
  }

  const blksHit = Number(stats.blks_hit) || 0;
  const blksRead = Number(stats.blks_read) || 0;
  const hitRatio = blksHit + blksRead > 0 ? ((blksHit / (blksHit + blksRead)) * 100).toFixed(2) : '0.00';

  return `Database: ${stats.datname}
Transactions:
  Committed: ${stats.xact_commit}
  Rolled Back: ${stats.xact_rollback}
Block Statistics:
  Read: ${stats.blks_read}
  Hit: ${stats.blks_hit}
  Hit Ratio: ${hitRatio}%
Tuple Statistics:
  Returned: ${stats.tup_returned}
  Fetched: ${stats.tup_fetched}
  Inserted: ${stats.tup_inserted}
  Updated: ${stats.tup_updated}
  Deleted: ${stats.tup_deleted}`;
};
