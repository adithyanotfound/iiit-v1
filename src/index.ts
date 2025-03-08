import express, { Request, Response } from "express";
import { Pool, QueryResult } from "pg";
import fs from "fs";
import { Schema, QueryRequest, TableSchema } from "./types";

const app = express();
app.use(express.json());

// Load schema.json
let schema: Schema;
try {
  schema = JSON.parse(fs.readFileSync("schema.json", "utf8"));
} catch (error) {
  console.error("Failed to load schema.json:", error);
  process.exit(1);
}

// Create database connection pools
const dbPools: { [key: string]: Pool } = {};
for (const [dbName, config] of Object.entries(schema.databases)) {
  try {
    dbPools[dbName] = new Pool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      // Add connection timeout and pool settings
      connectionTimeoutMillis: 5000,
      max: 20,
      idleTimeoutMillis: 30000,
    });
    
    // Test connection
    dbPools[dbName].query('SELECT 1').catch(err => {
      console.error(`Failed to connect to database ${dbName}:`, err);
    });
  } catch (error) {
    console.error(`Failed to create pool for database ${dbName}:`, error);
  }
}

// Function to validate a table and its fields
function validateTable(table: string, fields: string[] = []): TableSchema {
  const tableSchema = schema.tables[table];
  if (!tableSchema) throw new Error(`Table ${table} not found in schema`);
  
  // Validate fields if provided
  fields.forEach((field) => {
    if (!tableSchema.columns.includes(field)) {
      throw new Error(`Column ${field} is not defined in schema for table ${table}`);
    }
  });
  
  return tableSchema;
}

