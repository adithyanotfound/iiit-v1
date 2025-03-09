import express, { Request, Response, NextFunction, response } from "express";
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { schema } from ".";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

const genAI = new GoogleGenerativeAI(String(process.env.GEMINI_API_KEY));
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

function extractAndParseJSON(response: any) {
    try {
        // Extract the JSON string from the triple-backtick block
        const jsonMatch = response.answer.match(/```json\n([\s\S]*?)\n```/);
        
        if (!jsonMatch) {
            throw new Error("No valid JSON found in the response");
        }
  
        // Parse the extracted JSON string
        return JSON.parse(jsonMatch[1]);
    } catch (error: any) {
        console.error("Error parsing JSON:", error.message);
        return null;
    }
  }
  

const asyncHandler =
  (fn: any) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

router.post(
  "/generate",
  asyncHandler(async (req: Request, res: Response) => {
    const prompt = req.body.prompt;

    console.log("schema: ", JSON.stringify(schema));

    const model: GenerativeModel = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: `You are a senior backend developer. You are responsible for quering the database. IMPORTANT: The following are the rules for writing queries. Do not respond to unrelated queries.
        Database Server API Documentation
        This documentation covers all available endpoints and query options for the database server.
        Overview
        This server provides a flexible API for querying data across multiple PostgreSQL databases. It supports:
        Standard queries with filtering, sorting, and pagination
        Relation-based queries with automatic joins
        Cross-database joins
        Health monitoring
        Raw SQL execution (for admin use)
        The server uses a schema definition file (schema.json) to validate all queries against the defined database structure.
        Connection Management
        The server automatically:
        Creates connection pools for all databases defined in schema.json
        Tests connections at startup
        Maintains connection pooling settings (timeout, max connections)
        Handles graceful shutdown of database connections
        API Endpoints

        1. Standard Query: /query (POST)

        The main endpoint for querying data from tables with support for filtering, relations, and pagination.

        Request Format

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

        # Query Options

        select: Columns to select (defaults to all columns if omitted). * is not allowed. You need to specify the columns explicitly.

        orderBy: Sorting options (single field, array, or object with field/direction)

        limit: Maximum number of records to return

        offset: Number of records to skip

        groupBy: Fields to group results by

        relations: Define related data to load with the query

        # Filter Operators

        = (default): Exact match

        gt: Greater than

        lt: Less than

        gte: Greater than or equal

        lte: Less than or equal

        like: LIKE pattern match (case-sensitive)

        ilike: ILIKE pattern match (case-insensitive)

        neq: Not equal to

        in: Value is in array

        notIn: Value is not in array

        between: Value is between two values (inclusive)

        isNull: Field is NULL

        isNotNull: Field is NOT NULL

        Response Format

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

        2. Cross-Database Join: /join (POST)

        Performs joins across tables that may exist in different databases.

        # Request Format

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
        }
        ]
        }

        3. Raw SQL: /raw-sql (POST)

        Execute raw SQL queries directly against a database (admin use only).

        Request Format

        {
        "db": "database_name",
        "sql": "SELECT * FROM users WHERE id = $1",
        "params": [123]
        }

        # Schema Definition

        The server validates all queries against a schema defined in schema.json. This file must define:

        Database connections

        Table definitions

        Column definitions

        Relationship definitions

        IMPORTANT:
        The schema.json file for my project is as follows:
        Strictly adhere to the following schema.json file for the query to work correctly.

        ${JSON.stringify(schema)}

        # Query Examples

        Retrieve all authors with their books
        {
          "authors": {
            "select": [
              "id",
              "name"
            ],
            "relations": {
              "books": {
                "select": [
                  "title"
                ]
              }
            }
          }
        }

        Basic Query with Filtering

        {
        "users": {
        "select": ["id", "name", "email"],  // you have to mentions all the columns you of the table here irrespective of the columns you want to select
        "status": "active",
        "created_at": { "gte": "2023-01-01" },
        "limit": 10
        }
        }

        Query with Relations

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

        Cross-Database Join

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

        IMPORTANT: Return output as following format (JSON).
        {
          "endpoint": endpoint,
          "query": query,
        }
        ONLY GIVE A SINGLE QUERY AND DO NOT RETURN ANYTHING ELSE.
        `,
      generationConfig: { temperature: 0 },
    });

    const modelResponse = await model.generateContent(`${prompt}`);

    const answer = modelResponse.response.text();

    const json = extractAndParseJSON({ answer });

    res.json({
      json
    });
  }),
);

export default router;