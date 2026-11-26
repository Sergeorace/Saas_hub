import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';

export function createOpenApiDocument(app: INestApplication, serviceName: string): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(`RESTO-HUB — ${serviceName}`)
    .setDescription(
      'Contrat d’API du service. Toute route métier exige x-tenant-id et la RLS PostgreSQL filtre les données.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-internal-key' }, 'internalKey')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupOpenApi(app: INestApplication, serviceName: string): OpenAPIObject {
  const document = createOpenApiDocument(app, serviceName);
  SwaggerModule.setup('docs', app, document);
  return document;
}
