import { type InputHTMLAttributes } from "react";
import { Icon } from "../../icons/Icon";

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Accessible name — placeholder alone is not one. */
  "aria-label": string;
}

/**
 * Shared search input — one visual system (panel-input tokens) for every
 * panel search box, with a required accessible name.
 */
export function SearchInput({ className = "", ...props }: SearchInputProps) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-md bg-panel-input px-2.5 py-[5px] ${className}`}
    >
      <Icon name="magnifyingGlass" size={12} className="flex-shrink-0" />
      <input
        type="text"
        className="min-w-0 w-full bg-transparent text-[11px] text-panel-text-1 outline-none placeholder:text-panel-text-5"
        {...props}
      />
    </div>
  );
}
