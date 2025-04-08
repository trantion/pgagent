-- Create the dbagent database if it doesn't exist
SELECT 'CREATE DATABASE dbagent' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'dbagent');

-- Enable pg_stat_statements extension
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;