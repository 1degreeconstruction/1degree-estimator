import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(dateStr: string | Date): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(dateStr: string | Date): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    sent: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    viewed: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    follow_up_1: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    follow_up_2: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    expired: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    declined: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  };
  return colors[status] || colors.draft;
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Draft",
    sent: "Sent",
    viewed: "Viewed",
    follow_up_1: "Follow Up 1",
    follow_up_2: "Follow Up 2",
    approved: "Approved",
    expired: "Expired",
    declined: "Declined",
  };
  return labels[status] || status;
}
