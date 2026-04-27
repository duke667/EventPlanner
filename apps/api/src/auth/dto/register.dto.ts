import { IsEmail, IsIn, IsString, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsIn(["ADMIN", "EVENT_PLANNER", "STAFF", "CHECK_IN"])
  role!: "ADMIN" | "EVENT_PLANNER" | "STAFF" | "CHECK_IN";
}
