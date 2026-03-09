import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET"),
      }),
    }),
  ],
  controllers: [ContactsController],
  providers: [ContactsService, JwtAuthGuard],
})
export class ContactsModule {}