// Function to build a WHERE clause from filters
function buildWhereClause(
  filters: { [key: string]: any },
  tableSchema: TableSchema,
  startIndex: number = 1
): { clause: string; values: any[]; paramCount: number } {
  let conditions: string[] = [];
  let values: any[] = [];
  let paramCount = startIndex;

  // Filter out special keys
  const validFilters = Object.fromEntries(
    Object.entries(filters).filter(([key]) => 
      key !== "select" && 
      key !== "relations" && 
      key !== "orderBy" && 
      key !== "limit" && 
      key !== "offset" &&
      key !== "groupBy"
    )
  );

  Object.entries(validFilters).forEach(([key, value]) => {
    // Validate column exists in schema
    if (!tableSchema.columns.includes(key)) {
      throw new Error(`Column ${key} is not defined in schema for table ${tableSchema.db}.${tableSchema}`);
    }

    if (value === null) {
      conditions.push(`${key} IS NULL`);
    } else if (typeof value === "object") {
      const operatorMap: { [key: string]: string } = {
        gt: ">",
        lt: "<",
        gte: ">=",
        lte: "<=",
        like: "LIKE",
        ilike: "ILIKE",
        neq: "!=",
        in: "IN",
        notIn: "NOT IN",
        between: "BETWEEN",
        isNull: "IS NULL",
        isNotNull: "IS NOT NULL"
      };

      const [opKey, opValue] = Object.entries(value)[0];
      
      if (opKey === "isNull") {
        conditions.push(`${key} IS NULL`);
      } else if (opKey === "isNotNull") {
        conditions.push(`${key} IS NOT NULL`);
      } else if (opKey === "in" || opKey === "notIn") {
        if (!Array.isArray(opValue) || opValue.length === 0) {
          throw new Error(`Value for ${opKey} operator must be a non-empty array`);
        }
        
        const placeholders = opValue.map((_, i) => `$${paramCount + i}`).join(', ');
        conditions.push(`${key} ${operatorMap[opKey]} (${placeholders})`);
        values.push(...opValue);
        paramCount += opValue.length;
      } else if (opKey === "between") {
        if (!Array.isArray(opValue) || opValue.length !== 2) {
          throw new Error("BETWEEN operator requires array with exactly 2 values");
        }
        
        conditions.push(`${key} BETWEEN $${paramCount} AND $${paramCount + 1}`);
        values.push(opValue[0], opValue[1]);
        paramCount += 2;
      } else if (operatorMap[opKey]) {
        conditions.push(`${key} ${operatorMap[opKey]} $${paramCount}`);
        values.push(opValue);
        paramCount++;
      } else {
        throw new Error(`Unknown operator: ${opKey}`);
      }
    } else {
      conditions.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  });

  return {
    clause: conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "",
    values,
    paramCount
  };
}

// Function to build an ORDER BY clause
function buildOrderByClause(
  orderBy: string | string[] | { [key: string]: 'ASC' | 'DESC' } | undefined,
  tableSchema: TableSchema
): string {
  if (!orderBy) return "";
  
  let orderClauses: string[] = [];
  
  if (typeof orderBy === 'string') {
    if (!tableSchema.columns.includes(orderBy)) {
      throw new Error(`Column ${orderBy} is not defined in schema for sorting`);
    }
    orderClauses.push(`${orderBy} ASC`);
  } else if (Array.isArray(orderBy)) {
    orderBy.forEach(field => {
      if (!tableSchema.columns.includes(field)) {
        throw new Error(`Column ${field} is not defined in schema for sorting`);
      }
      orderClauses.push(`${field} ASC`);
    });
  } else if (typeof orderBy === 'object') {
    Object.entries(orderBy).forEach(([field, direction]) => {
      if (!tableSchema.columns.includes(field)) {
        throw new Error(`Column ${field} is not defined in schema for sorting`);
      }
      orderClauses.push(`${field} ${direction}`);
    });
  }
  
  return orderClauses.length > 0 ? ` ORDER BY ${orderClauses.join(", ")}` : "";
}

// Enhanced function to fetch data from a database
async function fetchData(
  db: string,
  table: string,
  options: { 
    [key: string]: any,
    select?: string[],
    orderBy?: string | string[] | { [key: string]: 'ASC' | 'DESC' },
    limit?: number,
    offset?: number,
    groupBy?: string[]
  },
  selectFields: string[]
): Promise<any[]> {
  const pool = dbPools[db];
  if (!pool) throw new Error(`Database pool not found for ${db}`);

  const tableSchema = validateTable(table, selectFields);

  // Start building the query
  let query = `SELECT ${selectFields.join(", ")} FROM ${table}`;
  
  // Build WHERE clause
  const { clause, values, paramCount } = buildWhereClause(options, tableSchema);
  query += clause;
  
  // Add GROUP BY if needed
  if (options.groupBy && Array.isArray(options.groupBy)) {
    options.groupBy.forEach(field => {
      if (!tableSchema.columns.includes(field)) {
        throw new Error(`Column ${field} is not defined in schema for grouping`);
      }
    });
    query += ` GROUP BY ${options.groupBy.join(", ")}`;
  }
  
  // Add ORDER BY
  query += buildOrderByClause(options.orderBy, tableSchema);
  
  // Add LIMIT and OFFSET
  if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
    query += ` LIMIT ${options.limit}`;
  }
  
  if (options.offset && Number.isInteger(options.offset) && options.offset >= 0) {
    query += ` OFFSET ${options.offset}`;
  }

  try {
    console.log(`Executing Query: ${query} with values:`, values);
    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    console.error(`Database query failed:`, error);
    throw new Error(`Database query failed: ${(error as Error).message}`);
  }
}

// Function to get database connection for a table
function getDbPoolForTable(table: string): Pool {
  const tableSchema = schema.tables[table];
  if (!tableSchema) throw new Error(`Table ${table} not found in schema`);
  
  const pool = dbPools[tableSchema.db];
  if (!pool) throw new Error(`Database pool not found for ${tableSchema.db}`);
  
  return pool;
}

