import { tool, Tool } from 'ai';
import { z } from 'zod';
import { Connection } from '~/lib/db/connections';
import { getPostgresExtensions, getTablesAndInstanceInfo } from '~/lib/tools/dbinfo';
import { getPostgresLogs } from '~/lib/tools/postgres-logs';
import { getPostgresMetrics, PostgresMetricResult } from '~/lib/tools/postgres-metrics';
import { ToolsetGroup } from './types';

export function getDBClusterTools(connection: Connection, asUserId?: string): Record<string, Tool> {
  return new DBClusterTools(() => Promise.resolve({ connection, asUserId })).toolset();
}

// The DBClusterTools toolset provides agent tools for accessing information about AWS RDS instance and cluster.
export class DBClusterTools implements ToolsetGroup {
  private _connection: () => Promise<{ connection: Connection; asUserId?: string }>;

  constructor(getter: () => Promise<{ connection: Connection; asUserId?: string }>) {
    this._connection = getter;
  }

  toolset(): Record<string, Tool> {
    return {
      getTablesAndInstanceInfo: this.getTablesAndInstanceInfo(),
      getPostgresExtensions: this.getPostgresExtensions(),
      getInstanceLogs: this.getInstanceLogs(),
      getInstanceMetric: this.getInstanceMetric()
    };
  }

  private getTablesAndInstanceInfo(): Tool {
    const getter = this._connection;
    return tool({
      description: `Get the information about tables (sizes, row counts, usage) and the data about server
instance/cluster on which the DB is running. Useful during the initial assessment.`,
      parameters: z.object({}),
      execute: async () => {
        const { connection, asUserId } = await getter();
        return await getTablesAndInstanceInfo(connection, asUserId);
      }
    });
  }

  private getPostgresExtensions(): Tool {
    const getter = this._connection;
    return tool({
      description: `Get the available and installed PostgreSQL extensions for the database.`,
      parameters: z.object({}),
      execute: async () => {
        const { connection, asUserId } = await getter();
        return await getPostgresExtensions(connection, asUserId);
      }
    });
  }

  private getInstanceLogs(): Tool {
    const getter = this._connection;
    return tool({
      description: `Get the recent logs from the RDS instance. You can specify the period in seconds and optionally grep for a substring.`,
      parameters: z.object({
        periodInSeconds: z.number(),
        grep: z.string().optional()
      }),
      execute: async ({ periodInSeconds, grep }) => {
        console.log('getInstanceLogs', periodInSeconds, grep);
        const { connection, asUserId } = await getter();
        return await getPostgresLogs({ connection, periodInSeconds, grep, asUserId });
        // return await getInstanceLogs({ connection, periodInSeconds, grep, asUserId });
      }
    });
  }

  private getInstanceMetric(): Tool {
    const getter = this._connection;
    return tool({
      description: `Get the metrics for the PostgreSQL instance. Supported metrics: cpu_utilization, memory_utilization, disk_utilization, connection_count, transaction_rate, cache_hit_ratio, index_usage, table_size, index_size, vacuum_status.`,
      parameters: z.object({
        metricName: z.enum([
          'cpu_utilization',
          'memory_utilization',
          'disk_utilization',
          'connection_count',
          'transaction_rate',
          'cache_hit_ratio',
          'index_usage',
          'table_size',
          'index_size',
          'vacuum_status'
        ]),
        periodInSeconds: z.number()
      }),
      execute: async ({ metricName, periodInSeconds }) => {
        console.log('getInstanceMetric', metricName, periodInSeconds);
        const { connection, asUserId } = await getter();
        try {
          const result = await getPostgresMetrics({
            connection,
            metricType: metricName,
            periodInSeconds,
            asUserId
          });

          if (!Array.isArray(result) || result.length === 0) {
            return 'No metrics data available';
          }

          // Handle PostgresMetricResult[]
          return (result as PostgresMetricResult[])
            .map(
              (r) =>
                `${r.timestamp.toISOString()}: ${r.value}${r.details ? '\nDetails: ' + JSON.stringify(r.details) : ''}`
            )
            .join('\n');
        } catch (error) {
          console.error('Error getting metrics:', error);
          return `Error getting metrics: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    });
  }
}
