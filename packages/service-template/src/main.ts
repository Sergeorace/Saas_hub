import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { SERVICE_CONFIG, type ServiceConfig } from './config';
import { setupOpenApi } from './openapi';
import { TenantMiddleware } from './tenant/tenant.middleware';
import type { TenantRequest } from './tenant/tenant.guard';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<ServiceConfig>(SERVICE_CONFIG);
  const tenantMiddleware = app.get(TenantMiddleware);

  app.use((request: Request, response: Response, next: NextFunction) => {
    tenantMiddleware.use(request as unknown as TenantRequest, response, next);
  });
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    next();
  });

  if (config.environment !== 'production') {
    setupOpenApi(app, config.name);
  }

  await app.listen(config.port);
  new Logger('bootstrap').log(
    `${config.name} écoute sur le port ${config.port} (${config.environment}).`,
  );
}

void bootstrap();
