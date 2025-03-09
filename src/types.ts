export type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export type TableSchema = {
  db: string;
  columns: string[];
  relations?: {
    [relationName: string]: {
      foreign_key: string;
      reference: string;
      table: string;
    };
  };
};

export type Schema = {
  databases: { [key: string]: DatabaseConfig };
  tables: { [key: string]: TableSchema };
};

export type QueryRequest = {
  [table: string]: {
    forEach(arg0: (field: any) => void): unknown;
    id?: number;
    select: string[];
    relations?: { [relation: string]: QueryRequest };
  };
};
