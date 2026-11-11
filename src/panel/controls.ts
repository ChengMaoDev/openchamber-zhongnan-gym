import { mountButton } from "@openchamber/sdk/ui";

export function createControls(
  element: (id: string) => HTMLElement,
  select: (offset: number) => void,
  today: () => void,
  refresh: () => void,
) {
  const button = (id: string, label: string, name: string, onClick: () => void) => {
    const container = element(id);
    const handle = mountButton(container, { label, variant: "ghost", size: "xs", onClick });
    const control = container.querySelector("button");
    if (!control) throw new Error(`按钮未生成：${id}`);
    control.setAttribute("aria-label", name);
    control.title = name;
    return handle;
  };
  return {
    previous: button("previous", "‹", "前一天", () => select(-1)),
    next: button("next", "›", "后一天", () => select(1)),
    today: button("today", "今天", "今天", today),
    refresh: button("refresh", "刷新", "刷新", refresh),
  };
}
