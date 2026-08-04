import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useRequestDialog } from "./RequestDialogProvider";
import type { RequestTab } from "./RequestForms";

/**
 * Legacy /requests route. The Requests tab became the header popup
 * (Nathan, 2026-08-04); old bookmarks and ?tab= deep links land here,
 * get the popup opened on the right form, and are sent home.
 */
export function RequestsRedirect() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { openRequestDialog } = useRequestDialog();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const t = searchParams.get("tab");
    const tab: RequestTab | undefined =
      t === "collateral" || t === "product" || t === "crm" ? t : undefined;
    openRequestDialog(tab);
    navigate("/", { replace: true });
  }, [searchParams, navigate, openRequestDialog]);

  return null;
}
