import { forwardRef, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";

/**
 * Auto-formats US phone numbers as the user types. Accepts extensions
 * inline using "x" or "ext" syntax, e.g. "(208) 555-1234 x567".
 *
 * Why not two fields? Summer 2026-04-19: "Ensure the phone field can
 * handle the extension being added and it's in the correct format
 * even if an extension is added or not." The split phone + phone_ext
 * fields were redundant — reps already type the extension after the
 * number naturally.
 *
 * Behavior:
 *   - Strips everything that isn't a digit or "x" to build a canonical
 *     form while typing.
 *   - Applies (xxx) xxx-xxxx formatting as they type.
 *   - After 10 digits, anything following is treated as an extension
 *     and rendered as " x###". So "2085551234567" → "(208) 555-1234 x567".
 *   - Non-US numbers (more than 10 leading digits) fall through with
 *     a light "+..." prefix so international input isn't mangled.
 */
function formatPhone(input: string): string {
  if (!input) return "";

  // Find an explicit "x" / "ext" separator so we can keep the extension
  // distinct regardless of spacing.
  const extMatch = input.match(/(?:x|ext\.?)\s*(\d+)/i);
  let extension = extMatch ? extMatch[1] : "";
  let core = extension ? input.slice(0, extMatch!.index) : input;

  // Pull digits out of core
  const digits = core.replace(/\D/g, "");

  // If no explicit x/ext marker but there are >10 digits, take the tail
  // as the extension.
  let mainDigits = digits;
  if (!extension && digits.length > 10) {
    mainDigits = digits.slice(0, 10);
    extension = digits.slice(10);
  }

  // Format the main 10-digit number US-style
  let formatted = "";
  if (mainDigits.length === 0) {
    formatted = "";
  } else if (mainDigits.length <= 3) {
    formatted = `(${mainDigits}`;
  } else if (mainDigits.length <= 6) {
    formatted = `(${mainDigits.slice(0, 3)}) ${mainDigits.slice(3)}`;
  } else if (mainDigits.length <= 10) {
    formatted = `(${mainDigits.slice(0, 3)}) ${mainDigits.slice(3, 6)}-${mainDigits.slice(6)}`;
  } else {
    // International fallback: more than 10 digits and no explicit ext.
    formatted = `+${mainDigits}`;
  }

  return extension ? `${formatted} x${extension}` : formatted;
}

interface PhoneInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value?: string | null;
  onChange?: (next: string) => void;
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput({ value, onChange, ...rest }, ref) {
    return (
      <Input
        {...rest}
        ref={ref}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="(208) 555-1234 x567"
        value={value ?? ""}
        onChange={(e) => onChange?.(formatPhone(e.target.value))}
      />
    );
  }
);

/** Export raw formatter for places that need to re-format stored data on display. */
export { formatPhone };
