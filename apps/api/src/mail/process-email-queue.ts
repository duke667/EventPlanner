import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { MailService } from "./mail.service";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const mailService = app.get(MailService);
  const result = await mailService.processQueue();
  console.log(JSON.stringify(result));
  await app.close();
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
