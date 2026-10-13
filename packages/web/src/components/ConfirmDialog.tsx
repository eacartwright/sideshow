import type { ReactNode } from "react";
import { Dialog } from "./Dialog";

/** "Are you sure?": Cancel (focused, so Enter doesn't do it by accident) or the action. */
export function ConfirmDialog({
  title,
  children,
  confirm,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  /** The action button's label ("Delete"). */
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog title={title} onClose={onCancel} className="confirm">
      <div className="stack">
        {children}
        <div className="row-actions">
          <span className="spacer" />
          <button className="btn" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="btn danger-solid" onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
