/**
 * What React Native may import from this package.
 *
 * The main barrel reaches `sonner` and `lucide-react` through the query hooks and
 * ProtectedRoute, and neither exists on a phone. §07 shares money formatting and the
 * API shapes with mobile, not the DOM; this entry is that promise made checkable.
 */

export { formatMoney, formatAmount, toMinor, fromMinor, exponentFor } from "./money"
export { formatDate, formatBusinessDate, todayIn, daysBefore } from "./dates"
export { configureApp, appKey } from "./app"
