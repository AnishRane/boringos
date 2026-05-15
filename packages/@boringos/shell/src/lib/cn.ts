// SPDX-License-Identifier: GPL-3.0-or-later
//
// Standard `cn` helper used by shadcn-style components — concatenates
// class names with Tailwind-aware conflict resolution.

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
