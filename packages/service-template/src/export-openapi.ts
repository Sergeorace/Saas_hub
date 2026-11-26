import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SERVICE_CONFIG, type ServiceConfig } from './config';
import { createOpenApiDocument } from './openapi';

async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  const config = app.get<ServiceConfig>(SERVICE_CONFIG);
  const document = createOpenApiDocument(app, config.name);
  const target = resolve(__dirname, '..', '..', 'openapi.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.log(`OpenAPI écrit : ${target} (${Object.keys(document.paths).length} chemins)`);
}

void exportOpenApi();
