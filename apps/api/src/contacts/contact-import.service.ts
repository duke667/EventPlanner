import { BadRequestException, Injectable } from "@nestjs/common";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { PrismaService } from "../prisma/prisma.service";
import { ContactImportSummary } from "./contact-import.types";

type ImportedRow = {
  firstName: string;
  lastName: string;
  email: string;
  company?: string;
  phone?: string;
  jobTitle?: string;
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
            firstName: normalized.firstName,
            lastName: normalized.lastName,
            email: normalized.email,
            company: normalized.company,
            phone: normalized.phone,
            jobTitle: normalized.jobTitle,
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
          lastName: ["last_name", "lastname", "nachname"],
          email: ["email", "e-mail"],
          company: ["company", "firma"],
          phone: ["phone", "telefon"],
          jobTitle: ["job_title", "position", "title"],
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
      const entry = Object.entries(row).find(([key]) =>
        candidates.includes(key.trim().toLowerCase()),
      );
      return entry?.[1]?.toString().trim() ?? "";
    };

    const firstName = get("first_name", "firstname", "vorname");
    const lastName = get("last_name", "lastname", "nachname");
    const email = get("email", "e-mail").toLowerCase();

    if (!firstName || !lastName || !email) {
      throw new Error("firstName, lastName and email are required");
    }

    return {
      firstName,
      lastName,
      email,
      company: get("company", "firma") || undefined,
      phone: get("phone", "telefon") || undefined,
      jobTitle: get("job_title", "position", "title") || undefined,
      tags: get("tags")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
  }
}
