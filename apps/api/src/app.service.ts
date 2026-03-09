import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  getHealth() {
    return {
      status: "ok",
      service: "event-manager-api",
      timestamp: new Date().toISOString(),
    };
  }
}
