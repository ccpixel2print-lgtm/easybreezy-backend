import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
      : true,
    credentials: true,
  }); // allow the frontend to call the API
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
bootstrap();
