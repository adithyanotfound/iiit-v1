# Database Server API Documentation

This documentation covers all available endpoints and query options for the database server.

## Overview

This server provides a flexible API for querying data across multiple PostgreSQL databases. It supports:

- Standard queries with filtering, sorting and pagination
- Relation-based queries with automatic joins
- Cross-database joins
- Health monitoring
- Raw SQL execution (for admin use)

The server uses a schema definition file (`schema.json`) to validate all queries against the defined database structure.

## Connection Management

The server automatically:

- Creates connection pools for all databases defined in schema.json
- Tests connections at startup
- Maintains connection pooling settings (timeout, max connections)
- Handles graceful shutdown of database connections

## API Endpoints

### 1. Standard Query: `/query` (POST)

The main endpoint for querying data from tables with support for filtering, relations, and pagination.

#### Request Format

```json
{
  "tableName": {
    "select": ["field1", "field2"],
    "field1": "value1",
    "field2": { "gt": 100 },
    "orderBy": "field1",
    "limit": 10,
    "offset": 0,
    "groupBy": ["field1"],
    "relations": {
      "relatedTable": {
        "select": ["rel_field1", "rel_field2"],
        "orderBy": { "rel_field1": "DESC" },
        "limit": 5,
        "relations": {
          "nestedRelation": {
            "select": ["nested_field1"]
          }
        }
      }
    }
  }
}
```

#### Query Options

| Option      | Type                         | Description                                                                              |
| ----------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| `select`    | string[]                     | Columns to select (defaults to all columns if omitted)                                   |
| `orderBy`   | string \| string[] \| object | Sorting options (can be a single field, array of fields, or object with field/direction) |
| `limit`     | number                       | Maximum number of records to return                                                      |
| `offset`    | number                       | Number of records to skip                                                                |
| `groupBy`   | string[]                     | Fields to group results by                                                               |
| `relations` | object                       | Define related data to load with the query                                               |

#### Filter Operators

| Operator      | Example                           | Description                             |
| ------------- | --------------------------------- | --------------------------------------- |
| `=` (default) | `"field": "value"`                | Exact match                             |
| `gt`          | `"field": { "gt": 100 }`          | Greater than                            |
| `lt`          | `"field": { "lt": 100 }`          | Less than                               |
| `gte`         | `"field": { "gte": 100 }`         | Greater than or equal                   |
| `lte`         | `"field": { "lte": 100 }`         | Less than or equal                      |
| `like`        | `"field": { "like": "%text%" }`   | LIKE pattern match (case-sensitive)     |
| `ilike`       | `"field": { "ilike": "%text%" }`  | ILIKE pattern match (case-insensitive)  |
| `neq`         | `"field": { "neq": "value" }`     | Not equal to                            |
| `in`          | `"field": { "in": [1, 2, 3] }`    | Value is in array                       |
| `notIn`       | `"field": { "notIn": [1, 2, 3] }` | Value is not in array                   |
| `between`     | `"field": { "between": [1, 10] }` | Value is between two values (inclusive) |
| `isNull`      | `"field": { "isNull": true }`     | Field is NULL                           |
| `isNotNull`   | `"field": { "isNotNull": true }`  | Field is NOT NULL                       |

#### Response Format

```json
{
  "tableName": [
    {
      "field1": "value1",
      "field2": "value2",
      "relatedTable": [
        {
          "rel_field1": "value",
          "rel_field2": "value",
          "nestedRelation": [
            {
              "nested_field1": "value"
            }
          ]
        }
      ]
    }
  ]
}
```

### 2. Cross-Database Join: `/join` (POST)

Performs joins across tables that may exist in different databases.

#### Request Format

```json
{
  "mainTable": "users",
  "mainSelect": ["id", "name", "email"],
  "mainFilters": {
    "status": "active"
  },
  "joins": [
    {
      "table": "orders",
      "select": ["id", "order_date", "total"],
      "localKey": "id",
      "foreignKey": "user_id",
      "filters": {
        "status": "completed"
      }
    },
    {
      "table": "payments",
      "select": ["id", "amount", "date"],
      "localKey": "id",
      "foreignKey": "user_id",
      "filters": {
        "status": "processed"
      }
    }
  ]
}
```

#### Join Options

| Option               | Type     | Description                          |
| -------------------- | -------- | ------------------------------------ |
| `mainTable`          | string   | Primary table to query               |
| `mainSelect`         | string[] | Fields to select from main table     |
| `mainFilters`        | object   | Filters to apply to main table       |
| `joins`              | array    | Array of tables to join              |
| `joins[].table`      | string   | Related table name                   |
| `joins[].select`     | string[] | Fields to select from related table  |
| `joins[].localKey`   | string   | Field in main table for join         |
| `joins[].foreignKey` | string   | Field in related table for join      |
| `joins[].filters`    | object   | Additional filters for related table |

