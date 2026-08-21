// Campaign card keyboard activation. The tracker card is a focusable
// role="button", but sequence subject/body fields (and other controls) can
// render as descendants. Space/Enter from those controls must type or
// activate the control, not open the card.

const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "iframe",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='combobox']",
  "[role='listbox']",
  "[role='option']",
  "[role='menuitem']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='slider']",
  "[role='tab']",
  "[role='searchbox']",
].join(",");

type Closable = { closest: (selector: string) => unknown };

function asClosable(value: EventTarget | null | undefined): Closable | null {
  if (!value || typeof (value as unknown as Closable).closest !== "function") return null;
  return value as unknown as Closable;
}

export function shouldActivateCardKey(event: {
  key: string;
  target: EventTarget | null;
  currentTarget?: EventTarget | null;
}): boolean {
  if (event.key !== "Enter" && event.key !== " ") return false;
  const target = asClosable(event.target);
  if (!target) return true;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  if (interactive && interactive !== event.currentTarget) return false;
  return true;
}
