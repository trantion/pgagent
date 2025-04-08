import { Connection } from '../db/connections';
import { queryDb } from '../db/db';

export type PostgresMetricType =
  | 'cpu_utilization'
  | 'memory_utilization'
  | 'disk_utilization'
  | 'connection_count'
  | 'transaction_rate'
  | 'cache_hit_ratio'
  | 'index_usage'
  | 'table_size'
  | 'index_size'
  | 'vacuum_status';

export interface PostgresMetricParams {
  connection: Connection;
  metricType: PostgresMetricType | PostgresMetricType[];
  periodInSeconds?: number;
  asUserId?: string;
}

export interface PostgresMetricResult {
  timestamp: Date;
  value: number;
  details?: Record<string, any>;
}

export interface PostgresMetricsResult {
  timestamp: Date;
  metrics: Record<PostgresMetricType, PostgresMetricResult>;
}

async function getMaxConnections(connection: Connection, asUserId?: string): Promise<string> {
  const result = await queryDb(
    async ({ db }) => {
      const query = `SELECT current_setting('max_connections') as max_connections;`;
      return await db.execute(query);
    },
    { asUserId }
  );
  const rows = result.rows || [];
  // Add more explicit type checking
  const firstRow = rows[0];
  if (firstRow && 'max_connections' in firstRow) {
    return String(firstRow.max_connections);
  }
  return '100';
}

async function getDatabaseSize(connection: Connection, asUserId?: string): Promise<string> {
  const result = await queryDb(
    async ({ db }) => {
      const query = `SELECT pg_database_size(current_database()) as database_size;`;
      return await db.execute(query);
    },
    { asUserId }
  );
  const rows = result.rows || [];
  // Add more explicit type checking
  const firstRow = rows[0];
  if (firstRow && 'database_size' in firstRow) {
    return String(firstRow.database_size);
  }
  return '0';
}

export async function getPostgresMetrics({
  connection,
  metricType,
  periodInSeconds = 300,
  asUserId
}: PostgresMetricParams): Promise<PostgresMetricResult[] | PostgresMetricsResult[]> {
  if (typeof metricType === 'string') {
    return getSingleMetric(connection, metricType, periodInSeconds, asUserId);
  }

  return getMultipleMetrics(connection, metricType, periodInSeconds, asUserId);
}

async function getSingleMetric(
  connection: Connection,
  metricType: PostgresMetricType,
  periodInSeconds: number,
  asUserId?: string
): Promise<PostgresMetricResult[]> {
  switch (metricType) {
    case 'cpu_utilization':
      return getCPUUtilization(connection, asUserId);
    case 'memory_utilization':
      return getMemoryUtilization(connection, asUserId);
    case 'disk_utilization':
      return getDiskUtilization(connection, asUserId);
    case 'connection_count':
      return getConnectionCount(connection, asUserId);
    case 'transaction_rate':
      return getTransactionRate(connection, periodInSeconds, asUserId);
    case 'cache_hit_ratio':
      return getCacheHitRatio(connection, asUserId);
    case 'index_usage':
      return getIndexUsage(connection, asUserId);
    case 'table_size':
      return getTableSize(connection, asUserId);
    case 'index_size':
      return getIndexSize(connection, asUserId);
    case 'vacuum_status':
      return getVacuumStatus(connection, asUserId);
    default:
      throw new Error(`Unsupported metric type: ${metricType}`);
  }
}

