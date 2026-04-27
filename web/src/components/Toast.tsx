import { useEffect, useState } from "react";

export type ToastKind = "success" | "error" | "info";
export type ToastItem = { id: number; kind: ToastKind; message: string };

export function ToastTray({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-96">
      {items.map((t) => (
        <Toast key={t.id} item={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  const cls =
    item.kind === "success"
      ? "bg-emerald-50 border-emerald-300 text-emerald-900"
      : item.kind === "error"
        ? "bg-rose-50 border-rose-300 text-rose-900"
        : "bg-slate-50 border-slate-300 text-slate-900";
  return (
    <div
      className={`border rounded-lg px-3 py-2 text-sm shadow-sm flex items-start gap-2 ${cls}`}
    >
      <div className="flex-1 whitespace-pre-wrap break-words">{item.message}</div>
      <button onClick={onDismiss} className="text-xs text-slate-500 hover:text-slate-700">
        ✕
      </button>
    </div>
  );
}

export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  function push(kind: ToastKind, message: string) {
    setItems((prev) => [...prev, { id: Date.now() + Math.random(), kind, message }]);
  }
  function dismiss(id: number) {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }
  return { items, push, dismiss };
}
