import Link from "next/link";
import type { RangeKey } from "@/lib/types";

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "1y", label: "1y" },
  { key: "all", label: "All" },
];

export function RangePicker({
  current,
  basePath,
}: {
  current: RangeKey;
  basePath: string;
}) {
  return (
    <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
      {RANGES.map((r) => (
        <Link
          key={r.key}
          href={`${basePath}?range=${r.key}`}
          className={`px-3 py-1 rounded-md text-sm ${
            current === r.key
              ? "bg-vital-600 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );
}
