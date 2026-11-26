import { Inject, Injectable } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { SERVICE_CONFIG, type ServiceConfig } from '../config';

/**
 * Exécute une unité de travail dans une transaction où `app.tenant_id` est positionné.
 * La RLS PostgreSQL (voir rls.sql) filtre alors toutes les lignes du tenant.
 * Ne jamais construire de SQL avec le tenant_id : il est passé en paramètre.
 */
@Injectable()
export class TenantDatabase {
  private pool: Pool | null = null;

  constructor(@Inject(SERVICE_CONFIG) private readonly config: ServiceConfig) {}

  private getPool(): Pool {
    if (!this.config.databaseUrl) {
      throw new Error('DATABASE_URL absent : configurez PostgreSQL pour ce service.');
    }
    this.pool ??= new Pool({ connectionString: this.config.databaseUrl, max: 10 });
    return this.pool;
  }

  async withTenant<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!tenantId) throw new Error('tenant_id obligatoire pour ouvrir une transaction.');
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    if (!this.config.databaseUrl) return false;
    try {
      await this.getPool().query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }
}
