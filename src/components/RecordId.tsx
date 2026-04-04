import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface RecordIdProps {
  id: string;
  sfId?: string | null;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

export function RecordId({ id, sfId }: RecordIdProps) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground mb-4">
      <span className="inline-flex items-center gap-1.5">
        <span className="font-medium">Record ID:</span>
        <code className="bg-muted px-1 py-0.5 rounded font-mono">
          {id}
        </code>
        <CopyButton value={id} />
      </span>
      {sfId && (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-medium">SF ID:</span>
          <code className="bg-muted px-1 py-0.5 rounded font-mono">
            {sfId}
          </code>
          <CopyButton value={sfId} />
        </span>
      )}
    </div>
  );
}
