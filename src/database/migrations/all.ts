import type Database from 'better-sqlite3';
import * as m001 from './001_foundation.js';
import * as m002 from './002_core.js';
import * as m003 from './003_fulfillment.js';
import * as m004 from './004_production_returns.js';
import * as m005 from './005_remove_sample_data_setting.js';

export interface Migration {
  id: string;
  up: (db: Database.Database) => void;
}

export const ALL_MIGRATIONS: Migration[] = [
  { id: m001.id, up: m001.up },
  { id: m002.id, up: m002.up },
  { id: m003.id, up: m003.up },
  { id: m004.id, up: m004.up },
  { id: m005.id, up: m005.up },
];
