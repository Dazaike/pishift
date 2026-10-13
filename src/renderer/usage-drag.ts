import type { UsageModalOrder } from "../shared/usage-tracker";
import { attachPointerReorder, keysOf } from "./pointer-reorder";

export type UsageDragHost = {
  isActive: () => boolean;
  getOrder: () => UsageModalOrder | undefined;
  onChange: (order: UsageModalOrder) => void;
};

/** Limit cards drag inside their provider's grid; provider sections drag by their header. */
export function attachUsageDrag(body: HTMLElement, host: UsageDragHost): void {
  attachPointerReorder(body, {
    isActive: host.isActive,
    resolveItem: (target) =>
      target.closest<HTMLElement>(".usage-limit-row[data-key]") ??
      target.closest<HTMLElement>(".usage-provider-name")?.parentElement ??
      target.closest<HTMLElement>(".usage-raw-pre[data-key]"),
    onCommit: (list) => {
      const order = host.getOrder();
      const sections = keysOf(body);
      if (list === body) {
        host.onChange({ sections, limits: order?.limits ?? {} });
        return;
      }
      const sectionKey = list.closest<HTMLElement>(".usage-provider")?.dataset.key;
      if (sectionKey) host.onChange({ sections, limits: { ...(order?.limits ?? {}), [sectionKey]: keysOf(list) } });
    },
  });
}
