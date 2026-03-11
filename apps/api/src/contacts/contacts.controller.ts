import {
  Body,
  Controller,
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
import { ContactImportService } from "./contact-import.service";
import { ContactsService } from "./contacts.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";

@UseGuards(JwtAuthGuard)
@Controller("contacts")
export class ContactsController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly contactImportService: ContactImportService,
  ) {}

  @Get()
  findAll(
    @Query("query") query?: string,
    @CurrentUser() _user?: AuthenticatedUser,
  ) {
    return this.contactsService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateContactDto) {
    return this.contactsService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateContactDto) {
    return this.contactsService.update(id, dto);
  }

  @Post("import")
  @UseInterceptors(FileInterceptor("file"))
  importFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contactImportService.importFile(file, user.sub);
  }
}
