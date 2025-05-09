import { anthropic } from '@ai-sdk/anthropic';
import { createDeepSeek, deepseek } from '@ai-sdk/deepseek';
import { openai } from '@ai-sdk/openai';
import { LanguageModelV1, Tool } from 'ai';
import { Connection } from '~/lib/db/connections';
import { env } from '~/lib/env/server';
import { commonToolset, getDBClusterTools, getDBSQLTools, mergeToolsets, playbookToolset } from './tools';

export const commonSystemPrompt = `
You are an AI assistant expert in PostgreSQL and database administration.
Your name is Xata Agent.
Always answer SUCCINCTLY and to the point.
Be CONCISE.
`;

export const chatSystemPrompt = `${commonSystemPrompt}
Provide clear, concise, and accurate responses to questions.
Use the provided tools to get context from the PostgreSQL database to answer questions.
When asked why a query is slow, call the explainQuery tool and also take into account the table sizes.
During the initial assessment use the getTablesAndInstanceInfo, getPerfromanceAndVacuumSettings,
and getPostgresExtensions tools.
When asked to run a playbook, use the getPlaybook tool to get the playbook contents. Then use the contents of the playbook
as an action plan. Execute the plan step by step.
`;

export const monitoringSystemPrompt = `${commonSystemPrompt}
You are now executing a periodic monitoring task.
You are provided with a playbook name and a set of tools that you can use to execute the playbook.
First thing you need to do is call the getPlaybook tool to get the playbook contents.
Then use the contents of the playbook as an action plan. Execute the plan step by step.
At the end of your execution, print a summary of the results.
`;

export async function getTools(connection: Connection, asUserId?: string): Promise<Record<string, Tool>> {
  const dbTools = getDBSQLTools(connection.connectionString);
  const clusterTools = getDBClusterTools(connection, asUserId);
  return mergeToolsets(commonToolset, playbookToolset, dbTools, clusterTools);
}

export function getModelInstance(model: string): LanguageModelV1 {
  if (model.startsWith('openai-')) {
    return openai(model.replace('openai-', ''));
  } else if (model.startsWith('deepseek-')) {
    if (env.DEEPSEEK_URL) {
      return createDeepSeek({ baseURL: env.DEEPSEEK_URL })(env.DEEPSEEK_NAME || model);
    } else {
      return deepseek(model);
    }
  } else if (model.startsWith('anthropic-')) {
    return anthropic(model.replace('anthropic-', ''));
  } else {
    throw new Error('Invalid model');
  }
}
