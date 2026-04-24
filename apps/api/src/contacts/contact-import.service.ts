import { BadRequestException, Injectable } from "@nestjs/common";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { PrismaService } from "../prisma/prisma.service";
import { ContactImportSummary } from "./contact-import.types";

type ImportedRow = {
  salutation?: string;
  firstName: string;
  lastName: string;
  email: string;
  company?: string;
  phone?: string;
  jobTitle?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  notes?: string;
  tags?: string[];
};

type RowError = {
  row: number;
  message: string;
};

@Injectable()
export class ContactImportService {
  constructor(private readonly prisma: PrismaService) {}

  async importFile(
    file: Express.Multer.File,
    uploadedByUserId: string,
  ): Promise<ContactImportSummary> {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }

    const extension = file.originalname.split(".").pop()?.toLowerCase();
    const sourceType = extension === "xlsx" ? "XLSX" : extension === "csv" ? "CSV" : "";

    if (!sourceType) {
      throw new BadRequestException("Only CSV and XLSX files are supported");
    }

    const rows = sourceType === "CSV" ? this.parseCsv(file.buffer) : this.parseXlsx(file.buffer);

    if (rows.length === 0) {
      throw new BadRequestException("The uploaded file contains no rows");
    }

    const errors: RowError[] = [];
    let importedRows = 0;
    let duplicates = 0;

    for (const row of rows) {
      try {
        const normalized = this.normalizeRow(row.data);
        const existing = await this.prisma.contact.findUnique({
          where: { email: normalized.email },
          select: { id: true },
        });

        if (existing) {
          duplicates += 1;
          errors.push({
            row: row.index,
            message: `Duplicate email: ${normalized.email}`,
          });
          continue;
        }

        await this.prisma.contact.create({
          data: {
            salutation: normalized.salutation,
            firstName: normalized.firstName,
            lastName: normalized.lastName,
            email: normalized.email,
            company: normalized.company,
            phone: normalized.phone,
            jobTitle: normalized.jobTitle,
            street: normalized.street,
            postalCode: normalized.postalCode,
            city: normalized.city,
            country: normalized.country,
            notes: normalized.notes,
            tags: normalized.tags ?? [],
          },
        });

        importedRows += 1;
      } catch (error) {
        errors.push({
          row: row.index,
          message: error instanceof Error ? error.message : "Unknown import error",
        });
      }
    }

    const record = await this.prisma.contactImport.create({
      data: {
        uploadedByUserId,
        filename: file.originalname,
        sourceType,
        status: errors.length > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
        totalRows: rows.length,
        importedRows,
        errorRows: errors.length,
        mappingJson: {
          firstName: ["first_name", "firstname", "vorname"],
          lastName: ["last_name", "lastname", "nachname", "name"],
          email: ["email", "e-mail", "mail-dienstl1", "mail-privat"],
          company: ["company", "firma", "amt"],
          phone: ["phone", "telefon"],
          jobTitle: ["job_title", "position", "title"],
          street: ["street", "strasse", "straße", "privat-str"],
          postalCode: ["postal_code", "plz", "privat-plz"],
          city: ["city", "ort", "privat-ort"],
          country: ["country", "land"],
          tags: ["tags"],
        },
        errorLogJson: {
          duplicates,
          errors,
        },
      },
    });

    return {
      id: record.id,
      filename: record.filename,
      sourceType: record.sourceType,
      status: record.status,
      totalRows: record.totalRows,
      importedRows: record.importedRows,
      errorRows: record.errorRows,
      duplicates,
      createdAt: record.createdAt.toISOString(),
      errors,
    };
  }

  private parseCsv(buffer: Buffer) {
    const records = parse(buffer, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>;

    return records.map((data, index) => ({
      index: index + 2,
      data,
    }));
  }

  private parseXlsx(buffer: Buffer) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      return [];
    }

    const sheet = workbook.Sheets[sheetName];
    const records = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: "",
    });

    return records.map((data, index) => ({
      index: index + 2,
      data,
    }));
  }

  private normalizeRow(row: Record<string, string>): ImportedRow {
    const get = (...candidates: string[]) => {
      const normalizedCandidates = candidates.map((candidate) =>
        this.normalizeColumnName(candidate),
      );
      const entry = Object.entries(row).find(([key]) =>
        normalizedCandidates.includes(this.normalizeColumnName(key)),
      );
      return entry?.[1]?.toString().trim() ?? "";
    };

    const firstName = get("first_name", "firstname", "vorname");
    const email = get("email", "e-mail", "mail-dienstl1", "mail-privat").toLowerCase();
    const fallbackName = email.split("@")[0] || "Kontakt";
    const lastName =
      get("last_name", "lastname", "nachname", "name") || get("firma") || fallbackName;

    if (!lastName || !email) {
      throw new Error("lastName and email are required");
    }

    return {
      salutation: get("anrede", "persanrede") || undefined,
      firstName,
      lastName,
      email,
      company: get("company", "firma", "amt") || undefined,
      phone: get("phone", "telefon") || undefined,
      jobTitle: get("job_title", "position", "title") || undefined,
      street: get("street", "strasse", "straße", "privat-str") || undefined,
      postalCode: get("postal_code", "plz", "privat-plz") || undefined,
      city: get("city", "ort", "privat-ort") || undefined,
      country: get("country", "land") || undefined,
      notes: get("info") || undefined,
      tags: get("tags")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
  }

  private normalizeColumnName(value: string) {
    return value
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]/g, "");
  }
}
