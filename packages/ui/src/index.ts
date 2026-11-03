export { cn, formatQty, dmyHint } from "./utils"

// Money and dates live in @klygenixvideo/client — see the note in ./utils.

export {
  Card,
  Avatar,
  Select,
  PageHeader,
  StatCard,
  Badge,
  Field,
  PasswordField,
  Modal,
  Drawer,
  Spinner,
  ProgressBar,
  EmptyState,
  SectionHeading,
  Tabs,
  DrawerFooter,
  Switch,
  ToggleField,
  useOutside,
} from "./components/ui"
export type { SelectOption, Accent, BadgeColor, BadgeVariant, DrawerAction } from "./components/ui"

export {
  Button,
  buttonVariants,
  Input,
  Textarea,
  Label,
  Separator,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableFoot,
} from "./components/primitives"
export type { ButtonProps, ButtonVariant, ButtonSize } from "./components/primitives"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./components/DropdownMenu"

export { DataTable, Pager, TableFooter } from "./components/DataTable"
export type { DataTableColumn, DataTableProps } from "./components/DataTable"

export { StatusPill } from "./components/StatusPill"
export { Popover, useOutsidePopover } from "./components/Popover"
export { LineGrid, LineGridTotal } from "./components/LineGrid"
export type { LineGridColumn, LineGridProps } from "./components/LineGrid"

export { Stepper } from "./components/Stepper"
export type { StepperProps } from "./components/Stepper"

export { FileDropzone } from "./components/FileDropzone"
export type { FileDropzoneProps } from "./components/FileDropzone"

export { ComboBox } from "./components/ComboBox"
export type { ComboOption } from "./components/ComboBox"

export { ChangePasswordDialog } from "./components/ChangePasswordDialog"

export { RoleEditor } from "./components/RoleEditor"
export type { AccessActions, Catalog } from "./components/RoleEditor"

export { ConfirmDialogProvider, useConfirm } from "./components/ConfirmDialog"
export type { ConfirmOptions } from "./components/ConfirmDialog"

export { KlygenixIcon, KlygenixWordmark } from "./brand/KlygenixMark"

export { AppShell, ListPage } from "./layout/AppShell"
export { Sidebar } from "./layout/Sidebar"
export type { NavItem, NavSection, SidebarProps } from "./layout/Sidebar"
export { Header } from "./layout/Header"

export {
  downloadReport,
  downloadFile,
  printHtml,
  exportFileName,
  saveBlob,
} from "./download"
export type { ExportFormat } from "./download"

export { ThemeSheet } from "./components/ThemeSheet"
export { Toaster } from "./components/Toaster"
export {
  THEMES,
  DEFAULT_THEME,
  applyTheme,
  readStoredTheme,
  bootTheme,
  isThemeKey,
  isDarkTheme,
  useThemeKey,
} from "./theme"
export type { ThemeKey } from "./theme"
export { CHART_COLORS, CHART_LINE, CHART_AXIS, CHART_RULE } from "./chartColors"

export { UiTextProvider, useUiText, UI_TEXT } from "./text"
export type { UiText, UiTextKey } from "./text"