async function getMultipleMetrics(
  connection: Connection,
  metricTypes: PostgresMetricType[],
  periodInSeconds: number,
  asUserId?: string
): Promise<PostgresMetricsResult[]> {
  const timestamp = new Date();

  const metricPromises = metricTypes.map(async (type) => {
    try {
      const results = await getSingleMetric(connection, type, periodInSeconds, asUserId);
      return { type, result: results[0] || { timestamp, value: 0 } };
    } catch (error) {
      console.error(`Error getting metric ${type}:`, error);
      return {
        type,
        result: {
          timestamp,
          value: 0,
          details: { error: error instanceof Error ? error.message : String(error) }
        }
      };
    }
  });

  const metricResults = await Promise.all(metricPromises);

  const metricsRecord: Record<PostgresMetricType, PostgresMetricResult> = {} as Record<
    PostgresMetricType,
    PostgresMetricResult
  >;

  metricResults.forEach(({ type, result }) => {
    metricsRecord[type] = result;
  });

  return [
    {
      timestamp,
      metrics: metricsRecord
    }
  ];
}

async function getCPUUtilization(connection: Connection, asUserId?: string): Promise<PostgresMetricResult[]> {
  const result = await queryDb(
    async ({ db }) => {
      const query = `
        WITH cpu_metrics AS (
          SELECT 
            now() as timestamp,
            (SELECT count(*) FROM pg_stat_activity WHERE state = 'active')::float / 
            (SELECT current_setting('max_connections')::float) * 100 as cpu_utilization
        )
        SELECT * FROM cpu_metrics;
      `;

      return await db.execute(query);
    },
    { asUserId }
  );

  if (result && result.rows && result.rows.length > 0) {
    const maxConnections = await getMaxConnections(connection, asUserId);
    return result.rows.map((row) => {
      // Type assertion for row properties
      const timestamp = row.timestamp as string | Date;
      const cpuUtilization = row.cpu_utilization as string | number;

      return {
        timestamp: new Date(timestamp),
        value: parseFloat(String(cpuUtilization)) || 0,
        details: {
          active_connections: cpuUtilization
            ? Math.round((parseFloat(String(cpuUtilization)) * parseFloat(maxConnections)) / 100)
            : 0,
          max_connections: maxConnections
        }
      };
    });
  }

  return [];
}

async function getMemoryUtilization(connection: Connection, asUserId?: string): Promise<PostgresMetricResult[]> {
  const result = await queryDb(
    async ({ db }) => {
      const query = `
        WITH memory_metrics AS (
          SELECT 
            now() as timestamp,
            (SELECT sum(shared_buffers)::float / 
             (SELECT current_setting('shared_buffers')::float)) * 100 as memory_utilization
        )
        SELECT * FROM memory_metrics;
      `;

      return await db.execute(query);
    },
    { asUserId }
  );

  if (result && result.rows && result.rows.length > 0) {
    return result.rows.map((row) => {
      // Type assertion for row properties
      const timestamp = row.timestamp as string | Date;
      const memoryUtilization = row.memory_utilization as string | number;

      return {
        timestamp: new Date(timestamp),
        value: parseFloat(String(memoryUtilization)) || 0,
        details: {
          shared_buffers: memoryUtilization ? Math.round(parseFloat(String(memoryUtilization))) : 0
        }
      };
    });
  }

  return [];
}

async function getDiskUtilization(connection: Connection, asUserId?: string): Promise<PostgresMetricResult[]> {
  const result = await queryDb(
    async ({ db }) => {
      const query = `
        WITH disk_metrics AS (
          SELECT 
            now() as timestamp,
            (SELECT pg_database_size(current_database()))::float / 
            (SELECT pg_size_file('pg_stat_tmp/pg_stat.stat')) * 100 as disk_utilization
        )
        SELECT * FROM disk_metrics;
      `;

      return await db.execute(query);
    },
    { asUserId }
  );

  if (result && result.rows && result.rows.length > 0) {
    const databaseSize = await getDatabaseSize(connection, asUserId);
    return result.rows.map((row) => {
      // Type assertion for row properties
      const timestamp = row.timestamp as string | Date;
      const diskUtilization = row.disk_utilization as string | number;

      return {
        timestamp: new Date(timestamp),
        value: parseFloat(String(diskUtilization)) || 0,
        details: {
          database_size: diskUtilization
            ? Math.round((parseFloat(String(diskUtilization)) * parseFloat(databaseSize)) / 100)
            : 0,
          total_size: databaseSize
        }
      };
    });
  }

  return [];
}

