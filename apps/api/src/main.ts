import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  // bodyParser: false -> Nest will NOT parse bodies for us.
  // We want the exact bytes that were sent, not a re-serialized copy.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureApp(app);

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`Hookpit API listening on http://localhost:${port}`);
}
bootstrap();
