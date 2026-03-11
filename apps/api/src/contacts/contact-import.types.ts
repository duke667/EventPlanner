export interface ContactImportSummary {
  id: string;
  filename: string;
  sourceType: string;
  status: string;
  totalRows: number;
  importedRows: number;
  errorRows: number;
  duplicates: number;
  createdAt: string;
  errors: Array<{
    row: number;
    message: string;
  }>;
}
