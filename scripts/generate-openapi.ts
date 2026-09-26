/**
 * Generates the OpenAPI document without booting a real database connection, so it can run
 * in any environment (CI, this repo's own scripts) without a live Postgres instance.
 * PrismaService is swapped for a no-op stub purely for this generation step - no queries are
 * ever made, since SwaggerModule only inspects decorators and DTOs.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

class NoopPrismaService {
  onModuleInit() {}
  onModuleDestroy() {}
}

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useClass(NoopPrismaService)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  const config = new DocumentBuilder()
    .setTitle('EchoGPT Backend API')
    .setDescription(
      'Production-ready backend for the EchoGPT Chrome Extension: auth, subscriptions, AI provider management, chat, web search, and admin analytics.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addTag('Auth')
    .addTag('Users')
    .addTag('Subscriptions')
    .addTag('AI Providers')
    .addTag('Chat')
    .addTag('Web Search')
    .addTag('Admin')
    .addServer('http://localhost:3000/api/v1', 'Local')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const outPath = path.join(__dirname, '..', 'openapi.json');
  fs.writeFileSync(outPath, JSON.stringify(document, null, 2));
  // eslint-disable-next-line no-console
  console.log(`OpenAPI document written to ${outPath}`);

  await app.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
