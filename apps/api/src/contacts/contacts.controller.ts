import {
  Body,
  Controller,
  Delete,
  Get,
  UploadedFile,
  Patch,
  Post,
  Query,
  Param,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ContactImportService } from "./contact-import.service";
import { ContactsService } from "./contacts.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("contacts")
export class ContactsController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly contactImportService: ContactImportService,
  ) {}

  @Get()
  @Roles("ADMIN", "EVENT_PLANNER", "STAFF")
  findAll(
    @Query("query") query?: string,
    @CurrentUser() _user?: AuthenticatedUser,
  ) {
    return this.contactsService.findAll(query);
  }

  @Post()
  @Roles("ADMIN", "EVENT_PLANNER", "STAFF")
  create(@Body() dto: CreateContactDto) {
    return this.contactsService.create(dto);
  }

  @Patch(":id")
  @Roles("ADMIN", "EVENT_PLANNER", "STAFF")
  update(@Param("id") id: string, @Body() dto: UpdateContactDto) {
    return this.contactsService.update(id, dto);
  }

  @Delete(":id")
  @Roles("ADMIN", "EVENT_PLANNER", "STAFF")
  delete(@Param("id") id: string) {
    return this.contactsService.delete(id);
  }

  @Post("import")
  @UseInterceptors(FileInterceptor("file"))
  @Roles("ADMIN", "EVENT_PLANNER", "STAFF")
  importFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contactImportService.importFile(file, user.sub);
  }
}
