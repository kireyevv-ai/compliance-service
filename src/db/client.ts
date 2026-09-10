import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<QueryResult<T>>;
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }

    pool = new Pool({ connectionString });
  }

  return pool;
}

export async function withTransaction<T>(
  queryable: Pool,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await queryable.connect();

  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