// Function to execute raw SQL (for special cases)
async function executeRawSql(dbName: string, sql: string, params: any[] = []): Promise<QueryResult> {
  const pool = dbPools[dbName];
  if (!pool) throw new Error(`Database pool not found for ${dbName}`);
  
  try {
    return await pool.query(sql, params);
  } catch (error) {
    throw new Error(`Raw SQL execution failed: ${(error as Error).message}`);
  }
}

// Enhanced recursive function to process the query
async function resolveQuery(query: QueryRequest): Promise<any> {
  let result: { [key: string]: any } = {};

  for (const [table, options] of Object.entries(query)) {
    const tableSchema = validateTable(table);
    
    // Set default select if not provided
    if (!options.select || options.select.length === 0) {
      options.select = tableSchema.columns;
    } else {
      // Validate select fields
      options.select.forEach((field) => {
        if (!tableSchema.columns.includes(field)) {
          throw new Error(`Column ${field} is not defined in schema for table ${table}`);
        }
      });
    }

    // Fetch primary data
    const data = await fetchData(tableSchema.db, table, options, options.select);

    // Process relations
    if (options.relations && data.length > 0) {
      for (const row of data) {
        for (const [relName, relOptions] of Object.entries(options.relations)) {
          const relationSchema = tableSchema.relations?.[relName];
          if (!relationSchema) throw new Error(`Unknown relation: ${relName} for table ${table}`);

          const relatedTableSchema = schema.tables[relationSchema.table];
          if (!relatedTableSchema) throw new Error(`Related table ${relationSchema.table} not found in schema`);

          // Set default select for relation if not provided
          //@ts-ignore
          if (!relOptions.select || relOptions.select.length === 0) {
            //@ts-ignore
            relOptions.select = relatedTableSchema.columns;
          } else {
            // Validate select fields in relations
            relOptions.select.forEach((field) => {
              if (!relatedTableSchema.columns.includes(field)) {
                throw new Error(
                  `Column ${field} is not defined in schema for table ${relationSchema.table}`
                );
              }
            });
          }

          // Create the relation filter
          const relFilters = { ...relOptions };
          
          // Handle different relation types
          if (Array.isArray(row[relationSchema.foreign_key])) {
            // Handle many-to-many or one-to-many with array of IDs
            //@ts-ignore
            relFilters[relationSchema.reference] = { in: row[relationSchema.foreign_key] };
          } else {
            // Regular one-to-many or many-to-one
            relFilters[relationSchema.reference] = row[relationSchema.foreign_key];
          }

          // Fetch related data
          row[relName] = await fetchData(
            relatedTableSchema.db,
            relationSchema.table,
            relFilters,
            //@ts-ignore
            relOptions.select
          );
          
          // Handle nested relations recursively
          if (relOptions.relations && row[relName].length > 0) {
            for (const relRow of row[relName]) {
              for (const [nestedRelName, nestedRelOptions] of Object.entries(relOptions.relations)) {
                const nestedRelationSchema = relatedTableSchema.relations?.[nestedRelName];
                if (!nestedRelationSchema) throw new Error(`Unknown nested relation: ${nestedRelName}`);
                
                const nestedTableSchema = schema.tables[nestedRelationSchema.table];
                
                // Set default select for nested relation
                //@ts-ignore
                if (!nestedRelOptions.select || nestedRelOptions.select.length === 0) {
                  //@ts-ignore
                  nestedRelOptions.select = nestedTableSchema.columns;
                }
                
                // Create filters for nested relation
                //@ts-ignore
                const nestedFilters = { ...nestedRelOptions };
                nestedFilters[nestedRelationSchema.reference] = relRow[nestedRelationSchema.foreign_key];
                
                // Fetch nested related data
                relRow[nestedRelName] = await fetchData(
                  nestedTableSchema.db,
                  nestedRelationSchema.table,
                  nestedFilters,
                  //@ts-ignore
                  nestedRelOptions.select
                );
              }
            }
          }
        }
      }
    }

    result[table] = data;
  }

  return result;
}

