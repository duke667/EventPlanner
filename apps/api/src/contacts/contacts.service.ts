import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query?: string) {
    return this.prisma.contact.findMany({
      where: query
        ? {
            OR: [
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { company: { contains: query, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
  }

  async create(dto: CreateContactDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.contact.findUnique({ where: { email } });

    if (existing) {
      throw new ConflictException("Contact email already exists");
    }

    return this.prisma.contact.create({
      data: {
        ...dto,
        email,
        tags: dto.tags ?? [],
      },
    });
  }

  async update(id: string, dto: UpdateContactDto) {
    const contact = await this.prisma.contact.findUnique({ where: { id } });

    if (!contact) {
      throw new NotFoundException("Contact not found");
    }

    if (dto.email && dto.email.toLowerCase() !== contact.email) {
      const existing = await this.prisma.contact.findUnique({
        where: { email: dto.email.toLowerCase() },
      });

      if (existing) {
        throw new ConflictException("Contact email already exists");
      }
    }

    return this.prisma.contact.update({
      where: { id },
      data: {
        ...dto,
        email: dto.email?.toLowerCase(),
      },
    });
  }

  async delete(id: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!contact) {
      throw new NotFoundException("Contact not found");
    }

    await this.prisma.$transaction(async (tx) => {
      const invitations = await tx.eventInvitation.findMany({
        where: { contactId: id },
        select: { id: true },
      });
      const invitationIds = invitations.map((invitation) => invitation.id);

      if (invitationIds.length > 0) {
        await tx.emailJob.deleteMany({
          where: { eventInvitationId: { in: invitationIds } },
        });
        await tx.checkIn.deleteMany({
          where: { eventInvitationId: { in: invitationIds } },
        });
        await tx.eventRegistration.deleteMany({
          where: { eventInvitationId: { in: invitationIds } },
        });
        await tx.eventInvitation.deleteMany({
          where: { id: { in: invitationIds } },
        });
      }

      await tx.contact.delete({
        where: { id },
      });
    });

    return { ok: true };
  }
}
