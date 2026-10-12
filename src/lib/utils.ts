import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge conditional class names, then resolve conflicting Tailwind utilities
 * (e.g. a caller's `px-2` overriding a component's default `px-4`) in favor
 * of the one that appears last. Standard shadcn/ui `cn` helper.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