async function getConnectionCount(connection: Connection, asUserId?: string): Promise<PostgresMetricResult[]> {
  const result = await queryDb(
    async ({ db }) => {
      const query = `
        WITH connection_metrics AS (
          SELECT 
            now() as timestamp,
            (SELECT count(*) FROM pg_stat_activity) as connection_count,
            (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
            (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') as idle_connections,
            (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction') as idle_in_transaction_connections
        )
        SELECT * FROM connection_metrics;
      `;

      return await db.execute(query);
    },
    { asUserId }
  );

  if (result && result.rows && result.rows.length > 0) {
    const maxConnections = await getMaxConnections(connection, asUserId);
    return result.rows.map((row) => {
      // Type assertion for row properties
      const timestamp = row.timestamp as string | Date;
      const connectionCount = row.connection_count as string | number;
      const activeConnections = row.active_connections as string | number;
      const idleConnections = row.idle_connections as string | number;
      const idleInTransactionConnections = row.idle_in_transaction_connections as string | number;

      return {
        timestamp: new Date(timestamp),
        value: parseFloat(String(connectionCount)) || 0,
        details: {
          active_connections: parseFloat(String(activeConnections)) || 0,
          idle_connections: parseFloat(String(idleConnections)) || 0,
          idle_in_transaction_connections: parseFloat(String(idleInTransactionConnections)) || 0,
          max_connections: maxConnections
        }
      };
    });
  }

  return [];
}

async function getTransactionRate(
  connection: Connection,
  periodInSeconds: number,
  asUserId?: string
): Promise<PostgresMetricResult[]> {
  const result = await queryDb(
    async ({ db }) => {
      const query = `
        WITH transaction_metrics AS (
          SELECT 
            now() as timestamp,
            (SELECT sum(xact_commit + xact_rollback)::float / ${periodInSeconds} 
             FROM pg_stat_database 
             WHERE datname = current_database()) as transaction_rate
        )
        SELECT * FROM transaction_metrics;
      `;

      return await db.execute(query);
    },
    { asUserId }
  );

  if (result && result.rows && result.rows.length > 0) {
    return result.rows.map((row) => {
      // Type assertion for row properties
      const timestamp = row.timestamp as string | Date;
      const transactionRate = row.transaction_rate as string | number;

      return {
        timestamp: new Date(timestamp),
        value: parseFloat(String(transactionRate)) || 0,
        details: {
          transactions_per_second: parseFloat(String(transactionRate)) || 0
        }
      };
    });
  }

  return [];
}

async function getCacheHitRatio(connection: Connection, asUserId?: string): Promise<PostgresMetricResult[]> {
  const result = await queryDb(
    async ({ db }) => {
      const query = `
        WITH cache_metrics AS (
          SELECT 
            now() as timestamp,
            (SELECT sum(heap_blks_hit)::float / 
             NULLIF(sum(heap_blks_hit + heap_blks_read), 0) * 100
             FROM pg_statio_user_tables) as cache_hit_ratio
        )
        SELECT * FROM cache_metrics;
      `;

      return await db.execute(query);
    },
    { asUserId }
  );

  if (result && result.rows && result.rows.length > 0) {
    return result.rows.map((row) => {
      // Type assertion for row properties
      const timestamp = row.timestamp as string | Date;
      const cacheHitRatio = row.cache_hit_ratio as string | number;

      return {
        timestamp: new Date(timestamp),
        value: parseFloat(String(cacheHitRatio)) || 0,
        details: {
          hit_ratio_percentage: parseFloat(String(cacheHitRatio)) || 0
        }
      };
    });
  }

  return [];
}