#### Response Format

```json
[
  {
    "id": 1,
    "name": "User Name",
    "email": "user@example.com",
    "orders": [
      {
        "id": 101,
        "order_date": "2023-01-15T00:00:00.000Z",
        "total": 99.99
      }
    ],
    "payments": [
      {
        "id": 201,
        "amount": 99.99,
        "date": "2023-01-15T00:00:00.000Z"
      }
    ]
  }
]
```

### 3. Raw SQL: `/raw-sql` (POST)

Execute raw SQL queries directly against a database (admin use only).

#### Request Format

```json
{
  "db": "database_name",
  "sql": "SELECT * FROM users WHERE id = $1",
  "params": [123]
}
```

#### Options

| Option   | Type   | Description                                               |
| -------- | ------ | --------------------------------------------------------- |
| `db`     | string | Database name to execute against (must match schema.json) |
| `sql`    | string | Raw SQL query to execute                                  |
| `params` | array  | Optional parameters for prepared statement                |

#### Response Format

```json
{
  "rowCount": 1,
  "rows": [
    {
      "id": 123,
      "name": "Example User",
      "email": "user@example.com"
    }
  ]
}
```

### 4. Health Check: `/health` (GET)

Check the health and connection status of all configured databases.

#### Response Format

```json
{
  "status": {
    "database1": "connected",
    "database2": "connected"
  },
  "message": "All systems operational"
}
```

## Schema Definition

The server validates all queries against a schema defined in `schema.json`. This file must define:

1. Database connections
2. Table definitions
3. Column definitions
4. Relationship definitions

Example schema structure:

```json
{
  "databases": {
    "main_db": {
      "host": "localhost",
      "port": 5432,
      "user": "postgres",
      "password": "password",
      "database": "main_database"
    },
    "analytics_db": {
      "host": "localhost",
      "port": 5432,
      "user": "postgres",
      "password": "password",
      "database": "analytics_database"
    }
  },
  "tables": {
    "users": {
      "db": "main_db",
      "columns": ["id", "name", "email", "created_at"],
      "relations": {
        "orders": {
          "table": "orders",
          "foreign_key": "id",
          "reference": "user_id"
        }
      }
    },
    "orders": {
      "db": "main_db",
      "columns": ["id", "user_id", "total", "status", "created_at"],
      "relations": {
        "items": {
          "table": "order_items",
          "foreign_key": "id",
          "reference": "order_id"
        }
      }
    },
    "order_items": {
      "db": "main_db",
      "columns": ["id", "order_id", "product_id", "quantity", "price"]
    },
    "user_metrics": {
      "db": "analytics_db",
      "columns": ["user_id", "logins_count", "last_active", "engagement_score"]
    }
  }
}
```

## Error Handling

The server returns appropriate HTTP status codes and detailed error messages:

- `400` - Bad Request: Invalid query structure or parameters
- `404` - Not Found: Requested resource not found
- `500` - Internal Server Error: Unexpected server error
- `503` - Service Unavailable: Database connection issues

Error responses include:

- Error message
- Stack trace (in development mode only)

## Query Examples

### Basic Query with Filtering

```json
{
  "users": {
    "select": ["id", "name", "email"],
    "status": "active",
    "created_at": { "gte": "2023-01-01" },
    "limit": 10
  }
}
```

### Query with Relations

```json
{
  "users": {
    "id": 123,
    "relations": {
      "orders": {
        "select": ["id", "total", "created_at"],
        "status": "completed",
        "orderBy": { "created_at": "DESC" },
        "limit": 5
      }
    }
  }
}
```

### Complex Query with Nested Relations

```json
{
  "users": {
    "role": "customer",
    "relations": {
      "orders": {
        "status": "completed",
        "created_at": { "gte": "2023-01-01" },
        "relations": {
          "items": {
            "select": ["product_id", "quantity", "price"],
            "quantity": { "gt": 1 }
          }
        }
      }
    }
  }
}
```

### Cross-Database Join

```json
{
  "mainTable": "users",
  "mainSelect": ["id", "name", "email"],
  "mainFilters": {
    "status": "active"
  },
  "joins": [
    {
      "table": "user_metrics",
      "select": ["logins_count", "engagement_score"],
      "localKey": "id",
      "foreignKey": "user_id",
      "filters": {
        "engagement_score": { "gt": 50 }
      }
    }
  ]
}
```
