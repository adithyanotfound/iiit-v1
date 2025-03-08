import express, { Request, Response } from "express";
import { Pool } from "pg";
import fs from "fs";
import { Schema, QueryRequest, TableSchema } from "./types";

const app = express();
app.use(express.json());

// Load schema.json
const schema: Schema = JSON.parse(fs.readFileSync("schema.json", "utf8"));

// Create database connection pools
const dbPools: { [key: string]: Pool } = {};
for (const [dbName, config] of Object.entries(schema.databases)) {
  dbPools[dbName] = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database
  });
}

// Function to fetch data from a database
async function fetchData(
  db: string,
  table: string,
  filters: { [key: string]: any },
  selectFields: string[]
): Promise<any[]> {
  const pool = dbPools[db];
  if (!pool) throw new Error(`Database pool not found for ${db}`);

  // Remove non-column keys from filters
  const validFilters = Object.fromEntries(
    Object.entries(filters).filter(([key]) => key !== "select" && key !== "relations")
  );

  let query = `SELECT ${selectFields.join(", ")} FROM ${table}`;
  let values: any[] = [];

  if (Object.keys(validFilters).length > 0) {
    const whereClause = Object.entries(validFilters)
      .map(([key, value], i) => `${key} = $${i + 1}`)
      .join(" AND ");
    values = Object.values(validFilters);
    query += ` WHERE ${whereClause}`;
  }

  console.log(`Executing Query: ${query} with values ${values}`);

  const result = await pool.query(query, values);
  return result.rows;
}


// Recursive function to process the query
async function resolveQuery(query: QueryRequest): Promise<any> {
  let result: { [key: string]: any } = {};

  for (const [table, options] of Object.entries(query)) {
    const tableSchema: TableSchema | undefined = schema.tables[table];
    if (!tableSchema) throw new Error(`Unknown table: ${table}`);

    // Fetch primary data (e.g., authors)
    const data = await fetchData(
      tableSchema.db,
      table,
      options,
      options.select
    );

    // Process relations
    if (options.relations) {
      for (const row of data) {
        for (const [relName, relOptions] of Object.entries(options.relations)) {
          const relationSchema = tableSchema.relations?.[relName];
          if (!relationSchema) throw new Error(`Unknown relation: ${relName}`);

          // Fetch related data
          row[relName] = await fetchData(
            schema.tables[relationSchema.table].db,
            relationSchema.table,
            { [relationSchema.reference]: row[relationSchema.foreign_key] },
            //@ts-ignore
            relOptions.select
          );
        }
      }
    }

    result[table] = data;
  }

  return result;
}

// Express Route
app.post("/query", async (req: Request, res: Response) => {
  try {
    const query: QueryRequest = req.body;
    const response = await resolveQuery(query);
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Start the server
app.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});