async function getIndexUsage(connection: Connection, asUserId?: string): Promise<PostgresMetricResult[]> {
  const result = await queryDb(
    async ({ db }) => {
      const query = `
        WITH index_metrics AS (
          SELECT 
            now() as timestamp,
            (SELECT sum(idx_scan)::float / 
             NULLIF(sum(idx_scan + seq_scan), 0) * 100
             FROM pg_stat_user_tables) as index_usage_ratio
        )
        SELECT * FROM index_metrics;
      `;

      return await db.execute(query);
    },
    { asUserId }
  );

  if (result && result.rows && result.rows.length > 0) {
    return result.rows.map((row) => {
      // Type assertion for row properties
      const timestamp = row.timestamp as string | Date;
      const indexUsageRatio = row.index_usage_ratio as string | number;

      return {
        timestamp: new Date(timestamp),
        value: parseFloat(String(indexUsageRatio)) || 0,
        details: {
          index_usage_percentage: parseFloat(String(indexUsageRatio)) || 0
        }
      };
    });
  }

  return [];
}

async function getTableSize(connection: Connection, asUserId?: string): Promise<PostgresMetricResult[]> {
  const result = await queryDb(
    async ({ db }) => {
      const query = `
        WITH table_metrics AS (
          SELECT 
            now() as timestamp,
            (SELECT sum(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename)))::float
             FROM pg_tables
             WHERE schemaname NOT IN ('pg_catalog', 'information_schema')) as total_table_size
        )
        SELECT * FROM table_metrics;
      `;

      return await db.execute(query);
    },
    { asUserId }
  );

  if (result && result.rows && result.rows.length > 0) {
    return result.rows.map((row) => {
      // Type assertion for row properties
      const timestamp = row.timestamp as string | Date;
      const totalTableSize = row.total_table_size as string | number;

      return {
        timestamp: new Date(timestamp),
        value: parseFloat(String(totalTableSize)) || 0,
        details: {
          total_size_bytes: parseFloat(String(totalTableSize)) || 0
        }
      };
    });
  }

  return [];
}

async function getIndexSize(connection: Connection, asUserId?: string): Promise<PostgresMetricResult[]> {
  const result = await queryDb(
    async ({ db }) => {
      const query = `
        WITH index_metrics AS (
          SELECT 
            now() as timestamp,
            (SELECT sum(pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(indexname)))::float
             FROM pg_indexes
             WHERE schemaname NOT IN ('pg_catalog', 'information_schema')) as total_index_size
        )
        SELECT * FROM index_metrics;
      `;

      return await db.execute(query);
    },
    { asUserId }
  );

  if (result && result.rows && result.rows.length > 0) {
    return result.rows.map((row) => {
      // Type assertion for row properties
      const timestamp = row.timestamp as string | Date;
      const totalIndexSize = row.total_index_size as string | number;

      return {
        timestamp: new Date(timestamp),
        value: parseFloat(String(totalIndexSize)) || 0,
        details: {
          total_size_bytes: parseFloat(String(totalIndexSize)) || 0
        }
      };
    });
  }

  return [];
}

async function getVacuumStatus(connection: Connection, asUserId?: string): Promise<PostgresMetricResult[]> {
  const result = await queryDb(
    async ({ db }) => {
      const query = `
        WITH vacuum_metrics AS (
          SELECT 
            now() as timestamp,
            (SELECT count(*)::float
             FROM pg_stat_user_tables
             WHERE n_dead_tup > 0) as tables_needing_vacuum
        )
        SELECT * FROM vacuum_metrics;
      `;

      return await db.execute(query);
    },
    { asUserId }
  );

  if (result && result.rows && result.rows.length > 0) {
    return result.rows.map((row) => {
      // Type assertion for row properties
      const timestamp = row.timestamp as string | Date;
      const tablesNeedingVacuum = row.tables_needing_vacuum as string | number;

      return {
        timestamp: new Date(timestamp),
        value: parseFloat(String(tablesNeedingVacuum)) || 0,
        details: {
          tables_needing_vacuum: parseFloat(String(tablesNeedingVacuum)) || 0
        }
      };
    });
  }

  return [];
}
