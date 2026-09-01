import { FileDown, FileSpreadsheet } from "lucide-react";
import { Button } from "../ui/Button";

export function DownloadActions({
  onExcel,
  onPdf,
  excelLabel = "Download Excel",
  pdfLabel = "Download PDF",
  className = "",
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <Button type="button" variant="secondary" className="text-xs" onClick={onExcel}>
        <FileSpreadsheet className="mr-1.5 inline h-3.5 w-3.5" />
        {excelLabel}
      </Button>
      <Button type="button" variant="secondary" className="text-xs" onClick={onPdf}>
        <FileDown className="mr-1.5 inline h-3.5 w-3.5" />
        {pdfLabel}
      </Button>
    </div>
  );
}
