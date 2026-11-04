import type Database from 'better-sqlite3';
import * as m001 from './001_foundation.js';

export interface Migration {
  id: string;
  up: (db: Database.Database) => void;
}

export const ALL_MIGRATIONS: Migration[] = [{ id: m001.id, up: m001.up }];
