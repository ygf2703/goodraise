import type pg from "pg";

export interface MigrationContext {
  connectionString: string;
  credentialsDirectory: string;
}

export interface CodeMigration {
  up(client: pg.Client, context: MigrationContext): Promise<string[]>;
}