// Function to join data across multiple databases (for advanced queries)
async function crossDatabaseJoin(
  query: {
    mainTable: string,
    mainSelect: string[],
    mainFilters: { [key: string]: any },
    joins: Array<{
      table: string,
      select: string[],
      localKey: string,
      foreignKey: string,
      filters?: { [key: string]: any }
    }>
  }
): Promise<any[]> {
  // Validate main table
  const mainTableSchema = validateTable(query.mainTable, query.mainSelect);
  const mainDbPool = dbPools[mainTableSchema.db];
  
  // First fetch main table data
  const mainData = await fetchData(
    mainTableSchema.db,
    query.mainTable,
    query.mainFilters,
    query.mainSelect
  );
  
  if (mainData.length === 0) return [];
  
  // Process each join
  for (const join of query.joins) {
    const joinTableSchema = validateTable(join.table, join.select);
    
    // Get foreign keys from main data
    const foreignKeys = mainData.map(row => row[join.localKey]);
    
    // Create filters for join
    const joinFilters = {
      ...(join.filters || {}),
      [join.foreignKey]: { in: foreignKeys }
    };
    
    // Fetch joined data
    const joinedData = await fetchData(
      joinTableSchema.db,
      join.table,
      joinFilters,
      join.select
    );
    
    // Create lookup map for efficient joining
    const joinMap: { [key: string]: any[] } = {};
    joinedData.forEach(row => {
      const key = String(row[join.foreignKey]);
      if (!joinMap[key]) joinMap[key] = [];
      joinMap[key].push(row);
    });
    
    // Add joined data to main data
    mainData.forEach(row => {
      const key = String(row[join.localKey]);
      row[join.table] = joinMap[key] || [];
    });
  }
  
  return mainData;
}

// Express routes
app.post("/query", async (req: Request, res: Response) => {
  try {
    const query: QueryRequest = req.body;
    const response = await resolveQuery(query);
    res.json(response);
  } catch (error) {
    console.error("Query error:", error);
    res.status(400).json({ error: (error as Error).message, stack: process.env.NODE_ENV === 'development' ? (error as Error).stack : undefined });
  }
});

// Add a route for custom joins across databases
app.post("/join", async (req: Request, res: Response) => {
  try {
    const joinQuery = req.body;
    const response = await crossDatabaseJoin(joinQuery);
    res.json(response);
  } catch (error) {
    console.error("Join error:", error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// Add a route for raw SQL (for admin use only)
//@ts-ignore
app.post("/raw-sql", async (req: Request, res: Response) => {
  try {
    const { db, sql, params } = req.body;
    
    // Validate inputs
    if (!db || !sql) {
      return res.status(400).json({ error: "Missing required parameters 'db' and 'sql'" });
    }
    
    if (!dbPools[db]) {
      return res.status(400).json({ error: `Database '${db}' not found in configuration` });
    }
    
    // Execute the query
    const result = await executeRawSql(db, sql, params || []);
    res.json({ rowCount: result.rowCount, rows: result.rows });
  } catch (error) {
    console.error("Raw SQL error:", error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// Health check endpoint
//@ts-ignore
app.get("/health", async (req: Request, res: Response) => {
  const status: { [key: string]: string } = {};
  const dbPromises = Object.entries(dbPools).map(async ([dbName, pool]) => {
    try {
      await pool.query("SELECT 1");
      status[dbName] = "connected";
    } catch (error) {
      status[dbName] = "error";
    }
  });
  
  await Promise.all(dbPromises);
  
  // If any database is not connected, return 503
  if (Object.values(status).includes("error")) {
    return res.status(503).json({ status, message: "Some databases are not connected" });
  }
  
  res.json({ status, message: "All systems operational" });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: any) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error", message: err.message });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server and DB connections');
  
  // Close all database pools
  await Promise.all(Object.values(dbPools).map(pool => pool.end()));
  
  process.exit(0);
});

// Start the server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Connected to databases: ${Object.keys(dbPools).join(', ')}`);
});